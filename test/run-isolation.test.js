import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { IsolatedPlaybookEngine, callerFacts } from '../src/run-isolation.js'
import { createIsolationManager } from '../src/host-isolation.js'
import { createMediaRunner } from '../src/host-media.js'
const book = { id: 'video-fixture', stages: [
  { id: 'script', objective: 'Freeze script', gate: { evidence: [{key:'production_manifest',type:'string'}], validators: [{kind:'narration',pathKey:'production_manifest'}] } },
  { id: 'qa', objective: 'Check media', gate: { evidence: [{key:'production_manifest',type:'string'}], validators: [{kind:'video',pathKey:'production_manifest'}] }, retry:{ maxAttempts:2 }, next:null },
] }
const caller = (id, workspace='/workspace/test') => ({ agent:{ id, session:{header:{cwd:workspace}, requestHeader:()=>({config:{provider:'test-provider',model:'test-model'}})} }, signal:new AbortController().signal, token:Symbol(),callId:'tool-call' })
function engine() { const e = new IsolatedPlaybookEngine(); e.register(book); return e }
async function prepare(e,id) {
  const own=e.status(id).isolation
  await e.markPrepared(id,own.runId,{status:'pass',runId:own.runId,key:own.key,root:own.root,markerSha256:'1'.repeat(64),createdAtMs:1234})
  return e.status(id).isolation
}
function result(own,kind,digest='2'.repeat(64)) {
  const file={path:join(own.root,'final','final.mp4'),sha256:digest,bytes:16}
  return {validatorVersion:'0.4.0',kind,status:'pass',passed:true,failures:[],
    ownership:{runId:own.runId,key:own.key,root:own.realRoot,markerSha256:own.markerSha256,createdAtMs:own.createdAtMs},
    bindings:{[file.path]:file},narration:{scriptSha256:'script',segmentSha256:'segments'},
    ...(kind==='video'?{video:{binding:file,durationSeconds:4},cover:{sha256:'cover'}}:{})}
}
async function started(e,id) {e.noteCaller(caller(id));await e.start(id,'video-fixture',{});return prepare(e,id)}
async function script(e,id,own) {return e.submit(id,{stageId:'script',evidence:{production_manifest:'production.json'},runtimeChecks:[result(own,'narration')]})}

test('same project and same output request allocate distinct engine-owned roots',async()=>{
  const e=engine();const a=await started(e,'a'),b=await started(e,'b')
  assert.notEqual(a.root,b.root);assert.equal(a.workspace,b.workspace);assert.notEqual(a.runId,b.runId)
  assert.equal(e.status('a').isolation.modelRouteAtStart.model,'test-model')
})
test('input run_id/model_id/workspace cannot forge allocation or producer metadata',async()=>{
  const e=engine();e.noteCaller(caller('a'));await e.start('a','video-fixture',{run_id:'old',model_id:'pretend-model',workspace:'/old'})
  const own=e.status('a').isolation;assert.notEqual(own.runId,'old');assert.equal(own.workspace,'/workspace/test');assert.equal(own.modelRouteAtStart.model,'test-model')
})
test('missing Host cwd fails closed for media, but ordinary source-code tasks are unaffected',async()=>{
  const e=engine();await assert.rejects(e.start('a','video-fixture',{}),/ISOLATION_CONTEXT_MISSING/)
  e.register({id:'coding',stages:[{id:'inspect',objective:'Inspect existing source'}]});await e.start('a','coding',{});assert.equal(e.status('a').isolation,null)
})
test('run cannot submit before preparing its allocated directory',async()=>{
  const e=engine();e.noteCaller(caller('a'));await e.start('a','video-fixture',{})
  await assert.rejects(e.submit('a',{stageId:'script'}),/WORKSPACE_NOT_PREPARED/)
})
test('runtime ownership, not evidence sidecar run_id, determines acceptance',async()=>{
  const e=engine(),a=await started(e,'a'),b=await started(e,'b')
  const status=await e.submit('a',{stageId:'script',evidence:{run_id:a.runId,production_manifest:'production.json'},runtimeChecks:[result(b,'narration')]})
  assert.equal(status.lastGate.passed,false);assert.match(status.lastGate.failures.join(' '),/RUN_OWNERSHIP_MISMATCH/)
})
test('a forged current owner does not make a foreign artifact path belong to this run',async()=>{
  const e=engine(),a=await started(e,'a'),r=result(a,'narration');r.bindings={old:{path:'/workspace/test/old/final.mp4',sha256:'2'.repeat(64),bytes:16}}
  const out=await e.submit('a',{stageId:'script',evidence:{production_manifest:'production.json'},runtimeChecks:[r]});assert.match(out.lastGate.failures.join(' '),/CROSS_RUN_PATH/)
})
test('byte-identical final from another run is rejected even at a new path',async()=>{
  const e=engine(),a=await started(e,'a');await script(e,'a',a);assert.equal((await e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]})).lastGate.passed,true)
  const b=await started(e,'b');await script(e,'b',b)
  const out=await e.submit('b',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(b,'video')]})
  assert.equal(out.lastGate.passed,false);assert.match(out.lastGate.failures.join(' '),/CROSS_RUN_DUPLICATE/)
})
test('legacy retained candidate hashes are checked without relabelling the old run',async()=>{
  const e=engine();e.hydrate({runs:{old:{id:'legacy-id',sessionId:'old',state:'completed',candidates:[{artifacts:{video:{binding:{path:'/old/final.mp4',sha256:'2'.repeat(64)}}}}]}}})
  const a=await started(e,'a');await script(e,'a',a);const out=await e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]})
  assert.match(out.lastGate.failures.join(' '),/CROSS_RUN_DUPLICATE/);assert.equal(e.runs.get('old').isolation,undefined)
})
test('same-run controlled repair preserves root, model facts and budget history',async()=>{
  const e=engine(),a=await started(e,'a');await script(e,'a',a)
  await e.repair('a','script','A concrete correction of the current full narration')
  assert.equal(e.status('a').isolation.root,a.root);assert.equal(e.status('a').run.selfRepairs,1)
})
test('known outputs from archived runs survive restarts',async()=>{
  const e=engine(),a=await started(e,'a');await script(e,'a',a);await e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]})
  await e.start('a','video-fixture',{});await prepare(e,'a')
  const restored=engine();restored.hydrate(e.snapshot());assert.equal(restored.knownOutputs('new-run').some(f=>f.runId===a.runId),true)
  assert.equal(restored.status('a').isolation.prepared,true)
})
test('user-registered prior digest blocks untracked legacy output',async()=>{
  const e=engine();await e.excludeHash(caller('a'),'2'.repeat(64));const a=await started(e,'a');await script(e,'a',a)
  const out=await e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]});assert.match(out.lastGate.failures.join(' '),/EXCLUDED_OUTPUT_HASH/)
})
test('new unrelated output passes and lineage is explicitly validation-time not generation attestation',async()=>{
  const e=engine(),a=await started(e,'a');await script(e,'a',a);await e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]})
  const report=e.report('a');assert.ok(report.artifactLineage.length);assert.equal(report.artifactLineage[0].creationAttested,false)
  assert.equal(report.artifactLineage[0].runId,a.runId);assert.match(report.provenanceLimit,/NOT proof/)
})
test('preparation and path guards use original Host pipeline, not a mutable global cwd',async()=>{
  const e=engine(),exec=caller('a');e.noteCaller(exec);await e.start('a','video-fixture',{})
  let manager,dispatched
  const ctx={tools:{execute:async input=>{
    dispatched=input;assert.equal(manager.isPreparation(input),true);assert.equal(manager.guard(input),undefined)
    const own=e.status('a').isolation
    return {isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{truncated:false,text:JSON.stringify({status:'pass',runId:own.runId,key:own.key,root:own.root,createdAtMs:1234,markerSha256:'1'.repeat(64)})}}}
  }}}
  manager=createIsolationManager(ctx,e);const out=await manager.prepare(exec)
  assert.equal(dispatched.parent,exec.token);assert.equal(dispatched.agent,exec.agent);assert.equal(dispatched.arguments.workdir,'/workspace/test')
  assert.equal(exec.agent.session.header.cwd,'/workspace/test')
  assert.match(manager.guard({...exec,name:'write',arguments:{file_path:'/workspace/test/final.mp4'}}),/RUN_OUTPUT_PATH/)
  assert.equal(manager.guard({...exec,name:'write',arguments:{file_path:join(out.workspace,'final','title.md')}}),undefined)
  assert.match(manager.guard({...exec,name:'bash',arguments:{command:'echo hi'}}),/RUN_WORKDIR_REQUIRED/)
  assert.equal(manager.guard({...exec,name:'bash',arguments:{command:'echo hi',workdir:out.workspace}}),undefined)
  assert.match(manager.guard({...exec,name:'read',arguments:{file_path:'/workspace/test/.dsh-runs/other/final.mp4'}}),/CROSS_RUN_READ/)
  assert.equal(manager.guard({...exec,name:'read',arguments:{file_path:'/srv/public-tools/README.md'}}),undefined)
  assert.match(manager.guard({...exec,name:'write',arguments:{file_path:join(out.workspace,'.dsh-run.json')}}),/RUN_MARKER_PROTECTED/)
})
test('denied preparation leaves the run unprepared, no fallback side effect',async()=>{
  const e=engine(),exec=caller('a');e.noteCaller(exec);await e.start('a','video-fixture',{})
  const manager=createIsolationManager({tools:{execute:async()=>({isError:true})}},e)
  await assert.rejects(manager.prepare(exec),/denied/);assert.equal(e.status('a').isolation.prepared,false)
})
test('Host validator command receives frozen run ownership, never evidence ownership',async()=>{
  const e=engine(),own=await started(e,'a'),exec=caller('a');let called
  const runner=createMediaRunner({tools:{execute:async value=>{called=value;return {isError:true}}}},e)
  await runner([{kind:'narration',pathKey:'production_manifest'}],{production_manifest:'production.json',isolation:{runId:'fake'}},exec)
  assert.equal(called.arguments.workdir,own.root);assert.equal(called.parent,exec.token)
  assert.ok(!called.arguments.command.includes('fake'))
})
test('failed state persistence does not leave an allocated run in memory',async()=>{
  const e=new IsolatedPlaybookEngine({persist:async()=>{throw new Error('disk full')}});e.register(book);e.noteCaller(caller('a'))
  await assert.rejects(e.start('a','video-fixture',{}),/disk full/);assert.equal(e.status('a').run,undefined)
})

test('concurrent identical candidates cannot both commit as independent runs',async()=>{
  const e=engine(),a=await started(e,'a'),b=await started(e,'b');await script(e,'a',a);await script(e,'b',b)
  const outcomes=await Promise.allSettled([
    e.submit('a',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(a,'video')]}),
    e.submit('b',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[result(b,'video')]})
  ])
  const committed=[e.status('a'),e.status('b')].filter(row=>row.run.state==='completed')
  assert.equal(committed.length,1)
  assert.ok(outcomes.some(row=>row.status==='rejected'||row.value?.lastGate?.passed===false))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { manifestPath } from '../src/artifact-paths.js'
import { WorkflowEngine } from '../src/workflow-ux.js'
import { createRuntimeRecovery, runtimeRecoveryPlan } from '../src/runtime-recovery.js'
import { createMediaRunner } from '../src/host-media.js'
import { ProjectLibrary } from '../src/project-library.js'
import { PlaybookRouter } from '../src/routing.js'
import { playbookDefinition } from '../src/tool.js'
import { usableController } from '../src/controller-ux.js'

// Anonymous contract fixtures, not a published user transcript or model output.
const workspace='/workspace/culture', key='01234567-0123-4123-8123-0123456789ab', root=`${workspace}/.dsh-runs/${key}`
const own={protocol:1,workspace,key,root,realRoot:root,runId:'run-one',prepared:true,markerSha256:'1'.repeat(64),createdAtMs:1,routesObserved:[]}
const doc={id:'legacy-video',version:'0.4.0',stages:[{id:'script',objective:'Freeze narration',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'narration',pathKey:'production_manifest'}]},retry:{maxAttempts:2},next:null}]}
const exec={agent:{id:'s',session:{header:{cwd:workspace}}},token:Symbol(),callId:'recover-one',signal:new AbortController().signal}
function fixture({legacy=false,persist}={}) {
  const engine=new WorkflowEngine({persist});engine.register(doc);engine.noteCaller(exec)
  const manifest=legacy?`${workspace}/episode-v2/production.json`:`${root}/work/production.json`
  const missing=`narration: Missing artifact: .dsh-runs/${key}/work/production.json`
  const failure=legacy?'Independent media check unavailable: No prepared run-owned artifact root; legacy runs require a fresh task, not adoption of old outputs':missing
  engine.runs.set('s',{id:'run-one',sessionId:'s',playbookId:doc.id,playbookVersion:legacy?'0.4.0':'0.7.0',playbookSnapshot:engine.getPlaybook(doc.id),
    state:legacy?'blocked':'failed',stageId:'script',stageEpoch:12,stageAttempt:2,revision:legacy?1:0,selfRepairs:1,formatRepairs:0,
    startedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T01:00:00Z',finishedAt:legacy?null:'2026-01-01T01:00:00Z',
    ...(legacy?{}:{isolation:{...own}}), input:{task:'Preserve the script and fix only the ending.'},
    evidence:{},observations:{},machineEvidence:{},revisions:legacy?[{revision:1,reason:'Fix this candidate ending.'}]:[],
    blocker:legacy?{kind:'prerequisite',reason:failure}:null,
    lastGate:{stageId:'script',passed:false,failures:[failure],recovery:{code:'manifest',exhausted:true}},
    recoveryCounts:{'0:script:manifest':3},
    candidates:legacy?[{artifacts:{bindings:{[manifest]:{path:manifest,sha256:'2'.repeat(64)}}}}]:[],
    history:[{type:'run_started'},{type:'gate_failed'},{type:'gate_failed'},...(legacy?[{type:'human_review_rejected'}]:[{type:'artifact_root_allocated'}])],
  })
  return {engine,manifest}
}
function harness(engine,{result,deny=false}={}) {
  const calls=[];let recovery
  const ctx={tools:{execute:async call=>{
    assert.equal(recovery.allows(call),true);calls.push(call)
    if(deny)return {isError:true}
    const run=engine.runs.get('s'),plan=runtimeRecoveryPlan(engine,'s'),path=plan.manifest??plan.scope.manifest
    const value={validatorVersion:'0.4.0',kind:'narration',status:'pass',passed:true,failures:[],manifestPath:path,
      narration:{scriptSha256:'3'.repeat(64)},bindings:{[path]:{path,sha256:'2'.repeat(64)}},
      ...(run.isolation?{ownership:{runId:run.id,root,markerSha256:own.markerSha256}}:{legacyContinuation:plan.scope}),...result}
    return {isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{truncated:false,text:JSON.stringify(value)}}}
  }}}
  recovery=createRuntimeRecovery(ctx,engine,async()=>{})
  return {recovery,calls}
}
for(const [form,path] of [['run-relative','work/production.json'],['workspace-relative',`.dsh-runs/${key}/work/production.json`],['dot-prefixed',`./.dsh-runs/${key}/work/production.json`],['absolute',`${root}/work/production.json`]])
  test(`manifest ${form} resolves once into the same current file`,()=>assert.equal(manifestPath(path,own).path,`${root}/work/production.json`))
for(const path of ['../production.json',`.dsh-runs/not-this-run/production.json`,`${workspace}/production.json`,'https://host/file.json',`work/../../production.json`])
  test(`manifest does not guess or escape: ${path}`,()=>assert.throws(()=>manifestPath(path,own)))

test('recorded path failure recovers after a real Host probe without clearing counters or passing the stage',async()=>{
  const {engine}=fixture(),before=structuredClone(engine.runs.get('s')),{recovery,calls}=harness(engine)
  const out=await recovery.recover(exec),after=engine.runs.get('s')
  assert.equal(out.recovered,true);assert.equal(out.notAGate,true);assert.equal(after.state,'active');assert.equal(after.stageId,'script')
  for(const field of ['id','input','candidates','revisions','selfRepairs','recoveryCounts','stageAttempt','startedAt'])assert.deepEqual(after[field],before[field])
  assert.deepEqual(after.history.slice(0,-1),before.history);assert.equal(after.lastGate.passed,false)
  assert.equal(after.history.at(-1).countersReset,false);assert.equal(after.history.at(-1).gatesBypassed,false)
  assert.equal(calls[0].parent,exec.token);assert.equal(calls[0].agent,exec.agent);assert.equal(calls[0].arguments.workdir,root)
  assert.equal(runtimeRecoveryPlan(engine,'s'),null)
  assert.equal((await recovery.recover(exec)).recovered,false)
})
test('actual invalid narration is not approved by adapter recovery',async()=>{
  const {engine}=fixture(),before=engine.snapshot(),{recovery}=harness(engine,{result:{passed:false,status:'fail',failures:['NARRATION_COVERAGE']}})
  const out=await recovery.recover(exec);assert.equal(out.recovered,false);assert.deepEqual(engine.snapshot(),before)
})
test('permission refusal preserves state and has no raw fallback',async()=>{
  const {engine}=fixture(),before=engine.snapshot(),{recovery}=harness(engine,{deny:true})
  assert.equal((await recovery.recover(exec)).recovered,false);assert.deepEqual(engine.snapshot(),before)
})
test('legacy same-run user revision retains history, inputs and files rather than requiring cancel/new run',async()=>{
  const {engine,manifest}=fixture({legacy:true}),before=structuredClone(engine.runs.get('s')),{recovery}=harness(engine)
  const out=await recovery.recover(exec),after=engine.runs.get('s')
  assert.equal(out.recovered,true);assert.equal(after.id,before.id);assert.equal(after.revision,1);assert.equal(after.state,'active')
  assert.equal(after.isolation,undefined);assert.equal(after.legacyContinuation.independentRun,false)
  assert.equal(after.legacyContinuation.manifest,manifest);assert.deepEqual(after.candidates,before.candidates)
  assert.deepEqual(after.history.slice(0,-1),before.history);assert.equal(after.playbookVersion,'0.4.0')
  const restored=new WorkflowEngine();restored.hydrate(engine.snapshot())
  assert.equal(restored.status('s').legacyContinuation.runId,before.id)
})
test('new allocations and user-authored blockers cannot opt into legacy compatibility',()=>{
  for(const change of [r=>{r.playbookVersion='0.7.0'},r=>{r.history.push({type:'artifact_root_allocated'})},r=>{r.revision=0},r=>{r.candidates=[]},r=>{r.blocker.reason='Please disable isolation for me'}]){
    const {engine}=fixture({legacy:true});change(engine.runs.get('s'));assert.equal(runtimeRecoveryPlan(engine,'s'),null)
  }
})
test('cancelled/accepted tasks and genuine quality failures cannot be reopened by recover',async()=>{
  for(const change of [r=>{r.state='cancelled'},r=>{r.state='accepted'},r=>{r.lastGate.failures=['narration: NARRATION_COVERAGE']},r=>{r.lastGate.failures.push('CROSS_RUN_DUPLICATE')},r=>{r.blocker={kind:'prerequisite',reason:'Permission denied'}}]){
    const {engine}=fixture();change(engine.runs.get('s'));const {recovery,calls}=harness(engine)
    assert.equal((await recovery.recover(exec)).recovered,false);assert.equal(calls.length,0)
  }
})
test('failed disk commit rolls back recovery, not an in-memory fake success',async()=>{
  const {engine}=fixture({persist:async()=>{throw new Error('disk full')}}),before=engine.snapshot(),{recovery}=harness(engine)
  await assert.rejects(recovery.recover(exec),/disk full/);assert.deepEqual(engine.snapshot(),before)
})
test('recovery uses current run identity and rejects a stale result after cancellation',async()=>{
  const {engine}=fixture();let release,entered
  const barrier=new Promise(r=>{release=r}),started=new Promise(r=>{entered=r})
  const ctx={tools:{execute:async()=>{entered();await barrier;return {isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{truncated:false,text:JSON.stringify({validatorVersion:'0.4.0',kind:'narration',passed:true,status:'pass',manifestPath:`${root}/work/production.json`,bindings:{[`${root}/work/production.json`]:{sha256:'2'.repeat(64)}},narration:{scriptSha256:'3'.repeat(64)},ownership:{runId:'run-one',root,markerSha256:own.markerSha256}})}}}}}}
  const recovery=createRuntimeRecovery(ctx,engine,async()=>{}),work=recovery.recover(exec)
  await started;await engine.cancel('s');release();await assert.rejects(work,/STALE_RECOVERY/);assert.equal(engine.runs.get('s').state,'cancelled')
})
test('outer status surfaces recover, not a demand to clear state',async()=>{
  const {engine}=fixture(),{recovery}=harness(engine)
  const def={description:'fixture',parameters:{action:{enum:['status','route']}},execute:async()=>({ok:true,status:engine.status('s')})}
  const tool=usableController(recovery.wrap(def),engine),status=await tool.execute({action:'status'},exec)
  assert.equal(status.nextAction,'recover')
  const route=await tool.execute({action:'route'},exec);assert.equal(route.recovered,true);assert.equal(route.nextAction,'execute_current_stage')
})
test('media runner normalizes manifest at the Host boundary, not by searching for an existing file',async()=>{
  const {engine}=fixture();engine.runs.get('s').state='active';let request
  const runner=createMediaRunner({tools:{execute:async call=>{request=call;return {isError:true}}}},engine)
  await runner([{kind:'narration',pathKey:'production_manifest'}],{production_manifest:`.dsh-runs/${key}/work/production.json`},exec)
  const payload=request.arguments.command.match(/'([A-Za-z0-9+/=]+)'$/)[1]
  assert.equal(JSON.parse(Buffer.from(payload,'base64')).manifest,`${root}/work/production.json`)
})
test('intake source_paths uses actual paged read receipts without inventing IDs',async()=>{
  const engine=new WorkflowEngine(),router=new PlaybookRouter(engine),p=new ProjectLibrary(engine,router);router.projects=p
  router.remember('s','按 task.md 制作道家文化视频');p.capture('s','按 task.md 制作道家文化视频')
  for(const n of [1,2])p.observeRead({...exec,name:'read',callId:`read-${n}`},{isError:false,value:{path:`${workspace}/task.md`,offset:n,totalLines:2,lines:[{number:n,text:n===1?'文化任务':'保留完整台词'}]}})
  const intake=await p.intake(exec,{project_id:'culture',requirements:['保留完整台词'],source_paths:['task.md']})
  assert.deepEqual(intake.sources.map(r=>r.callId),['read-1','read-2'])
  await assert.rejects(p.intake(exec,{project_id:'culture',requirements:['真实要求'],source_paths:['unknown.md']}),/No current read/)
})
test('unknown read IDs return actual choices for Agent correction, not a user cancellation request',async()=>{
  const engine=new WorkflowEngine(),router=new PlaybookRouter(engine),p=new ProjectLibrary(engine,router)
  router.remember('s','按 task.md 制作道家文化视频');p.capture('s','按 task.md 制作道家文化视频')
  p.observeRead({...exec,name:'read',callId:'actual-read'},{isError:false,value:{path:`${workspace}/task.md`,offset:1,totalLines:1,lines:[{number:1,text:'保留真实脚本。'}]}})
  const tool=usableController(playbookDefinition(engine,async()=>[],router,async()=>{},undefined,undefined,p),engine)
  const out=await tool.execute({action:'intake',project_id:'culture',requirements:['保留脚本'],source_call_ids:['invented-id']},exec)
  assert.equal(out.ok,false);assert.equal(out.availableReads[0].callId,'actual-read');assert.equal(out.nextAction,'retry_intake_with_observed_source_paths');assert.equal(engine.runs.size,0)
})

test('established legacy continuation does not re-probe on every subsequent stage or revision', async()=>{
  const {engine}=fixture({legacy:true}),{recovery,calls}=harness(engine)
  await recovery.recover(exec)
  const run=engine.runs.get('s');run.stageId='produce';run.revision=2
  assert.equal(runtimeRecoveryPlan(engine,'s'),null)
  assert.equal((await recovery.recover(exec)).recovered,false);assert.equal(calls.length,1)
})

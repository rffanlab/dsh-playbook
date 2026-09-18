import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { install } from '../src/host.js'
import { createArtifactDelivery } from '../src/artifact-delivery.js'
import { DeliveryEngine, candidateArtifacts, candidateKey } from '../src/delivery-engine.js'
const execute=promisify(execFile)
const sha=value=>createHash('sha256').update(value).digest('hex')
const fixtureBook={id:'delivery-fixture',stages:[{id:'produce',objective:'Assemble current output',gate:{evidence:['done']}},
 {id:'qa',objective:'Read actual fixtures',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'video',pathKey:'production_manifest'}]},next:null}],
 delivery:{review:true,revisionStage:'produce',repairStages:['produce','qa'],maxSelfRepairs:2}}
async function host(t,{deny,alterPresent}={}) {
 const workspace=await mkdtemp(join(tmpdir(),'artifact-host-')),events=[],guards=[],listeners=new Map(),definitions=new Map()
 let number=0
 const ctx={tools:{register:d=>definitions.set(d.name,d),guard:f=>guards.push(f),execute:async input=>{
  const exec={...input,token:Symbol(),rootCallId:input.rootCallId??input.callId,deferContext:()=>{}}
  await listeners.get('tools/pre-execute')?.(exec,async()=>({kind:'allow'}))
  const denial=deny?.(exec)??guards.map(g=>g(exec)).find(Boolean)
  let out
  if(denial)out={isError:true,error:{message:denial,info:{code:'DENIED'}}}
  else if(exec.name==='bash'){
   try {const r=await execute('bash',['-c',exec.arguments.command],{cwd:exec.arguments.workdir??workspace,timeout:30000,maxBuffer:2**20,signal:exec.signal});out={isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{text:r.stdout,truncated:false}}}}
   catch(e){out={isError:false,value:{kind:'foreground',exitCode:Number.isInteger(e.code)?e.code:1,signal:e.signal??null,aborted:false,timedOut:false,stdout:{text:e.stdout??'',truncated:false}}}}
  } else if(exec.name==='present') {events.push({type:'present',arguments:exec.arguments});out={isError:false,value:{turn:1,files:alterPresent?alterPresent(exec.arguments.files):exec.arguments.files}}}
  else {try{out={isError:false,value:await definitions.get(exec.name).execute(exec.arguments,exec)}}catch(e){out={isError:true,error:{message:e.message,info:{code:e.code??'ERROR'}}}}}
  listeners.get('tools/result')?.(exec,out)
  return out
 }},systemPrompt:{section:()=>{}},commands:{register:()=>{}},on:(n,f)=>listeners.set(n,f),effect:()=>{},inject:(_n,fn)=>fn(ctx),provide:()=>{}}
 const engine=install(ctx,{define:d=>d,message:p=>({id:'notice',...p}),paths:{directory:join(workspace,'sops'),state:join(workspace,'state.json')}})
 const agent={id:'s',session:{header:{cwd:workspace}},options:{provider:'fixture',model:'not-a-live-model'}},signal=new AbortController().signal
 const call=async args=>{
  const r=await ctx.tools.execute({name:'playbook',callId:`p-${++number}`,agent,signal,arguments:args})
  assert.equal(r.isError,false,JSON.stringify(r.error));return r.value
 }
 await call({action:'list'});engine.register(fixtureBook);await call({action:'start',playbook_id:'delivery-fixture'})
 const root=engine.status('s').isolation.realRoot
 t.after(async()=>{await engine.queue;await execute('chmod',['-R','u+w',workspace]);await rm(workspace,{recursive:true,force:true})})
 return {ctx,engine,call,root,agent,signal,events,guards,workspace,listeners}
}
async function build(h,value='new production bytes') {
 return h.call({action:'build',command:`python3 -c ${JSON.stringify("from pathlib import Path; Path('final/final.mp4').write_text("+JSON.stringify(value)+")")}`,
  output_paths:['final/final.mp4']})
}
async function candidate(h,{witness=true}={}) {
 if(witness)assert.equal((await build(h)).ok,true)
 else await writeFile(join(h.root,'final/final.mp4'),'new production bytes')
 const texts={'brief/script.txt':'Full approved script.','final/title.md':'Actual fixture title','final/cover.png':'synthetic cover bytes','final/captions.srt':'fixture subtitles'}
 for(const [name,text] of Object.entries(texts)) await writeFile(join(h.root,name),text)
 const manifest={schemaVersion:1,script:'brief/script.txt',segments:[{id:'s',text:'Full approved script.'}],video:'final/final.mp4',cover:'final/cover.png',title:'final/title.md',subtitles:'final/captions.srt'}
 await writeFile(join(h.root,'production.json'),JSON.stringify(manifest))
 const bindings={}
 for(const name of [...Object.keys(texts),'final/final.mp4','production.json']){const p=join(h.root,name),bytes=await readFile(p);bindings[p]={path:p,bytes:bytes.length,sha256:sha(bytes)}}
 const v=bindings[join(h.root,'final/final.mp4')], own=h.engine.status('s').isolation
 const checks={validatorVersion:'0.4.0',kind:'video',status:'pass',passed:true,bindings,manifestPath:join(h.root,'production.json'),
  narration:{scriptSha256:'script',segmentSha256:'segment'},video:{binding:v,durationSeconds:1},cover:bindings[join(h.root,'final/cover.png')],
  ownership:{runId:own.runId,key:own.key,root:own.realRoot,markerSha256:own.markerSha256,createdAtMs:own.createdAtMs}}
 const r=h.engine.runs.get('s');r.state='awaiting_review';r.stageId='qa';r.stageEpoch++
 r.machineEvidence={qa:[checks]};r.candidates=[{at:new Date().toISOString(),revision:0,state:'awaiting_review',artifacts:{video:checks.video,cover:checks.cover,bindings}}]
 await h.engine.serialize(()=>h.engine.save())
 return {checks,bindings,video:v}
}

test('real command records before/after output and no-op cannot claim an existing final',async t=>{
 const h=await host(t);const first=await build(h);assert.equal(first.ok,true);assert.equal(h.engine.runs.get('s').productionWitnesses.length,1)
 const same=await h.call({action:'build',command:'true',output_paths:['final/final.mp4']});assert.equal(same.reusedSameRunWitness,true)
 await writeFile(join(h.root,'final/foreign.mp4'),'previous bytes')
 const no=await h.call({action:'build',command:'true',output_paths:['final/foreign.mp4']});assert.equal(no.ok,false);assert.equal(no.error.code,'NO_NEW_PRODUCTION')
 assert.equal(h.engine.runs.get('s').productionWitnesses.length,1)
})
test('nonzero assembly never registers the leftover file as successful production',async t=>{
 const h=await host(t)
 const out=await h.call({action:'build',command:'printf leftover > final/final.mp4; exit 2',output_paths:['final/final.mp4']})
 assert.equal(out.ok,false);assert.equal(h.engine.runs.get('s').productionWitnesses,undefined);assert.match(out.hostFailure.message,/2/)
})
test('external Host denial of actual build command is preserved',async t=>{
 const h=await host(t,{deny:e=>e.name==='bash'&&e.arguments.command==='DENY_TEST'?'host test denial':undefined})
 const out=await h.call({action:'build',command:'DENY_TEST',output_paths:['final/final.mp4']})
 assert.equal(out.ok,false);assert.equal(out.hostFailure.code,'DENIED');assert.equal(h.engine.runs.get('s').productionWitnesses,undefined)
})
test('new video Gate refuses a current-root file without observed assembly even with self-reported passed=true',async t=>{
 const h=await host(t),{checks}=await candidate(h,{witness:false}),r=h.engine.runs.get('s')
 r.state='active';r.candidates=[];r.machineEvidence={script:[{...checks,kind:'narration'}]}
 const out=await h.engine.submit('s',{stageId:'qa',evidence:{production_manifest:checks.manifestPath},runtimeChecks:[checks]})
 assert.equal(out.lastGate.passed,false);assert.match(out.lastGate.failures.join(' '),/PRODUCTION_NOT_WITNESSED/)
})
test('wrong-run raw present is denied instead of exposing old final after successful QA',async t=>{
 const h=await host(t);await candidate(h)
 const out=await h.ctx.tools.execute({name:'present',callId:'wrong',agent:h.agent,signal:h.signal,arguments:{files:[{path:join(h.workspace,'old/final.mp4')}]}})
 assert.equal(out.isError,true);assert.match(out.error.message,/DELIVERY_WRONG_RUN/);assert.equal(h.events.length,0)
})
test('raw current final also uses registry handoff, while current-root non-video previews stay available',async t=>{
 const h=await host(t);await candidate(h)
 const wrong=await h.ctx.tools.execute({name:'present',callId:'raw',agent:h.agent,signal:h.signal,arguments:{files:[{path:join(h.root,'final/final.mp4')}]}})
 assert.equal(wrong.isError,true);assert.match(wrong.error.message,/USE_VERIFIED/)
 const preview=await h.ctx.tools.execute({name:'present',callId:'preview',agent:h.agent,signal:h.signal,arguments:{files:[{path:join(h.root,'work/example.png')}]}})
 assert.equal(preview.isError,false)
})
test('deliver uses artifact identities, actual bytes and private copies; later working-file overwrite cannot alter attachment',async t=>{
 const h=await host(t);const {video}=await candidate(h)
 const out=await h.call({action:'deliver'});assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.delivered,true)
 const attachment=out.files.find(f=>f.role==='video')
 assert.notEqual(attachment.path,video.path);assert.ok(attachment.path.includes('/.deliveries/'));assert.equal(attachment.sha256,video.sha256)
 assert.equal(sha(await readFile(attachment.path)),video.sha256);assert.equal(h.events.length,1)
 await writeFile(video.path,'overwritten source')
 assert.equal(sha(await readFile(attachment.path)),video.sha256)
 assert.equal(h.engine.status('s').run.state,'awaiting_review');assert.equal(h.engine.report('s').deliveries.at(-1).state,'presented')
 assert.equal(h.engine.report('s').artifactRegistry.find(f=>f.role==='video').producer,h.engine.runs.get('s').productionWitnesses[0].id)
})
test('source changed after QA fails before any present event; no file-name fallback',async t=>{
 const h=await host(t),{video}=await candidate(h);await writeFile(video.path,'older bytes copied here')
 const out=await h.call({action:'deliver'});assert.equal(out.ok,false);assert.match(out.error.message,/DELIVERY_BYTES_CHANGED/);assert.equal(h.events.length,0)
})
test('known old hash pasted into fresh run is refused after actual copying command',async t=>{
 const h=await host(t);await h.engine.excludeHash({agent:h.agent},sha('known old bytes'),'Synthetic prior baseline')
 const out=await build(h,'known old bytes');assert.equal(out.ok,false);assert.match(out.error.message,/CROSS_RUN_DUPLICATE/)
 assert.equal(h.engine.runs.get('s').productionWitnesses,undefined)
})
test('Host present rejection keeps prepared snapshot, retry does not redo production',async t=>{
 let blocked=true
 const h=await host(t,{deny:e=>e.name==='present'&&blocked?'host present denial':undefined});await candidate(h)
 const out=await h.call({action:'deliver'});assert.equal(out.ok,false);const record=h.engine.runs.get('s').deliveries.at(-1);assert.equal(record.state,'prepared')
 blocked=false;const retry=await h.call({action:'deliver'});assert.equal(retry.ok,true);assert.equal(retry.deliveryId,record.id);assert.equal(h.engine.runs.get('s').productionWitnesses.length,1)
})
test('unexpected native presented path is not recorded as verified delivery',async t=>{
 const h=await host(t,{alterPresent:()=>[{path:'/old/final.mp4'}]});await candidate(h)
 const out=await h.call({action:'deliver'});assert.equal(out.ok,false);assert.equal(h.engine.runs.get('s').deliveries.at(-1).state,'prepared')
})
test('ordinary non-media tasks with media file names are not given production requirements',async()=>{
 const e=new DeliveryEngine();e.register({id:'code',stages:[{id:'edit',objective:'Fix fixture code'}]});await e.start('s','code',{})
 const m=createArtifactDelivery({tools:{}},e)
 assert.equal(m.guard({agent:{id:'s'},name:'present',arguments:{files:[{path:'/project/test/final.mp4'}]}}),undefined)
 assert.equal(e.status('s').artifactDelivery,undefined)
})
test('candidate ids persist across reload and known digest ledger survives archive pruning',async t=>{
 const h=await host(t);const {video}=await candidate(h);const before=candidateArtifacts(h.engine.runs.get('s'))
 const fresh=new DeliveryEngine();fresh.hydrate(h.engine.snapshot());assert.deepEqual(candidateArtifacts(fresh.runs.get('s')),before)
 fresh.runs.clear();fresh.archives.clear();assert.ok(fresh.knownOutputs('new').some(f=>f.sha256===video.sha256))
})
test('approved old snapshots can be delivered with explicitly absent witness, without inventing production',async t=>{
 const h=await host(t);await candidate(h,{witness:false});delete h.engine.runs.get('s').deliveryPolicy
 const out=await h.call({action:'deliver'});assert.equal(out.ok,true);assert.equal(h.engine.report('s').artifactRegistry.find(a=>a.role==='video').producer,null)
})

test('changing a dummy output cannot register an unchanged untracked final',async t=>{
 const h=await host(t);await writeFile(join(h.root,'final/old.mp4'),'untracked old content')
 const out=await h.call({action:'build',command:'printf new > final/dummy.txt',output_paths:['final/old.mp4','final/dummy.txt']})
 assert.equal(out.ok,false);assert.equal(out.error.code,'NO_NEW_PRODUCTION');assert.equal(h.engine.runs.get('s').productionWitnesses,undefined)
})

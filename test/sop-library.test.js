import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { PlaybookEngine } from '../src/engine.js'
import { normalizePlaybook, evaluateGate } from '../src/core.js'
import { PlaybookRouter } from '../src/routing.js'
import { playbookDefinition } from '../src/tool.js'
import { toolReceipt } from '../src/receipts.js'
function evidenceFor(stage) {
  return Object.fromEntries(stage.gate.evidence.map(r=>[r.key,Object.hasOwn(r,'equals')?r.equals:r.type==='array'?['fixture evidence']:r.type==='boolean'?true:r.type==='number'?1:r.type==='object'?{fixture:true}:'Fixture evidence for state-machine tests only.']))
}
test('19 unique built-in SOPs',()=>{assert.equal(BUILTIN_PLAYBOOKS.length,19);assert.equal(new Set(BUILTIN_PLAYBOOKS.map(p=>p.id)).size,19)})
for(const raw of BUILTIN_PLAYBOOKS)test(`SOP contracts and reachable completion: ${raw.id}`,async()=>{
  const p=normalizePlaybook(raw),e=new PlaybookEngine();e.register(p);await e.start('s',p.id)
  assert.ok(p.stages.length>=4)
  for(const s of p.stages){assert.ok(s.instructions.length);assert.ok(s.gate.evidence.length>=2);assert.equal(evaluateGate(s,{}).passed,false)}
  let n=0
  while(e.activeRun('s')&&n++<20){const s=e.currentStage('s');for(const t of s.gate.observedTools){for(let i=0;i<Math.max(t.minCalls??0,t.minSuccesses??0);i++)await e.observeTool('s',{name:t.name,isError:false})}
    const evidence=evidenceFor(s)
    for(const rule of s.gate.toolResults??[]){
      evidence[rule.callIdKey]='fixture-call'; evidence[rule.commandKey]='npm test';
      const exec={name:rule.name,callId:'fixture-call',arguments:{command:'npm test'}}
      await e.observeTool('s',{name:rule.name,callId:exec.callId,isError:false,receipt:toolReceipt(exec,{isError:false,value:{kind:'foreground',exitCode:0,signal:null,timedOut:false,aborted:false}})})
    }
    await e.submit('s',{stageId:s.id,evidence})}
  assert.equal(e.status('s').run.state,'completed') // Synthetic fixtures validate contracts, not real task quality.
})
test('canonical tool outputs contain no undefined fields and required stage ids are enforced',async()=>{
  const e=new PlaybookEngine();for(const p of BUILTIN_PLAYBOOKS)e.register(p)
  const r=new PlaybookRouter(e),t=playbookDefinition(e,async()=>e.listPlaybooks(),r),exec={agent:{id:'s'},signal:new AbortController().signal}
  for(const args of [{action:'list'},{action:'inspect',playbook_id:'dsh-plugin-development'},{action:'route',task:'修复接口bug'},{action:'status'}]){
    const out=await t.execute(args,exec);assert.deepEqual(out,JSON.parse(JSON.stringify(out)))
  }
  await assert.rejects(t.execute({action:'submit',evidence:{}},exec),/stage_id/)
})
test('failed durable writes roll back selection',async()=>{
  const e=new PlaybookEngine({persist:async()=>{throw new Error('disk full')}});e.register(BUILTIN_PLAYBOOKS[0])
  await assert.rejects(e.start('s','bug-fix'),/disk full/);assert.equal(e.activeRun('s'),undefined)
})
test('total submission budget stops branch cycles',async()=>{
  const e=new PlaybookEngine({maxSubmissions:2});e.register({id:'loop',stages:[{id:'a',objective:'Test a bounded loop',gate:{evidence:['ok']},next:'a'}]})
  await e.start('s','loop');for(let i=0;i<3;i++)await e.submit('s',{evidence:{ok:true}})
  assert.equal(e.status('s').run.state,'failed');assert.match(e.status('s').lastGate.failures[0],/budget/)
})
test('late tool results cannot count toward a different stage',async()=>{
  const e=new PlaybookEngine();e.register(BUILTIN_PLAYBOOKS[0]);await e.start('s','bug-fix');const run=e.activeRun('s'),old={runId:run.id,stageId:run.stageId,attempt:1}
  await e.submit('s',{evidence:evidenceFor(e.currentStage('s'))});await e.observeTool('s',{...old,name:'bash',isError:false})
  assert.deepEqual(e.status('s').observations,{})
})
test('tool observations from an earlier visit of the same stage are rejected',async()=>{
  const e=new PlaybookEngine();e.register({id:'loop',stages:[{id:'a',objective:'Same-stage revisit',gate:{evidence:['ok']},next:'a'}]})
  await e.start('s','loop');const run=e.activeRun('s'),old={runId:run.id,stageId:run.stageId,attempt:run.stageAttempt,epoch:run.stageEpoch}
  await e.submit('s',{evidence:{ok:true}});await e.observeTool('s',{...old,name:'bash',isError:false})
  assert.deepEqual(e.status('s').observations,{})
})
test('aborting while queued prevents a delayed start',async()=>{
  const e=new PlaybookEngine();e.register(BUILTIN_PLAYBOOKS[0]);let unlock;const barrier=new Promise(resolve=>{unlock=resolve})
  const blocking=e.serialize(()=>barrier),c=new AbortController(),pending=e.start('s','bug-fix',{}, {signal:c.signal});c.abort();unlock();await blocking
  await assert.rejects(pending);assert.equal(e.runs.size,0)
})
test('runs started in the same clock tick still have distinct identities',async()=>{
  const e=new PlaybookEngine({clock:()=>1000});e.register(BUILTIN_PLAYBOOKS[0]);await e.start('s','bug-fix');const first=e.activeRun('s').id
  await e.cancel('s');await e.start('s','bug-fix');assert.notEqual(e.activeRun('s').id,first)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowEngine } from '../src/workflow-ux.js'
import { PlaybookEngine } from '../src/engine.js'
import { reviewFeedback } from '../src/run-control.js'
import { usableController, normalizeAction, compactStatus } from '../src/controller-ux.js'
import { playbookDefinition } from '../src/tool.js'
import { PlaybookRouter } from '../src/routing.js'
import { installAutoRouting } from '../src/automation.js'
import { createMediaDiagnostics } from '../src/media-diagnostics.js'

const stage = (id, kind) => ({id,objective:id,gate:{evidence:[{key:'production_manifest',type:'string'}],...(kind?{validators:[{kind,pathKey:'production_manifest'}]}:{})},retry:{maxAttempts:2,onExhausted:'branch:produce'}})
const book={id:'fixture',delivery:{review:true,revisionStage:'diagnose',maxRevisions:2,maxSelfRepairs:3,repairStages:['script','pilot','produce','qa','content-review']},
  stages:[stage('script','narration'),stage('pilot','pilot'),stage('produce'),stage('qa','video'),stage('content-review'),{...stage('handoff','handoff'),next:null},{...stage('diagnose'),next:'script'}]}
const clone=v=>structuredClone(v)
const check=(kind,extra={})=>({validatorVersion:'0.4.0',kind,passed:true,status:'pass',failures:[],bindings:{'/workspace/final.mp4':{path:'/workspace/final.mp4',sha256:'file',bytes:42}},narration:{scriptSha256:'full',segmentSha256:'segments'},video:{binding:{path:'/workspace/final.mp4',sha256:'file'}},...extra})
const ev={production_manifest:'production.json'}
async function fixture(until='qa') {
  const e=new WorkflowEngine();e.register(book)
  // Legacy pinned fixture: runtime bug fixes are tested without inventing new run ownership.
  const base=new PlaybookEngine();base.register(book);await base.start('s','fixture');e.hydrate(base.snapshot())
  await advance(e,until);return e
}
async function advance(e,until) {
  for(let i=0;i<12&&e.activeRun('s')&&e.currentStage('s').id!==until;i++){
    const s=e.currentStage('s');await e.submit('s',{stageId:s.id,evidence:ev,runtimeChecks:s.gate.validators.map(v=>check(v.kind))})
  }
}
function controller(e) {const r=new PlaybookRouter(e);return usableController(playbookDefinition(e,async()=>[],r),e)}
const exec={agent:{id:'s'},signal:new AbortController().signal}

test('long actual-review shape with conditional examples is not discarded',()=>{
  const text='Synthetic episode · Final Human Review\n结论：REVISE_ONCE / DO_NOT_PUBLISH_YET\n'+('具体修改建议，保留自然语速。\n'.repeat(180))+'如果遇到轻微问题，只尝试一次。\n按 §22 执行修订。'
  assert.ok(text.length>1600);assert.equal(reviewFeedback(text),'reject')
})
for(const text of ['打回当前候选，按 §22 做 v2','退回当前成片，请自行修订','最终成片验收不通过，请返修','按音频长度重做 v3 收尾'])
  test(`recognize direct revision cue: ${text}`,()=>assert.equal(reviewFeedback(text),'reject'))
for(const text of ['如果验收不通过怎么办','日志里他说：打回当前候选','帮我写一个 Final Human Review 示例\n结论：REVISE_ONCE','```\n打回当前候选\n```','> 打回当前候选','如何处理验收不通过？','分析下面的日志\nFinal Human Review\n结论：REVISE_ONCE','Summarize this review\nFinal Human Review\nVERDICT: REJECT'])
  test(`do not authorize from quotation/example: ${text.slice(0,24)}`,()=>assert.equal(reviewFeedback(text),null))
test('accept still requires an unambiguous direct user acceptance',()=>{
  assert.equal(reviewFeedback('验收通过'),'accept');assert.equal(reviewFeedback('验收通过，但暂时不接受这版'),null)
})
test('pre-step keeps the same run after a long user review; no cancel/start ceremony',async()=>{
  const e=await fixture();await advance(e,null);const before=e.status('s').run.id
  let hook;const r=new PlaybookRouter(e),ctx={on:(_n,f)=>{hook=f},tools:{guard:()=>{}}}
  installAutoRouting(ctx,e,r,{createMessage:p=>({id:'notice',...p})})
  const text='Final Human Review\n结论：REVISE_ONCE / DO_NOT_PUBLISH_YET\n'+('已给出明确修订，不要加速语音。\n'.repeat(160))+'\n如果只是装饰问题，不必返工。'
  const m={id:'review-1',source:{kind:'user'},content:[{type:'text',text}]},agent={id:'s',session:{header:{}}}
  await hook({agent,messages:[m],signal:exec.signal},async()=>({kind:'enter',messages:[m]}))
  const after=e.status('s');assert.equal(after.run.id,before);assert.equal(after.run.stageId,'diagnose');assert.equal(after.run.revision,1)
  assert.ok(e.report('s').revisions[0].reason.includes('装饰问题'))
  await hook({agent,messages:[m],signal:exec.signal},async()=>({kind:'enter',messages:[m]}));assert.equal(e.status('s').run.revision,1)
})
test('diagnosis/target_stage_id are accepted losslessly instead of a misleading missing-diagnosis error',async()=>{
  const e=await fixture(),t=controller(e)
  const out=await t.execute({action:'repair',target_stage_id:'script',diagnosis:'The current script changed and its exact text mapping must be rechecked.'},exec)
  assert.equal(out.status.run.stageId,'script');assert.equal(out.argumentCorrections.length,2)
  assert.equal(e.report('s').summary.selfRepairs,1)
})
test('conflicting aliases fail before changing the run',async()=>{
  const e=await fixture(),before=e.snapshot()
  await assert.rejects(controller(e).execute({action:'repair',stage_id:'script',target_stage_id:'qa',note:'Actual diagnosis here'},exec),/Conflicting/)
  assert.deepEqual(e.snapshot(),before)
  assert.equal(normalizeAction({action:'block',reason:'The service is not available'}).args.note,'The service is not available')
})
test('missing stage exposes the exact current-stage contract without advancing or fabricating evidence',async()=>{
  const e=await fixture(),out=await controller(e).execute({action:'submit',evidence:{}},exec)
  assert.equal(out.ok,false);assert.equal(out.current_stage_id,'qa');assert.equal(e.status('s').run.stageAttempt,1)
  assert.ok(out.required_evidence.length)
})
test('NARRATION_STALE immediately recovers script, not produce/qa; old accepted facts are invalidated',async()=>{
  const e=await fixture(),out=await e.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[check('video',{narration:{scriptSha256:'changed',segmentSha256:'changed'}})]})
  assert.equal(out.lastGate.passed,false);assert.equal(out.run.stageId,'script');assert.equal(out.recovery.target,'script')
  assert.equal(out.machineEvidence.script,undefined);assert.equal(e.report('s').summary.dependencyRecoveries,1)
  // Existing unchanged files are not regenerated by the engine. New script must pass its actual gate.
  await advance(e,null);assert.equal(e.status('s').run.state,'awaiting_review')
})
test('a stale handoff goes to qa on first failure, without making the model resubmit twice',async()=>{
  const e=await fixture('handoff');const bad=check('handoff');bad.bindings['/workspace/final.mp4'].sha256='new'
  const out=await e.submit('s',{stageId:'handoff',evidence:ev,runtimeChecks:[bad]})
  assert.equal(out.run.stageId,'qa');assert.equal(out.recovery.code,'qa-stale');assert.equal(out.machineEvidence.qa,undefined)
})
test('caption correction stays at qa without consuming a full production repair',async()=>{
  const e=await fixture();const bad=check('video',{passed:false,status:'fail',failures:['SUBTITLE_COVERAGE: missing an actual word']})
  const out=await e.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[bad]})
  assert.equal(out.run.stageId,'qa');assert.ok(out.machineEvidence.script);assert.ok(out.machineEvidence.pilot)
  assert.equal(out.run.selfRepairs,0);assert.equal(out.lastGate.passed,false)
})
test('repeated dependency corrections have a finite budget and never forge a pass',async()=>{
  const e=await fixture();const bad=check('video',{passed:false,status:'fail',failures:['SUBTITLE_COVERAGE: still missing a word']})
  for(let i=0;i<4;i++)await e.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[bad]})
  assert.equal(e.status('s').run.state,'failed');assert.equal(e.status('s').lastGate.recovery.exhausted,true)
})
test('read-only presentation/inspection is available while edits and arbitrary shell remain governed',async()=>{
  const e=await fixture();await advance(e,null)
  for(const name of ['present','read','read_image','job_output'])assert.equal(e.policyDecision('s',name),undefined)
  assert.ok(e.policyDecision('s','write'));assert.match(e.policyDecision('s','bash'),/diagnose/)
})
test('compact status avoids replaying full task/history; detail=full remains available',async()=>{
  const e=await fixture();e.runs.get('s').input.task='Private task '.repeat(20000)
  const t=controller(e),small=await t.execute({action:'status'},exec),full=await t.execute({action:'status',detail:'full'},exec)
  assert.ok(JSON.stringify(small).length<12000);assert.ok(full.status.input.task.length>200000)
  assert.equal(small.status.stage.id,'qa');assert.equal(small.status.acceptedEvidenceKeys.includes('script'),true)
})
test('large pilot activity produces an advisory, not an automatic stop or more approvals',async()=>{
  const e=await fixture('pilot');e.runs.get('s').observations.bash={calls:100,successes:100,failures:0}
  const s=e.status('s');assert.match(s.activity.notice,/ONE complete natural segment/);assert.equal(s.active,true)
})
test('candidate diagnosis runs a fixed read-only command through Host policies and cannot revise or accept',async()=>{
  const e=await fixture();await advance(e,null);let d,request
  const diagExec={...exec,agent:{id:'s',session:{header:{cwd:'/workspace'}}},token:Symbol(),callId:'diagnostic-call',deferContext:()=>{}}
  d=createMediaDiagnostics({tools:{execute:async input=>{
    request=input;assert.equal(d.allows(input),true)
    assert.equal(d.allows({...input,arguments:{...input.arguments,command:'rm -rf .'}}),false)
    return {isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{truncated:false,text:JSON.stringify({validatorVersion:'0.4.0',passed:false,status:'fail',failures:['audio zero'],video:{binding:{path:'/workspace/final.mp4',sha256:'file'},durationSeconds:4,audio:{allZero:true}}})}}}
  }}},e)
  const before=e.snapshot();const out=await d.diagnose(diagExec)
  assert.equal(out.notAGate,true);assert.equal(out.readOnly,true);assert.equal(out.measurements.audio.allZero,true)
  assert.equal(request.parent,diagExec.token);assert.equal(request.signal,diagExec.signal)
  assert.deepEqual(e.snapshot(),before)
})
test('denied read-only diagnosis never falls back to raw fs or shell',async()=>{
  const e=await fixture();await advance(e,null)
  const d=createMediaDiagnostics({tools:{execute:async()=>({isError:true})}},e)
  await assert.rejects(d.diagnose({...exec,agent:{id:'s',session:{header:{cwd:'/workspace'}}},token:Symbol(),callId:'d'}),/denied/)
})

test('failed persistence rolls back dependency recovery and all its counters',async()=>{
  const e=await fixture(),before=e.snapshot();e.persist=async()=>{throw new Error('disk unavailable')}
  await assert.rejects(e.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[check('video',{narration:{scriptSha256:'changed',segmentSha256:'changed'}})]}),/disk unavailable/)
  assert.deepEqual(e.snapshot(),before)
})
test('automatic recovery cannot exceed the global gate budget or repair an ownership failure',async()=>{
  const e=await fixture();e.maxSubmissions=4
  const out=await e.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[check('video',{passed:false,status:'fail',failures:['SUBTITLE_COVERAGE: missing a word']})]})
  assert.equal(out.run.state,'failed');assert.equal(out.lastGate.recovery.exhausted,true)
  const e2=await fixture(),bad=check('video',{passed:false,status:'fail',failures:['RUN_OWNERSHIP_MISMATCH: foreign artifact']})
  const rejected=await e2.submit('s',{stageId:'qa',evidence:ev,runtimeChecks:[bad]})
  assert.equal(rejected.lastGate.passed,false);assert.equal(rejected.recovery,undefined)
})

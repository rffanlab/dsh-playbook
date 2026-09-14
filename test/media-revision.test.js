import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { PlaybookRouter } from '../src/routing.js'
import { playbookDefinition } from '../src/tool.js'
import { repairEvidenceShape, normalizePlaybook } from '../src/core.js'
import { mediaIssues } from '../src/media-checks.js'
import { createMediaRunner, validatorCommand } from '../src/host-media.js'
import { installAutoRouting } from '../src/automation.js'
import { reviewFeedback, reportMarkdown } from '../src/run-control.js'

// Trusted, synthetic Host results test engine contracts, NOT multimedia quality.
const mockCheck = kind => ({ kind, validatorVersion: '0.4.0', passed: true, status: 'pass', failures: [],
  bindings: { '/fixture/video.mp4': { sha256: 'a'.repeat(64), bytes: 42 } },
  narration: { scriptSha256: 'script-v1', segmentSha256: 'segments-v1' },
  video: { binding: { sha256: 'a'.repeat(64), path: '/fixture/video.mp4' } }, cover: { sha256: 'cover-v1' } })
const evidenceFor = stage => Object.fromEntries(stage.gate.evidence.map(r => [r.key, Object.hasOwn(r, 'equals') ? r.equals : r.type === 'array' ? ['real fixture observation'] : r.type === 'boolean' ? true : 'fixture actual evidence'] ))
async function engineFixture() {
  const e = new PlaybookEngine()
  for (const book of BUILTIN_PLAYBOOKS) e.register(book)
  await e.start('s', 'bilibili-video-production', { task: 'Fixture task' })
  return e
}
async function advance(e, until = null) {
  for (let i = 0; e.activeRun('s') && e.currentStage('s').id !== until && i < 20; i++) {
    const stage = e.currentStage('s')
    await e.submit('s', { stageId: stage.id, evidence: evidenceFor(stage), runtimeChecks: stage.gate.validators?.map(v => mockCheck(v.kind)) })
  }
}

test('actual audit wrapper gets only a lossless, recorded shape correction', async () => {
  const e = new PlaybookEngine(); e.register({ id: 'p', stages: [{ id: 's', objective: 'Review', gate: { evidence: [{key:'timestamped_observations',type:'array',minItems:1}] } }] })
  await e.start('s','p'); const out=await e.submit('s',{evidence:{timestamped_observations:{item:['00:00 actual observation']}}})
  assert.equal(out.run.state,'completed'); assert.equal(e.report('s').summary.losslessShapeCorrections,1)
  assert.deepEqual(out.evidence.s.timestamped_observations,['00:00 actual observation'])
})
test('objects with extra fields are never silently unwrapped',()=>{
  const stage=normalizePlaybook({id:'p',stages:[{id:'s',objective:'Review',gate:{evidence:[{key:'rows',type:'array'}]}}]}).stages[0]
  const shaped=repairEvidenceShape(stage,{rows:{item:['x'],note:'must preserve'}})
  assert.equal(shaped.corrections.length,0);assert.ok(shaped.evidence.rows.note)
})
test('old self-reported QA cannot pass missing independent validators',async()=>{
  const e=await engineFixture();await advance(e,'qa')
  const stage=e.currentStage('s'),out=await e.submit('s',{stageId:'qa',evidence:{...evidenceFor(stage),release_ready:true}})
  assert.equal(out.lastGate.passed,false);assert.match(out.lastGate.failures.join(' '),/missing Host validator/)
})
test('machine failure overrides release_ready=true',async()=>{
  const e=await engineFixture();await advance(e,'qa');const stage=e.currentStage('s')
  const bad={...mockCheck('video'),passed:false,status:'fail',failures:['full decoded audio is zero']}
  const out=await e.submit('s',{stageId:'qa',evidence:{...evidenceFor(stage),release_ready:true},runtimeChecks:[bad]})
  assert.equal(out.lastGate.passed,false);assert.match(out.lastGate.failures.join(' '),/audio is zero/)
})
test('script hashes pin cross-stage content, not a mutable manifest filename',async()=>{
  const e=await engineFixture();await advance(e,'pilot')
  const changed=mockCheck('pilot');changed.narration.scriptSha256='summary-instead-of-full-script'
  const out=await e.submit('s',{evidence:evidenceFor(e.currentStage('s')),runtimeChecks:[changed]})
  assert.match(out.lastGate.failures.join(' '),/NARRATION_STALE/)
})
test('handoff rechecks exactly the QA bindings',async()=>{
  const e=await engineFixture();await advance(e,'handoff');const changed=mockCheck('handoff')
  changed.bindings['/fixture/video.mp4'].sha256='b'.repeat(64)
  const out=await e.submit('s',{evidence:evidenceFor(e.currentStage('s')),runtimeChecks:[changed]})
  assert.equal(out.lastGate.passed,false);assert.match(out.lastGate.failures.join(' '),/QA_STALE/)
})
test('candidate is awaiting review, not automatically accepted',async()=>{
  const e=await engineFixture();await advance(e)
  assert.equal(e.status('s').run.state,'awaiting_review');assert.equal(e.report('s').summary.humanReviewAcceptances,0)
  assert.ok(e.policyDecision('s','bash'));await e.accept('s');assert.equal(e.status('s').run.state,'accepted')
})
test('user rejection retains the same run, script, prior candidate and factual counters',async()=>{
  const e=await engineFixture();await advance(e);const id=e.status('s').run.id, count=e.report('s').summary.gatesPassed
  await e.requestRevision('s','最终成片验收不通过，请自行返修',{messageId:'user-reject-1'})
  assert.equal(e.status('s').run.id,id);assert.equal(e.status('s').run.stageId,'diagnose');assert.equal(e.status('s').run.revision,1)
  assert.ok(e.status('s').machineEvidence.script);assert.equal(e.status('s').machineEvidence.qa,undefined)
  assert.equal(e.report('s').summary.gatesPassed,count);assert.equal(e.report('s').summary.humanReviewRejections,1)
  await e.repair('s','produce','Audio chain has a concrete identified mixing fault.')
  assert.equal(e.status('s').run.id,id);assert.equal(e.currentStage('s').id,'produce')
})
test('changed video with old cover bytes is marked stale after rejection',async()=>{
  const e=await engineFixture();await advance(e);await e.requestRevision('s','验收不通过，请返修')
  await e.repair('s','produce','Fix an audio mixing defect without modifying the script.');await advance(e,'qa')
  const check=mockCheck('video');check.video.binding.sha256='new-video'
  const out=await e.submit('s',{evidence:evidenceFor(e.currentStage('s')),runtimeChecks:[check]})
  assert.match(out.lastGate.failures.join(' '),/COVER_STALE/)
})
test('failed run cannot work informally, but can take a bounded technical repair',async()=>{
  const e=new PlaybookEngine();e.register({id:'p',stages:[{id:'s',objective:'Check',gate:{evidence:[{key:'ok',type:'boolean',equals:true}]}}]});await e.start('s','p')
  await e.submit('s',{evidence:{ok:false}});assert.equal(e.status('s').run.state,'failed');assert.ok(e.policyDecision('s','bash'))
  await e.repair('s','s','A concrete recoverable issue has been diagnosed.');assert.equal(e.status('s').run.state,'active')
  assert.equal(e.report('s').summary.gatesFailed,1);assert.equal(e.report('s').summary.selfRepairs,1)
  await e.cancel('s');assert.equal(e.policyDecision('s','bash'),undefined)
})
test('repair cannot skip ahead, waive missing authority or reset the total budget',async()=>{
  const e=await engineFixture();await assert.rejects(e.repair('s','qa','Trying to skip all preceding required steps'),/earlier/)
  await e.block('s','Need user permission for a missing capability.');await assert.rejects(e.repair('s',null,'The permission is still missing in the environment.'),/permissions/)
  const bounded=new PlaybookEngine({maxSubmissions:1});bounded.register({id:'p',stages:[{id:'s',objective:'Check',gate:{evidence:[{key:'ok',type:'boolean',equals:true}]}}]});await bounded.start('s','p');await bounded.submit('s',{evidence:{ok:false}})
  await assert.rejects(bounded.repair('s','s','A concrete issue was diagnosed but budget is exhausted.'),/budget/)
})
test('three format mistakes allow a controlled correction, without user-click-first',async()=>{
  const e=await engineFixture();for(let i=0;i<3;i++)await e.submit('s',{evidence:{}})
  assert.equal(e.status('s').blocker.kind,'format')
  await e.repair('s',null,'I inspected the expected field types and can correct them.');assert.equal(e.status('s').run.state,'active')
  assert.equal(e.report('s').summary.formatRepairs,3)
})
test('starting another task archives rather than erases prior history, including after hydration',async()=>{
  const e=await engineFixture();await advance(e);const old=e.status('s').run.id;await e.start('s','bug-fix')
  const restored=new PlaybookEngine();restored.hydrate(e.snapshot())
  assert.equal(restored.report('s').archivedRuns[0].id,old);assert.ok(restored.archives.get('s')[0].history.length)
})
test('system counts derive from stage definitions/events instead of submitted fake numbers',async()=>{
  const e=await engineFixture();await advance(e)
  const report=e.report('s');assert.equal(report.summary.normalPathStageCount,9);assert.equal(report.summary.declaredStageCount,10);assert.equal(report.summary.gatesPassed,9)
  assert.match(reportMarkdown(report),/not independently|Not independently/);assert.equal(report.summary.humanReviewRejections,0)
})
test('long-running validation cannot commit after a stage/revision change',async()=>{
  const e=await engineFixture(),before=e.status('s')
  await e.submit('s',{evidence:evidenceFor(e.currentStage('s'))})
  await assert.rejects(e.submit('s',{evidence:evidenceFor(e.currentStage('s')),expected:{runId:before.run.id,epoch:before.run.stageEpoch,revision:0}}),/Stale/)
})
test('direct review cues exclude hypothetical logs and ordinary how-to questions',()=>{
  assert.equal(reviewFeedback('最终成片验收不通过。请按照 SOP 自行检查、识别原因、回退返修，不要询问我具体哪里有问题。'),'reject')
  for(const q of ['如果验收不通过应该怎么办','日志里他说验收不通过','如何处理验收不通过？','帮我写一篇解释验收不通过的文章'])assert.equal(reviewFeedback(q),null)
  assert.equal(reviewFeedback('验收通过'),'accept');assert.equal(reviewFeedback('模型说验收通过'),null)
})
test('pre-step handles rejection before ordinary SOP recommendation',async()=>{
  const e=await engineFixture();await advance(e);const id=e.status('s').run.id,r=new PlaybookRouter(e);let hook
  installAutoRouting({on:(_,fn)=>{hook=fn},tools:{guard:()=>{}}},e,r,{createMessage:p=>({id:'notice',...p})})
  const agent={id:'s',session:{header:{}}},m={id:'rejection',source:{kind:'user'},content:[{type:'text',text:'最终成片验收不通过，请返修'}]}
  const output=await hook({agent,messages:[m],signal:new AbortController().signal},async()=>({kind:'enter',messages:[m]}))
  assert.equal(e.status('s').run.id,id);assert.equal(e.currentStage('s').id,'diagnose');assert.match(output.messages[1].content[0].text,/revision 1/)
  await hook({agent,messages:[m]},async()=>({kind:'enter',messages:[m]}));assert.equal(e.status('s').run.revision,1)
})
test('validator uses the public nested tool pipeline with original agent/cancellation, not host spawn',async()=>{
  let call
  const runner=createMediaRunner({tools:{execute:async input=>{call=input;return {isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{text:JSON.stringify(mockCheck('narration')),truncated:false}}}}}})
  const exec={agent:{id:'s'},token:Symbol(),callId:'c',rootCallId:'root',signal:new AbortController().signal}
  await runner([{kind:'narration',pathKey:'path'}],{path:"dir/a'; touch BAD; echo '.json"},exec)
  assert.equal(call.parent,exec.token);assert.equal(call.agent,exec.agent);assert.equal(call.signal,exec.signal);assert.equal(call.name,'bash');assert.equal(call.arguments.workdir,undefined)
  assert.ok(!call.arguments.command.includes('touch BAD'));assert.match(call.arguments.command,/python3 -I -c/)
})
test('denied/unknown/truncated validator result cannot be treated as passed',async()=>{
  for(const output of [{isError:true},{isError:false,value:{kind:'background',jobId:'1'}},{isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{text:'passed',truncated:true}}}]){
    const runner=createMediaRunner({tools:{execute:async()=>output}}),out=await runner([{kind:'video',pathKey:'p'}],{p:'production.json'},{agent:{id:'s'},token:Symbol(),callId:'c',signal:new AbortController().signal})
    assert.equal(out[0].passed,false);assert.equal(out[0].status,'unavailable')
  }
})
test('model-supplied runtimeChecks are never forwarded as trusted machine output',async()=>{
  const e=await engineFixture();await advance(e,'script');const t=playbookDefinition(e,async()=>[],new PlaybookRouter(e))
  const out=await t.execute({action:'submit',stage_id:'script',evidence:evidenceFor(e.currentStage('s')),runtimeChecks:[mockCheck('narration')]},{agent:{id:'s'},signal:new AbortController().signal})
  assert.equal(out.gatePassed,false)
})

test('report export content/path are engine-owned and only its exact nested write gets the stage exemption',async()=>{
  const {createReportExporter,isReportWrite}=await import('../src/report-export.js')
  const e=await engineFixture();await advance(e);const pending=new Map();let saved
  const ctx={tools:{execute:async call=>{
    assert.equal(isReportWrite(call,pending),true)
    assert.equal(isReportWrite({...call,arguments:{...call.arguments,content:'fake 5/5'}},pending),false)
    assert.equal(isReportWrite({...call,parent:Symbol()},pending),false)
    saved=call
    return {isError:false,value:{path:call.arguments.file_path,after:call.arguments.content}}
  }}}
  const exec={agent:{id:'s'},token:Symbol(),callId:'export',signal:new AbortController().signal}
  const result=await createReportExporter(ctx,e,pending)(exec)
  assert.match(result.path,/execution-report\.system\.r0\./);assert.match(saved.arguments.content,/"normalPathStageCount": 9/)
  assert.equal(result.runId,e.status('s').run.id);assert.equal(pending.size,0)
})
test('a failed Host write does not fabricate a saved report or fall back to direct FS',async()=>{
  const {createReportExporter}=await import('../src/report-export.js');const e=await engineFixture();await advance(e);const pending=new Map()
  await assert.rejects(createReportExporter({tools:{execute:async()=>({isError:true})}},e,pending)({agent:{id:'s'},token:Symbol(),callId:'export',signal:new AbortController().signal}),/denied/)
  assert.equal(pending.size,0)
})

test('model start cannot replace a candidate awaiting user review', async () => {
  const e = await engineFixture(); await advance(e)
  const id = e.status('s').run.id
  const tool = playbookDefinition(e, async () => [], new PlaybookRouter(e))
  await assert.rejects(tool.execute({ action: 'start', playbook_id: 'bug-fix' }, { agent: { id: 's' } }), /awaits user review/)
  assert.equal(e.status('s').run.id, id)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../src/host.js'
import { reviewFeedback } from '../src/run-control.js'

// Synthetic tasks only. This regression exercises the actual plugin wiring,
// not a claim about running a deployed model or rendering a real video.
const book = {id:'candidate-fixture',delivery:{review:true,revisionStage:'diagnose',maxRevisions:2,repairStages:['produce','qa'],maxSelfRepairs:3},stages:[
  {id:'produce',objective:'Create the requested artifact',gate:{evidence:['artifact']}},
  {id:'qa',objective:'Verify the artifact',gate:{evidence:['checked']},next:null},
  {id:'diagnose',objective:'Diagnose only the user requested change',gate:{evidence:['diagnosis']},next:'produce'},
]}
async function harness(t) {
  const workspace=await mkdtemp(join(tmpdir(),'candidate-review-'))
  const hooks=new Map(), guards=[], commands=new Map(), tools=new Map()
  const agent={id:'session',session:{header:{cwd:workspace}},steer:()=>{}}, signal=new AbortController().signal
  const ctx={on:(n,f)=>hooks.set(n,f),effect:()=>{},provide:()=>{},inject:(_d,f)=>f(ctx),
    tools:{register:d=>tools.set(d.name,d),guard:g=>guards.push(g)},
    systemPrompt:{section:()=>{}},commands:{register:c=>commands.set(c.name,c)}}
  let n=0
  const path=join(workspace,'state.json')
  const engine=install(ctx,{define:d=>d,message:p=>({id:`notice-${++n}`,...p}),paths:{directory:join(workspace,'catalog'),state:path}})
  const call=args=>tools.get('playbook').execute(args,{agent,signal,callId:`tool-${++n}`,token:Symbol()})
  const command=rawInput=>commands.get('playbook').handler({agent,signal,rawInput})
  await call({action:'list'});engine.register(book)
  const seed=async()=>{await engine.start(agent.id,book.id,{task:'Keep the approved script; replace only the requested shot.'});await engine.submit(agent.id,{stageId:'produce',evidence:{artifact:'fixture artifact'}});await engine.submit(agent.id,{stageId:'qa',evidence:{checked:'fixture verification'}})}
  await seed()
  const userMessage=(text,id=`user-${++n}`)=>({id,source:{kind:'user'},content:[{type:'text',text}]})
  const step=(m,{who=agent,downstream={kind:'enter',messages:[m],startsRequestSeries:true},abort=signal}={})=>hooks.get('agent/pre-step')({agent:who,signal:abort,messages:[m]},async()=>downstream)
  t.after(async()=>{await engine.queue;await rm(workspace,{recursive:true,force:true})})
  return {engine,agent,signal,call,command,userMessage,step,guards,seed,path}
}

for(const text of ['拒绝候选','拒绝当前候选','拒绝这个候选。','请拒绝候选','老哥，拒绝候选','拒绝候选，保留已确认内容，仅替换指定镜头。','不接受这版','候选不通过','reject candidate','Reject this candidate.'])
  test(`direct review phrase: ${text}`,()=>assert.equal(reviewFeedback(text),'reject'))
for(const text of ['拒绝候选是什么意思？','拒绝候选按钮在哪里？','请解释“拒绝候选”按钮怎么用','不要拒绝候选','请不要拒绝候选','如果拒绝候选会怎样？','日志里他说：拒绝候选','> 拒绝候选','```text\n拒绝候选\n```','“拒绝候选”','请解释下面的文字\n拒绝候选','帮我翻译这句话\n拒绝候选','Please analyze this log\nreject candidate'])
  test(`quoted/question/negated phrase is not a decision: ${text.slice(0,30)}`,()=>assert.equal(reviewFeedback(text),null))

test('actual direct-user pre-step → same-run revision → repair, no cancel/clear/recover required',async t=>{
  const h=await harness(t),before=h.engine.status(h.agent.id),text='拒绝候选，仅替换指定镜头；文稿、语速、时长和其它镜头不变。'
  const m=h.userMessage(text),out=await h.step(m),after=h.engine.status(h.agent.id)
  assert.equal(out.messages[0],m);assert.equal(out.startsRequestSeries,true)
  assert.match(out.messages.at(-1).content[0].text,/聊天退回已登记/)
  assert.equal(after.run.id,before.run.id);assert.equal(after.run.revision,1);assert.equal(after.run.stageId,'diagnose');assert.equal(after.run.state,'active')
  assert.equal(after.revisionFeedback.reason,text)
  assert.equal(h.engine.report(h.agent.id).summary.humanReviewRejections,1)
  assert.equal(h.engine.report(h.agent.id).summary.gatesPassed,2)
  assert.deepEqual(after.input,before.input);assert.deepEqual(after.evidence.produce,before.evidence.produce)
  assert.equal(h.engine.archives.size,0)
  const repaired=await h.call({action:'repair',stage_id:'produce',note:'Only replace the shot explicitly rejected by the user; keep all other materials.'})
  assert.equal(repaired.status.run.id,before.run.id);assert.equal(repaired.status.run.stageId,'produce')
  assert.equal(h.guards.some(g=>g({agent:h.agent,name:'write',arguments:{file_path:join(h.agent.session.header.cwd,'artifact')}})),false)
  const stored=JSON.parse(await readFile(h.path,'utf8'))
  assert.equal(stored.runs[h.agent.id].revision,1);assert.equal(stored.runs[h.agent.id].revisions[0].reason,text)
})
test('disabling NEW automatic intake does not disable explicit review of existing candidate',async t=>{
  const h=await harness(t);await h.command('auto off');await h.step(h.userMessage('拒绝候选'))
  assert.equal(h.engine.status(h.agent.id).run.revision,1)
  assert.equal((await h.call({action:'status'})).routing.enabled,false)
})
test('status and repair/recover failures describe real chat and command entrances, not mandatory UI',async t=>{
  const h=await harness(t),s=await h.call({action:'status'})
  assert.equal(s.status.reviewControl.uiRequired,false);assert.equal(s.status.reviewControl.rejectText,'拒绝候选')
  assert.match(s.status.reviewControl.rejectCommand,/^\/playbook revise/)
  assert.match(s.status.reviewControl.target,/^[a-f0-9]{64}$/)
  const before=h.engine.snapshot()
  const p=await h.call({action:'repair',stage_id:'produce',note:'The model knows which shot needs correction but cannot invent human approval.'})
  assert.equal(p.error.code,'USER_REVIEW_REQUIRED');assert.equal(p.nextAction,'await_direct_user_review')
  const r=await h.call({action:'recover'});assert.equal(r.recovered,false);assert.equal(r.nextAction,'await_direct_user_review')
  assert.deepEqual(h.engine.snapshot(),before)
  for(const action of ['reject','accept','revise']) await assert.rejects(h.call({action}),/unsupported action/)
})
test('human command fallback changes only the original run, without new-run authoring',async t=>{
  const h=await harness(t),id=h.engine.status(h.agent.id).run.id
  assert.equal((await h.command('reject 只调整一个已明确的镜头。')).kind,'success')
  assert.equal(h.engine.status(h.agent.id).run.id,id);assert.equal(h.engine.status(h.agent.id).run.revision,1)
})
test('duplicate direct-user messages are idempotent across concurrency and restored Host agent object',async t=>{
  const h=await harness(t),m=h.userMessage('拒绝候选','same-user-message')
  await Promise.all([h.step(m),h.step(m)])
  assert.equal(h.engine.report(h.agent.id).summary.humanReviewRejections,1)
  // Return a new candidate, then simulate a rehydration and a new live Agent object.
  await h.engine.repair(h.agent.id,'produce','Synthetic targeted revision after the direct user review.')
  await h.engine.submit(h.agent.id,{stageId:'produce',evidence:{artifact:'revised artifact'}})
  await h.engine.submit(h.agent.id,{stageId:'qa',evidence:{checked:'rechecked artifact'}})
  const snapshot=h.engine.snapshot();h.engine.runs.clear();h.engine.hydrate(snapshot)
  await h.step(m,{who:{...h.agent}})
  assert.equal(h.engine.status(h.agent.id).run.state,'awaiting_review');assert.equal(h.engine.status(h.agent.id).run.revision,1)
})
test('read/write failure reports review registration failure and same event remains retryable',async t=>{
  const h=await harness(t),before=h.engine.snapshot(),persist=h.engine.persist,m=h.userMessage('拒绝候选')
  h.engine.persist=async()=>{throw new Error('synthetic state disk failure')}
  const out=await h.step(m)
  assert.match(out.messages.at(-1).content[0].text,/用户评审未登记成功.*synthetic state disk failure/)
  assert.deepEqual(h.engine.snapshot(),before)
  h.engine.persist=persist;await h.step(m);assert.equal(h.engine.status(h.agent.id).run.revision,1)
})
test('explicit cancellation, downstream rejection, child prompts and plugin messages retain their boundaries',async t=>{
  const h=await harness(t),before=h.engine.snapshot()
  const m=h.userMessage('拒绝候选')
  await h.step(m,{downstream:{kind:'reject'}})
  await h.step(m,{downstream:{kind:'enter',messages:[]}})
  await h.step({...m,id:'plugin',source:{kind:'plugin',plugin:'test'}})
  await h.step(m,{who:{...h.agent,session:{header:{parentSession:'parent'}}}})
  await assert.rejects(h.step(m,{abort:AbortSignal.abort()}))
  assert.deepEqual(h.engine.snapshot(),before)
})
test('UI command is bound to exact displayed candidate; duplicate click never starts another revision',async t=>{
  const h=await harness(t),s=h.engine.status(h.agent.id),cmd=`review reject ${s.reviewControl.target} Only this shot.`
  const out=await h.command(cmd);assert.equal(out.kind,'success')
  const before=h.engine.snapshot(),again=await h.command(cmd)
  assert.equal(again.kind,'error');assert.match(again.text,/REVIEW_TARGET_CHANGED/);assert.deepEqual(h.engine.snapshot(),before)
})
test('a stale UI target cannot accept another candidate or resurrect a cancelled task',async t=>{
  const h=await harness(t),token=h.engine.status(h.agent.id).reviewControl.target
  await h.engine.cancel(h.agent.id);await h.seed()
  const before=h.engine.snapshot(),out=await h.command(`review accept ${token}`)
  assert.equal(out.kind,'error');assert.match(out.text,/REVIEW_TARGET_CHANGED/);assert.deepEqual(h.engine.snapshot(),before)
})
test('acceptance is explicit and shares the same safe UI binding',async t=>{
  const h=await harness(t),token=h.engine.status(h.agent.id).reviewControl.target
  const out=await h.command(`review accept ${token}`);assert.equal(out.kind,'success')
  assert.equal(h.engine.status(h.agent.id).run.state,'accepted');assert.equal(h.engine.report(h.agent.id).summary.humanReviewAcceptances,1)
})
test('a third direct user rejection continues the old pinned maxRevisions=2 run',async t=>{
  const h=await harness(t),before=h.engine.status(h.agent.id);h.engine.runs.get(h.agent.id).revision=2
  const m=h.userMessage('拒绝候选'),out=await h.step(m),after=h.engine.status(h.agent.id)
  assert.match(out.messages.at(-1).content[0].text,/revision 3/)
  assert.equal(after.run.id,before.run.id);assert.equal(after.run.state,'active');assert.equal(after.run.revision,3)
  assert.equal(after.run.stageId,'diagnose');assert.equal(after.workBudget.userRevisions.limit,null)
  assert.deepEqual(h.engine.runs.get(h.agent.id).playbookSnapshot,h.engine.getPlaybook(book.id))
  await h.step(m,{who:{...h.agent}});assert.equal(h.engine.status(h.agent.id).run.revision,3)
})


test('many human revisions pass through real pre-step past lifetime gate and repair caps, with history intact',async t=>{
  const h=await harness(t),id=h.agent.id,original=h.engine.runs.get(id),saved=structuredClone(original.playbookSnapshot)
  const originalId=original.id,task=structuredClone(original.input)
  h.engine.maxSubmissions=3
  for(let i=1;i<=35;i++){
    await h.step(h.userMessage('拒绝候选，只改已说明的问题。',`human-round-${i}`))
    const p=await h.call({action:'repair',stage_id:'produce',note:'Only fix the user-specified change; preserve approved assets.'})
    assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.status.run.revision,i)
    await h.call({action:'submit',stage_id:'produce',evidence:{artifact:`fixture ${i}`}})
    await h.call({action:'submit',stage_id:'qa',evidence:{checked:`actual fixture check ${i}`}})
    assert.equal(h.engine.status(id).run.state,'awaiting_review')
  }
  const report=h.engine.report(id)
  assert.equal(report.run.id,originalId);assert.equal(report.run.revision,35)
  assert.equal(report.summary.selfRepairs,35);assert.equal(report.summary.gatesPassed,72)
  assert.equal(report.summary.workBudget.submissions.used,2)
  assert.equal(report.summary.workBudget.selfRepairs.used,1)
  assert.deepEqual(h.engine.runs.get(id).playbookSnapshot,saved);assert.deepEqual(h.engine.status(id).input,task)
  assert.equal(h.engine.archives.size,0)
  assert.equal((await h.call({action:'status'})).status.workBudget.userRevisions.limit,null)
})

test('third UI rejection has no human-count cap and remains bound to its displayed candidate',async t=>{
  const h=await harness(t),id=h.agent.id
  h.engine.runs.get(id).revision=2
  const s=h.engine.status(id),out=await h.command(`review reject ${s.reviewControl.target} 修正指定镜头`)
  assert.equal(out.kind,'success');assert.equal(h.engine.status(id).run.revision,3)
  assert.equal(h.engine.status(id).run.id,s.run.id)
  assert.equal((await h.command(`review reject ${s.reviewControl.target}`)).kind,'error')
})

test('direct continuation of exhausted automatic work stays in the same run and does not re-review a candidate',async t=>{
  const h=await harness(t),id=h.agent.id
  await h.step(h.userMessage('拒绝候选'))
  h.engine.maxSubmissions=1
  await h.call({action:'submit',stage_id:'diagnose',evidence:{diagnosis:'The user requested only the specified correction.'}})
  await h.call({action:'submit',stage_id:'produce',evidence:{artifact:'bounded fixture work'}})
  assert.equal(h.engine.status(id).run.state,'failed')
  const before=h.engine.status(id),m=h.userMessage('继续原任务','continue-once')
  await h.command('auto off')
  const out=await h.step(m),s=h.engine.status(id)
  assert.match(out.messages.at(-1).content[0].text,/已登记用户继续原任务/)
  assert.equal(s.run.id,before.run.id);assert.equal(s.run.revision,before.run.revision)
  assert.equal(s.run.stageId,before.run.stageId);assert.equal(s.workBudget.submissions.used,0)
  assert.equal(s.workBudget.lifetime.submissions,before.workBudget.lifetime.submissions)
  await h.call({action:'submit',stage_id:'produce',evidence:{artifact:'fixture after continuation'}})
  await h.call({action:'submit',stage_id:'qa',evidence:{checked:'too many checks in this short cycle'}})
  const unchanged=h.engine.snapshot()
  await h.step(m,{who:{...h.agent}})
  assert.deepEqual(h.engine.snapshot(),unchanged)
  for(const action of ['continue','reset_budget','revise','reject']) await assert.rejects(h.call({action}),/unsupported action/)
})

test('structured automatic-budget response shows cycle vs lifetime without clearing/recreating task',async t=>{
  const h=await harness(t),id=h.agent.id
  await h.step(h.userMessage('拒绝候选'))
  for(let i=0;i<3;i++)assert.equal((await h.call({action:'repair',stage_id:'produce',note:'Synthetic bounded repair of the original work.'})).ok,true)
  const response=await h.call({action:'repair',stage_id:'produce',note:'A fourth autonomous repair must remain bounded.'})
  assert.equal(response.ok,false);assert.equal(response.error.code,'AUTOMATIC_WORK_BUDGET_EXHAUSTED')
  assert.equal(response.status.workBudget.selfRepairs.used,3)
  assert.equal(response.status.workBudget.selfRepairs.limit,3)
  assert.equal(response.nextAction,'report_bounded_work_progress')
  await h.step({...h.userMessage('继续原任务'),source:{kind:'plugin',plugin:'fake-human'}})
  assert.equal(h.engine.status(id).workBudget.selfRepairs.used,3)
  await h.step(h.userMessage('继续原任务'))
  assert.equal(h.engine.status(id).workBudget.selfRepairs.used,0)
  assert.equal(h.engine.report(id).summary.selfRepairs,3)
})

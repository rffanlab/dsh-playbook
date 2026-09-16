import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'
import { WorkflowEngine } from '../src/workflow-ux.js'
import { workBudget, isWorkContinuation } from '../src/work-budget.js'
import { protectedChanges } from '../src/project-library.js'
import { normalizePlaybook } from '../src/core.js'

const base={id:'fixture',delivery:{review:true,revisionStage:'diagnose',repairStages:['work','qa'],maxRevisions:2,maxSelfRepairs:2},stages:[
  {id:'work',objective:'Create fixture artifact',gate:{evidence:['artifact']}},
  {id:'qa',objective:'Check fixture artifact',gate:{evidence:[{key:'checked',type:'boolean',equals:true}]},retry:{maxAttempts:1},next:null},
  {id:'diagnose',objective:'Diagnose user feedback',gate:{evidence:['diagnosis']},next:'work'},
]}
async function setup(options={}){const e=new PlaybookEngine(options);e.register(base);await e.start('s',base.id,{task:'original task'});return e}
async function candidate(e){
  if(e.currentStage('s').id==='diagnose')await e.submit('s',{stageId:'diagnose',evidence:{diagnosis:'fixture diagnosis'}})
  if(e.currentStage('s').id==='work')await e.submit('s',{stageId:'work',evidence:{artifact:'fixture artifact'}})
  await e.submit('s',{stageId:'qa',evidence:{checked:true}})
}

test('legacy pinned 2-revision definition continues past 70 reviews and does not forget old message IDs',async()=>{
  const e=await setup(),saved=structuredClone(e.activeRun('s').playbookSnapshot),id=e.status('s').run.id
  await candidate(e)
  for(let i=1;i<=70;i++){await e.requestRevision('s','explicit human correction',{messageId:`human-${i}`});await candidate(e)}
  assert.equal(e.status('s').run.revision,70);assert.equal(e.status('s').run.id,id)
  assert.equal(e.status('s').workBudget.lifetime.submissions,212)
  const restored=new PlaybookEngine();restored.hydrate(e.snapshot());const before=restored.snapshot()
  await restored.requestRevision('s','redelivered old user feedback',{messageId:'human-1'})
  assert.deepEqual(restored.snapshot(),before);assert.deepEqual(restored.runs.get('s').playbookSnapshot,saved)
})

test('active revision retains consumed allowance over restart; status/reload never renews it',async()=>{
  const e=await setup({maxSubmissions:4});await candidate(e)
  await e.requestRevision('s','specific human correction',{messageId:'h1'})
  await e.repair('s','work','specific correction of the same task')
  const before=workBudget(e,e.runs.get('s')),restored=new PlaybookEngine({maxSubmissions:4})
  restored.hydrate(e.snapshot());restored.register(base)
  assert.deepEqual(workBudget(restored,restored.runs.get('s')),before)
  assert.equal(restored.status('s').workBudget.selfRepairs.used,1)
})

test('automated repairs stay finite inside a cycle; user revision grants another without erasing totals',async()=>{
  const e=await setup();await candidate(e);await e.requestRevision('s','user revision')
  for(let i=0;i<2;i++)await e.repair('s','work','meaningful bounded repair with evidence')
  await assert.rejects(e.repair('s','work','third automatic retry is not user feedback'),{code:'AUTOMATIC_WORK_BUDGET_EXHAUSTED'})
  const before=e.report('s');await candidate(e);await e.requestRevision('s','next direct user correction')
  assert.equal(e.status('s').workBudget.selfRepairs.used,0)
  assert.equal(e.report('s').summary.selfRepairs,before.summary.selfRepairs)
  await e.repair('s','work','repair requested in the new human cycle')
  assert.equal(e.report('s').summary.selfRepairs,3)
})

test('fresh human revision does not accept bad evidence or waive a quality gate',async()=>{
  const e=await setup();await candidate(e);await e.requestRevision('s','fix current work')
  await e.repair('s','work','targeted repair after explicit review');await e.submit('s',{evidence:{artifact:'fixture'}})
  const out=await e.submit('s',{evidence:{checked:false}})
  assert.equal(out.lastGate.passed,false);assert.equal(out.run.state,'failed')
})

test('actual failure in human-revision state persistence rolls back all new allowance and feedback',async()=>{
  const e=await setup();await candidate(e);const before=e.snapshot(),persist=e.persist
  e.persist=async()=>{throw new Error('disk failure fixture')}
  await assert.rejects(e.requestRevision('s','third user correction',{messageId:'h'}),/disk failure/)
  assert.deepEqual(e.snapshot(),before)
  e.persist=persist;await e.requestRevision('s','third user correction',{messageId:'h'})
  assert.equal(e.status('s').workBudget.cycle,1)
})

test('concurrent redelivery creates only one bounded cycle',async()=>{
  const e=await setup();await candidate(e)
  await Promise.all([e.requestRevision('s','real user correction',{messageId:'id'}),e.requestRevision('s','real user correction',{messageId:'id'})])
  assert.equal(e.status('s').run.revision,1);assert.equal(e.status('s').workBudget.cycle,1)
})

test('legacy cumulative repair counts without full event detail stay conservative until human grants a cycle',async()=>{
  const e=await setup();e.activeRun('s').selfRepairs=4
  assert.equal(e.status('s').workBudget.selfRepairs.used,4)
  await candidate(e);await e.requestRevision('s','explicit human permission to continue')
  assert.equal(e.status('s').workBudget.selfRepairs.used,0)
  assert.equal(e.status('s').workBudget.lifetime.selfRepairs,4)
  await e.repair('s','work','specific correction after fresh user request')
  assert.equal(e.status('s').workBudget.selfRepairs.used,1)
})

test('continuation is only for exhausted automatic work, not review, cancellation or missing permissions',async()=>{
  const e=await setup();await assert.rejects(e.continueWork('s'),/No exhausted/)
  await candidate(e);await assert.rejects(e.continueWork('s'),/No exhausted/)
  await e.requestRevision('s','user correction');await e.block('s','missing genuine permission')
  await assert.rejects(e.continueWork('s'),/No exhausted/)
  await e.cancel('s');await assert.rejects(e.continueWork('s'),/No exhausted/)
})

test('human continuation respects abort, stale target and persistence failure, retaining all totals',async()=>{
  const e=await setup({maxSubmissions:1});await e.submit('s',{evidence:{artifact:'fixture'}})
  await e.submit('s',{evidence:{checked:true}});const before=e.snapshot(),persist=e.persist
  await assert.rejects(e.continueWork('s',{signal:AbortSignal.abort()}))
  await assert.rejects(e.continueWork('s',{expectedRunId:'not-this-run',expectedEpoch:0}),/CONTINUATION_TARGET_CHANGED/)
  e.persist=async()=>{throw new Error('disk failure fixture')}
  await assert.rejects(e.continueWork('s'),/disk failure/);assert.deepEqual(e.snapshot(),before)
  e.persist=persist;await e.continueWork('s',{messageId:'c1'})
  const after=e.snapshot();await e.continueWork('s',{messageId:'c1'});assert.deepEqual(e.snapshot(),after)
  assert.equal(e.status('s').workBudget.submissions.used,0);assert.equal(e.status('s').workBudget.lifetime.submissions,1)
})

for(const text of ['继续','继续原任务','继续修改。','请继续执行','继续生成 v4','Continue this task'])
  test(`direct continuation: ${text}`,()=>assert.equal(isWorkContinuation(text),true))
for(const text of ['如果继续会怎样','不要继续','“继续原任务”','> 继续原任务','```\n继续原任务\n```','他说继续原任务','继续是什么意思？','please explain continue'])
  test(`not continuation authority: ${text}`,()=>assert.equal(isWorkContinuation(text),false))

test('deprecated metadata does not invalidate approved methods; real review/repair policies still protected',()=>{
  const old=normalizePlaybook(base),updated=structuredClone(old);updated.delivery.maxRevisions=null
  assert.deepEqual(protectedChanges(old,updated),[])
  updated.delivery.maxSelfRepairs=5;assert.ok(protectedChanges(old,updated).length)
  const newer=structuredClone(base);delete newer.delivery.maxRevisions
  assert.equal(normalizePlaybook(newer).delivery.maxRevisions,null)
})

test('recover cannot borrow exhausted lifetime history from another human cycle',async()=>{
  const e=await setup({maxSubmissions:2});await candidate(e)
  await e.requestRevision('s','real next human instruction')
  assert.equal(workBudget(e,e.runs.get('s')).submissions.exhausted,false)
  assert.equal(workBudget(e,e.runs.get('s')).lifetime.submissions,2)
})

test('human revision does not carry an obsolete recovery-exhausted instruction into new work',async()=>{
  const e=await setup();await candidate(e)
  e.runs.get('s').lastGate.recovery={exhausted:true,code:'qa-stale',target:'qa'}
  await e.requestRevision('s','specific new human instruction')
  assert.equal(e.status('s').workBudget.submissions.used,0)
  assert.equal(e.status('s').lastGate.recovery.continuedByUser,true)
})

test('dependency recovery can run after many previous human cycles, but not loop forever in one',async()=>{
  const e=new WorkflowEngine({maxSubmissions:4})
  const p={id:'dependency-fixture',delivery:{review:true,revisionStage:'diagnose',repairStages:['script','qa'],maxSelfRepairs:2,maxRevisions:2},stages:[
    {id:'script',objective:'Freeze script',gate:{evidence:['text']}},
    {id:'qa',objective:'Verify media',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'video',pathKey:'production_manifest'}]},next:null},
    {id:'diagnose',objective:'Diagnose feedback',gate:{evidence:['diagnosis']},next:'script'},
  ]}
  e.register(p)
  // Restore a pre-isolation, pinned run. No filesystem operations in this state test.
  const source=await setup();await candidate(source)
  const old=source.snapshot().runs.s;old.playbookId=p.id;old.playbookSnapshot=normalizePlaybook(p);old.stageId='qa';old.revision=9
  old.history.push(...Array.from({length:80},()=>({type:'gate_failed'})))
  e.hydrate({version:3,runs:{s:old}})
  await e.requestRevision('s','direct human asks for another correction',{messageId:'new-user'})
  await e.repair('s','qa','A specific existing candidate needs fresh QA.')
  const failing={validatorVersion:'0.4.0',kind:'video',passed:false,status:'fail',failures:['NARRATION_COVERAGE'],bindings:{}}
  const out=await e.submit('s',{stageId:'qa',evidence:{production_manifest:'production.json'},runtimeChecks:[failing]})
  assert.equal(out.lastGate.passed,false)
  assert.equal(out.lastGate.recovery.exhausted,false)
  assert.equal(out.run.stageId,'script')
  assert.ok(out.workBudget.lifetime.submissions>64)
  assert.equal(out.workBudget.submissions.used,1)
})

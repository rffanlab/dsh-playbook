import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'
import { PlaybookRouter } from '../src/routing.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { ProjectLibrary, protectedChanges } from '../src/project-library.js'
import { installAutoRouting } from '../src/automation.js'
import { playbookDefinition } from '../src/tool.js'
import { isVideoTask, projectHint } from '../src/intake-policy.js'

function fixture(cwd = '/workspace/shared', sid = 's') {
  const e = new PlaybookEngine(); for (const p of BUILTIN_PLAYBOOKS) e.register(p)
  const r = new PlaybookRouter(e), p = new ProjectLibrary(e,r); r.projects = p
  const exec = {agent:{id:sid,session:{header:{cwd}}},signal:new AbortController().signal}
  return {e,r,p,exec,t:playbookDefinition(e,async()=>[],r,async()=>{},undefined,undefined,p)}
}
function read(f, id='read-1', lines=['道家文化视频任务书','保留原文和自然口播。'], offset=1,total=lines.length,path='task.md') {
  f.p.observeRead({...f.exec,name:'read',callId:id},{isError:false,value:{path,offset,totalLines:total,lines:lines.map((text,i)=>({number:offset+i,text}))}})
}
async function intake(f, project='taoist-culture', task='制作道家文化视频，发到B站', sources=[]) {
  f.r.remember(f.exec.agent.id,task);f.p.capture(f.exec.agent.id,task)
  if(sources.length)read(f)
  return f.p.intake(f.exec,{project_id:project,requirements:['保留原文；先核验出处，再制作自然口播。'],source_call_ids:sources})
}
const spec = {sop_id:'culture-method',base_id:'taoist-culture-video',rules:['保留用户已确认的原文。'],stage_notes:{'source-truth':['记录所用版本和引用段落，不把现代应用说成古籍原义。']}}

test('video publishing platform does not replace the content project hint',()=>{
  assert.equal(projectHint('制作道家文化视频发布到B站'),'taoist-culture-video')
  assert.equal(projectHint('帮我做一期 B站本地模型实测视频'),'bilibili-video-production')
  assert.equal(isVideoTask('写一篇公众号介绍道家视频制作'),false)
})
test('culture and experiment bases share media validators, not the same domain stage graph',()=>{
  const f=fixture(),a=f.e.getPlaybook('taoist-culture-video'),b=f.e.getPlaybook('bilibili-video-production')
  assert.ok(a.stages.some(s=>s.id==='source-truth'));assert.ok(a.stages.some(s=>s.id==='interpretation'))
  assert.ok(b.stages.some(s=>s.id==='evidence'));assert.ok(!b.stages.some(s=>s.id==='source-truth'))
  assert.deepEqual(a.stages.find(s=>s.id==='qa').gate.validators,b.stages.find(s=>s.id==='qa').gate.validators)
})
test('pre-step no longer auto-starts a video before reading and identifying the project',async()=>{
  const f=fixture();let hook
  installAutoRouting({on:(_,fn)=>{hook=fn},tools:{guard:()=>{}}},f.e,f.r,{createMessage:p=>({id:'notice',...p})})
  const m={id:'u1',source:{kind:'user'},content:[{type:'text',text:'按 task.md 制作道家视频发B站'}]}
  const out=await hook({agent:f.exec.agent,signal:f.exec.signal,messages:[m]},async()=>({kind:'enter',messages:[m]}))
  assert.equal(f.e.runs.size,0);assert.match(out.messages[1].content[0].text,/intake/)
  assert.equal(f.r.guard('s','read'),undefined);assert.equal(f.r.guard('s','glob'),undefined)
  assert.ok(f.r.guard('s','bash'));assert.ok(f.r.guard('s','write'))
})
test('referenced sources require actual read receipts, not self-reported success',async()=>{
  const f=fixture();f.r.remember('s','按 task.md 制作视频');f.p.capture('s','按 task.md 制作视频')
  await assert.rejects(f.p.intake(f.exec,{project_id:'culture',requirements:['原文要求'],source_call_ids:[]}),/read/)
  await assert.rejects(f.p.intake(f.exec,{project_id:'culture',requirements:['原文要求'],source_call_ids:['invented']}),/No observed read/)
})
test('complete paged read works; missing pages are rejected',async()=>{
  const f=fixture();f.r.remember('s','按 task.md 制作道家视频');read(f,'a',['道家文化视频','原文'],1,4)
  await assert.rejects(f.p.intake(f.exec,{project_id:'culture',requirements:['核验原文'],source_call_ids:['a']}),/Incomplete/)
  read(f,'b',['自然口播','不改主题'],3,4)
  assert.equal((await f.p.intake(f.exec,{project_id:'culture',requirements:['核验原文'],source_call_ids:['a','b']})).ok,true)
})
test('read receipts are isolated per session and unsupported/failed reads do not count',async()=>{
  const f=fixture();read(f)
  const other={...f.exec,agent:{...f.exec.agent,id:'other'}};f.r.remember('other','按 task.md 制作道家视频')
  await assert.rejects(f.p.intake(other,{project_id:'culture',requirements:['原文要求'],source_call_ids:['read-1']}),/No observed/)
  f.p.observeRead({...f.exec,name:'read',callId:'bad'},{isError:true,value:{path:'x',lines:[],offset:1,totalLines:0}})
  assert.equal(f.p.view(f.exec).observedReads.length,1)
})
test('Host cwd is mandatory; model-supplied cwd cannot select someone else workspace',async()=>{
  const f=fixture(undefined);delete f.exec.agent.session.header.cwd
  await assert.rejects(intake(f),/Host-provided absolute/)
  assert.throws(()=>f.p.scope(f.exec,'../other'),/cwd|project_id/)
})
test('additive project SOP saves as trial and routes with pinned requirements/version',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec)
  assert.equal(saved.status,'trial')
  const out=await f.t.execute({action:'route',sop_id:spec.sop_id,sop_revision:saved.revision},f.exec)
  assert.equal(out.status.run.playbookId,'culture-method');assert.equal(out.status.input.project.id,'taoist-culture')
  assert.equal(out.status.input.sop.revision,saved.revision);assert.ok(out.status.input.contract.requirements.length)
  assert.equal(f.e.catalog.has('culture-method'),false)
})
test('same workspace keeps culture and experiment projects separate; different workspace cannot see definitions',async()=>{
  const f=fixture();await intake(f);await f.p.save(f.exec,spec)
  assert.equal(f.p.list(f.exec).length,1)
  const second={...f.exec,agent:{id:'s2',session:{header:{cwd:'/workspace/shared'}}}}
  f.r.remember('s2','制作B站实验视频');await f.p.intake(second,{project_id:'bilibili-ai',requirements:['保留真实实验数据'],source_call_ids:[]})
  assert.deepEqual(f.p.list(second),[])
  assert.throws(()=>f.p.inspect(second,spec.sop_id),/Unknown/)
  const alien={...second,agent:{id:'s',session:{header:{cwd:'/workspace/other'}}}}
  assert.deepEqual(f.p.list(alien),[])
})
test('method reuse ignores changed episode task/source files and does not create duplicate versions',async()=>{
  const f=fixture();await intake(f);const first=await f.p.save(f.exec,spec)
  f.r.clear('s');await intake(f,'taoist-culture','制作道家文化视频，主题换成下一章')
  const second=await f.p.save(f.exec,spec)
  assert.equal(second.reused,true);assert.equal(second.sop.revision,first.revision);assert.equal(f.p.list(f.exec).length,1)
})
test('removed QA validators create a non-executable draft',async()=>{
  const f=fixture();await intake(f);const d=structuredClone(f.e.getPlaybook(spec.base_id));d.stages.find(s=>s.id==='qa').gate.validators=[]
  const args={...spec,definition:d},v=f.p.validate(f.exec,args);assert.equal(v.requiresApproval,true)
  const saved=await f.p.save(f.exec,args);assert.equal(saved.status,'draft')
  await assert.rejects(f.t.execute({action:'route',sop_id:spec.sop_id,sop_revision:saved.revision},f.exec),/not executable/)
})
test('video authoring cannot substitute a weaker non-video base or a platform-only culture base',async()=>{
  const f=fixture();await intake(f)
  assert.throws(()=>f.p.validate(f.exec,{...spec,base_id:'task-intake'}),/non-video/)
  assert.throws(()=>f.p.validate(f.exec,{...spec,base_id:'bilibili-video-production'}),/domain base/)
})
test('approval is not a model action and task acceptance does not promote a trial',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec)
  await assert.rejects(f.t.execute({action:'sop_approve',sop_id:spec.sop_id,sop_revision:saved.revision},f.exec),/unsupported/)
  assert.equal(f.p.inspect(f.exec,spec.sop_id).status,'trial')
  await f.p.approve(f.exec,spec.sop_id,saved.revision)
  assert.equal(f.p.inspect(f.exec,spec.sop_id).status,'approved')
})
test('approved method cannot be replaced by generic fallback or differently named trial',async()=>{
  const f=fixture();await intake(f);const first=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,first.revision)
  const another=await f.p.save(f.exec,{...spec,sop_id:'culture-weaker-alias'})
  assert.equal(another.status,'trial')
  await assert.rejects(f.t.execute({action:'route',sop_id:'culture-weaker-alias'},f.exec),/approved project SOP/)
  await assert.rejects(f.t.execute({action:'route',playbook_id:spec.base_id},f.exec),/approved project SOP/)
})
test('dropping an approved project rule requires approval; record definition cannot change in place',async()=>{
  const f=fixture();await intake(f);const first=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,first.revision)
  const before=f.p.inspect(f.exec,spec.sop_id,first.revision)
  const weakened=await f.p.save(f.exec,{...spec,rules:[]})
  assert.equal(weakened.status,'draft');assert.ok(weakened.changes.some(x=>x.includes('project requirement')))
  assert.deepEqual(f.p.inspect(f.exec,spec.sop_id,first.revision),before)
})
test('stale parent approval is rejected; older approved revisions cannot silently replace current default',async()=>{
  const f=fixture();await intake(f);const a=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,a.revision)
  const b=await f.p.save(f.exec,{...spec,rules:[...spec.rules,'记录版本出处。']})
  const c=await f.p.save(f.exec,{...spec,rules:[...spec.rules,'保存来源引用。']})
  await f.p.approve(f.exec,spec.sop_id,b.revision)
  await assert.rejects(f.p.approve(f.exec,spec.sop_id,c.revision),/parent changed/)
  await assert.rejects(f.t.execute({action:'route',sop_id:spec.sop_id,sop_revision:a.revision},f.exec),/older approved/)
})
test('library and approved pointers survive hydration; corruption is refused',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,saved.revision)
  const g=fixture();g.e.hydrate(f.e.snapshot());assert.equal(g.p.inspect(g.exec,spec.sop_id).status,'approved')
  const state=g.p.state(g.p.scope(g.exec));state.records[saved.revision].definition.stages[0].gate.evidence=[]
  assert.throws(()=>g.p.inspect(g.exec,spec.sop_id),/digest mismatch/)
})
test('failed disk persistence rolls library mutation back; aborted save creates nothing',async()=>{
  const f=fixture();await intake(f);const before=f.e.snapshot();f.e.persist=async()=>{throw new Error('disk full')}
  await assert.rejects(f.p.save(f.exec,spec),/disk full/);assert.deepEqual(f.e.snapshot(),before)
  f.exec.signal=AbortSignal.abort();await assert.rejects(f.p.save(f.exec,spec));assert.deepEqual(f.e.snapshot(),before)
})
test('validation is read-only; invalid graph or unknown stages cannot be saved',async()=>{
  const f=fixture();await intake(f);const before=f.e.snapshot();f.p.validate(f.exec,spec);assert.deepEqual(f.e.snapshot(),before)
  assert.throws(()=>f.p.validate(f.exec,{...spec,stage_notes:{imaginary:['do it']}}),/Unknown stage/)
  const d=structuredClone(f.e.getPlaybook(spec.base_id));d.stages.find(s=>s.id==='handoff').next='brief'
  assert.throws(()=>f.p.validate(f.exec,{...spec,definition:d}),/terminal/)
})
test('changing approved library does not alter a run snapshot or permit re-intake mid-run',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec)
  await f.t.execute({action:'route',sop_id:spec.sop_id},f.exec)
  const frozen=structuredClone(f.e.activeRun('s').playbookSnapshot)
  await f.p.approve(f.exec,spec.sop_id,saved.revision)
  assert.deepEqual(f.e.activeRun('s').playbookSnapshot,frozen)
  await assert.rejects(f.p.intake(f.exec,{project_id:'new',requirements:['different task']}),/Cannot rebind|bound to project/)
})
test('protected diff catches graph jumps, instruction deletion, tool-policy changes, and receipt removal',()=>{
  const f=fixture(),base=f.e.getPlaybook('bug-fix')
  for(const mutate of [d=>{d.initialStage='implement'},d=>{d.stages[0].next='review'},d=>{d.stages[0].instructions=[]},d=>{d.stages[0].tools={}},d=>{d.stages.find(s=>s.id==='verify').gate.toolResults=[]}]){
    const d=structuredClone(base);mutate(d);assert.ok(protectedChanges(base,d).length)
  }
})
test('source and project metadata are present in immutable execution input, not a new global catalog entry',async()=>{
  const f=fixture();await intake(f,'taoist-culture','按 task.md 制作道家文化视频',['read-1'])
  const saved=await f.p.save(f.exec,spec)
  const out=await f.t.execute({action:'route',sop_id:spec.sop_id,sop_revision:saved.revision},f.exec)
  assert.equal(out.status.input.contract.sources[0].callId,'read-1')
  assert.equal(out.status.input.sop.status,'trial');assert.equal(f.e.getPlaybook(spec.sop_id),undefined)
})

test('Agent cannot rename the bound project to escape approved rules; user can explicitly bind an independent project',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,saved.revision)
  await assert.rejects(f.p.intake(f.exec,{project_id:'culture-alias',requirements:['same video']}),/bound/)
  const next={...f.exec,agent:{id:'new-session',session:{header:{cwd:'/workspace/shared'}}}}
  f.r.remember('new-session','制作道家文化视频')
  await assert.rejects(f.p.intake(next,{project_id:'culture-alias',requirements:['same video']}),/confirmed method/)
  await f.p.bindHuman(next,'independent-culture-project')
  const out=await f.p.intake(next,{project_id:'independent-culture-project',requirements:['第二个明确独立栏目']})
  assert.equal(out.project.id,'independent-culture-project')
})
test('unknown declared protection fields fail loudly instead of being dropped',async()=>{
  const f=fixture();await intake(f);const d=structuredClone(f.e.getPlaybook(spec.base_id));d.magicSecurity=true
  assert.throws(()=>f.p.validate(f.exec,{...spec,definition:d}),/Unsupported SOP field/)
})
test('new model/session can discover an approved method and reuse it after fresh intake without authoring again',async()=>{
  const f=fixture();await intake(f);const saved=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,saved.revision)
  const g=fixture('/workspace/shared','new-model-session');g.e.hydrate(f.e.snapshot())
  assert.equal(g.p.view(g.exec).availableProjects[0].projectId,'taoist-culture')
  await intake(g,'taoist-culture','制作道家文化视频，今天讲另一章')
  const out=await g.t.execute({action:'route',sop_id:spec.sop_id},g.exec)
  assert.equal(out.status.input.sop.revision,saved.revision);assert.equal(out.status.input.sop.status,'approved')
  assert.equal(g.p.list(g.exec).length,1)
})

test('script-only requests do not force a full video deliverable',()=>{
  assert.equal(isVideoTask('只写 B站视频脚本，不做成片'),false)
})
test('creating a new document is not mistaken for a supplied source',async()=>{
  const {mentionsSource}=await import('../src/intake-policy.js')
  assert.equal(mentionsSource('给我写一份文档'),false)
  assert.equal(mentionsSource('生成 README.md'),false)
  assert.equal(mentionsSource('读取 README.md 然后开发插件'),true)
})

test('a complete pasted task brief is user input, not a nonexistent file that must be read',async()=>{
  const f=fixture();const raw='# 道家文化视频任务书\n'+Array.from({length:12},(_,i)=>`## 第${i+1}条\n保留这份任务书给定的完整叙事与原文，核对来源并采用自然口播，不为预设时长加速。请按本段要求保持内容完整，不改写已确定的原文。`).join('\n')
  const out=await intake(f,'taoist-culture',raw)
  assert.equal(out.sources.length,0);assert.equal(out.suggestedBase,'taoist-culture-video')
})

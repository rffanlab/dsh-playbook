import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeTask, requestLead } from '../src/task-scope.js'
import { isVideoTask, projectHint } from '../src/intake-policy.js'
import { PlaybookEngine } from '../src/engine.js'
import { PlaybookRouter } from '../src/routing.js'
import { ProjectLibrary } from '../src/project-library.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { playbookDefinition } from '../src/tool.js'

// Synthetic contract: no private Session, paths, credentials or user media.
export const integrationTask = `将下面的工具全局同步给所有session：# DSH 核心工具接入契约：Media Tools

## 接入原则
固定 CLI，参数数组启动，保留权限及脱敏错误。
## 语音识别
输入支持常见音视频格式，包括 wav、mp3、mp4、webm。
## 语音合成
为视频提供自然口播配音，支持字幕。
## 图片生成
参考图、封面、旁白和视频工作流都是接口示例，不是本次产物。
\`\`\`json
{"prompt":"生成一条道家文化视频","video":"example.mp4"}
\`\`\``
const cases = [
  [integrationTask,'software'],
  ['为所有 Session 接入视频工具','software'],
  ['开发一个视频生成插件','software'],
  ['创建一个视频剪辑工具','software'],
  ['把这个配音接口注册为 DSH 工具','software'],
  ['修复视频渲染脚本的错误','software'],
  ['Deploy a video generation service','software'],
  ['Integrate speech and video tools into all sessions','software'],
  ['审查这个视频渲染脚本','software'],
  ['只写 B站视频脚本，不做成片','document'],
  ['帮我更新 AGENTS.md，同步视频工具说明','document'],
  ['写一篇公众号介绍道家视频制作','document'],
  ['只要口播稿，不生成视频','document'],
  ['给这段视频生成字幕','document'],
  ['Write a video script, not an MP4','document'],
  ['生成视频封面','image'],
  ['只要一张视频封面','image'],
  ['Generate a video cover image','image'],
  ['给视频配音','audio'],
  ['生成视频配音音频','audio'],
  ['Generate narration audio for this video','audio'],
  ['帮我审一下这个视频','video-review'],
  ['Review the existing video','video-review'],
  ['检查 final.mp4，不重新制作','video-review'],
  ['分析视频的播放数据','analysis'],
  ['编写视频制作 SOP','sop-authoring'],
  ['Design a video production playbook','sop-authoring'],
  ['制作一条道家文化视频，发到B站','video-production'],
  ['帮我做一期B站实验视频','video-production'],
  ['Produce a short video about a media CLI','video-production'],
  ['# 道家文化视频任务书\n\n## 方法\n自然口播。','video-production'],
  ['这个视频工具是什么？','unknown'],
  ['怎么接入视频工具？','information'],
]
for (const [task,kind] of cases) test(`deliverable, not subject: ${task.split('\n')[0]}`,()=>{
  assert.equal(analyzeTask(task).kind,kind)
  assert.equal(isVideoTask(task),kind==='video-production')
})
test('adding API examples never changes an explicit engineering request into production',()=>{
  const task='请接入下面的 CLI 工具。\n\n## Input\n'+('支持音视频格式；生成道家文化视频，制作封面和自然口播。\n').repeat(100)
  assert.equal(analyzeTask(task).kind,'software')
  assert.equal(projectHint(task),'plugin-development')
  assert.ok(!requestLead(task).includes('支持'))
})
test('a writing instruction is not the executable job contained in a video brief',()=>{
  const source='# 道家文化视频任务书\n制作一条成片。'
  assert.equal(analyzeTask('把附件整理成一份文档',[source]).producesVideo,false)
  assert.equal(analyzeTask('写一份公众号文章介绍附件',[source]).kind,'document')
})
test('explicit delegation can use a real source heading without scanning capability examples',()=>{
  assert.equal(analyzeTask('按附件完成任务',['# 道家文化视频任务书\n\n## 交付\n成片']).suggestedBase,'taoist-culture-video')
  assert.equal(analyzeTask('按附件完成任务',['# DSH 核心工具接入契约\n\n## 输入\n支持视频格式']).kind,'software')
  assert.equal(analyzeTask('按附件完成任务',['# 参考资料\n\n## 示例\n制作视频']).kind,'unknown')
})
test('compound deliverables remain ambiguous instead of claiming all of them are videos',()=>{
  const scope=analyzeTask('开发一个视频插件，然后制作一条演示视频')
  assert.equal(scope.kind,'mixed');assert.deepEqual(scope.kinds,['software','video-production'])
})
test('later direct-user clarification can change a pre-start deliverable; examples cannot',()=>{
  const task='制作一条视频\n用户补充 / Clarification: 这次只要文案，不做成片'
  assert.equal(analyzeTask(task).kind,'document')
})
function fixture() {
  const e=new PlaybookEngine();for(const p of BUILTIN_PLAYBOOKS)e.register(p)
  const r=new PlaybookRouter(e),p=new ProjectLibrary(e,r);r.projects=p
  const exec={agent:{id:'s',session:{header:{cwd:'/workspace/media-project'}}},signal:new AbortController().signal}
  const t=playbookDefinition(e,async()=>[],r,async()=>{},undefined,undefined,p)
  async function intake(task,project='media-tools',extra={}) {
    r.clear('s');r.remember('s',task);p.capture('s',task)
    return p.intake(exec,{project_id:project,requirements:['保留当前用户要求和原权限边界。'],...extra})
  }
  return {e,r,p,exec,t,intake}
}
test('same original request → intake → correct engineering route, without rebinding',async()=>{
  const f=fixture(),intake=await f.intake(integrationTask)
  assert.equal(intake.suggestedBase,'dsh-plugin-development')
  const out=await f.t.execute({action:'route',playbook_id:'dsh-plugin-development',note:'Global CLI integration is software, not media production.'},f.exec)
  assert.equal(out.status.input.project.id,'media-tools')
  assert.equal(out.status.input.contract.taskScope.producesVideo,false)
  assert.equal(f.e.activeRun('s').playbookSnapshot.stages.flatMap(s=>s.gate.validators).length,0)
})
test('pre-start stale video hint is recomputed, not treated as an immutable quality requirement',async()=>{
  const f=fixture();await f.intake(integrationTask)
  f.p.prepared.get('s').hint='short-video-production'
  const out=await f.t.execute({action:'route',playbook_id:'dsh-plugin-development',note:'Read actual requested integration instead of cached hint.'},f.exec)
  assert.equal(out.status.run.playbookId,'dsh-plugin-development')
})
test('an actual video task cannot be disguised as integration using model task/note/requirements',async()=>{
  const f=fixture();await f.intake('制作一条道家文化视频','media-tools',{requirements:['其实只是配置，不需要视频']})
  await assert.rejects(f.t.execute({action:'route',playbook_id:'dsh-plugin-development',task:'只接入工具',note:'I claim the user does not need media'},f.exec),{code:'SOP_TASK_MISMATCH'})
  assert.equal(f.e.runs.size,0)
})
test('wrong video route for a non-video deliverable is caught BEFORE allocation',async()=>{
  const f=fixture();await f.intake(integrationTask)
  await assert.rejects(f.t.execute({action:'route',playbook_id:'short-video-production',note:'The document mentions video formats'},f.exec),{code:'SOP_TASK_MISMATCH'})
  assert.equal(f.e.runs.size,0)
  await f.t.execute({action:'route',playbook_id:'dsh-plugin-development',note:'Correct the output family under the same project'},f.exec)
  assert.equal(f.e.status('s').run.playbookId,'dsh-plugin-development')
})
test('video-review and script-only can use non-production SOPs under a media project',async()=>{
  const f=fixture();await f.intake('审核这个视频，不重新制作')
  const a=await f.t.execute({action:'route',playbook_id:'video-review',note:'Only report observations on existing video'},f.exec)
  assert.equal(a.status.run.playbookId,'video-review')
  const g=fixture();await g.intake('只写视频脚本，不出片')
  const b=await g.t.execute({action:'route',playbook_id:'task-intake',note:'Script deliverable has no production requirement'},g.exec)
  assert.equal(b.status.run.playbookId,'task-intake')
})
test('a real read of a video document does not override the operation requested on that document',async()=>{
  const f=fixture();f.r.remember('s','写一篇公众号介绍这个文档 task.md');f.p.capture('s','写一篇公众号介绍这个文档 task.md')
  f.p.observeRead({...f.exec,name:'read',callId:'actual-read'},{isError:false,value:{path:'/workspace/media-project/task.md',offset:1,totalLines:1,lines:[{number:1,text:'# 道家文化视频任务书：制作成片'}]}})
  const a=await f.p.intake(f.exec,{project_id:'media-tools',requirements:['只交付文章'],source_paths:['task.md']})
  assert.equal(a.taskScope.kind,'document')
  assert.equal((await f.t.execute({action:'route',playbook_id:'wechat-article',note:'The requested output is an article, not its subject'},f.exec)).status.run.playbookId,'wechat-article')
})
test('an approved video method in the SAME project does not govern a new engineering task',async()=>{
  const f=fixture();await f.intake('制作一条道家文化视频')
  const spec={sop_id:'culture-method',base_id:'taoist-culture-video',rules:['完整保留用户已确认台词。']}
  const saved=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,saved.revision)
  const immutable=structuredClone(f.e.sopLibrary.projects)
  await f.intake(integrationTask)
  assert.equal(f.p.list(f.exec)[0].matchesCurrentTask,false)
  const out=await f.t.execute({action:'route',playbook_id:'dsh-plugin-development',note:'Different deliverable in the same media project'},f.exec)
  assert.equal(out.status.input.project.id,'media-tools')
  assert.deepEqual(f.e.sopLibrary.projects,immutable)
})
test('production still uses the protected method, not a renamed fallback',async()=>{
  const f=fixture();await f.intake('制作一条道家文化视频')
  const spec={sop_id:'culture-method',base_id:'taoist-culture-video',rules:['完整保留用户已确认台词。']}
  const a=await f.p.save(f.exec,spec);await f.p.approve(f.exec,spec.sop_id,a.revision)
  await assert.rejects(f.t.execute({action:'route',playbook_id:'taoist-culture-video'},f.exec),/approved project SOP/)
})
test('an active video cannot be reclassified in-place through intake or route',async()=>{
  const f=fixture();await f.intake('制作一条道家文化视频')
  const out=await f.t.execute({action:'route',playbook_id:'taoist-culture-video'},f.exec)
  const before=f.e.snapshot()
  await assert.rejects(f.p.intake(f.exec,{project_id:'media-tools',task:'接入 CLI 工具',requirements:['只配置']}),/Cannot rebind/)
  const second=await f.t.execute({action:'route',playbook_id:'dsh-plugin-development',task:integrationTask},f.exec)
  assert.equal(second.reused,true);assert.equal(second.status.run.id,out.status.run.id);assert.deepEqual(f.e.snapshot(),before)
})
test('recommendations and intake agree on non-media purpose even with many media nouns',()=>{
  const f=fixture(),d=f.r.recommend(integrationTask)
  assert.equal(d.recommendedId,'dsh-plugin-development')
  assert.equal(d.taskScope.producesVideo,false)
  assert.ok(d.candidates.every(c=>!['short-video-production','bilibili-video-production','taoist-culture-video','video-review'].includes(c.id)))
})
test('unclassified input is not rejected or converted to mandatory media work',async()=>{
  const f=fixture(),a=await f.intake('处理一下这个项目里的材料')
  assert.equal(a.taskScope.kind,'unknown');assert.equal(a.suggestedBase,null)
  const out=await f.t.execute({action:'route',playbook_id:'task-intake',note:'No specialized task was specified; define actual outputs first'},f.exec)
  assert.equal(out.status.run.playbookId,'task-intake')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeTask } from '../src/task-scope.js'
import { PlaybookEngine } from '../src/engine.js'
import { PlaybookRouter } from '../src/routing.js'
import { ProjectLibrary } from '../src/project-library.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { createIntakeProgress } from '../src/intake-progress.js'
import { install } from '../src/host.js'

// Minimal anonymous reproduction of the syntax and tool-result shape, not a private log.
const videoTask='按照下面的文档来执行视频的生成，注意了语音合成用指定服务提供的本人声音。不要用另一个语音工具。文档如下：庄子文化短片\n\n本次交付完整视频和报告，保留原稿。' + '\n\n' + Array.from({length:10}, (_,i) => `${i+1}. 核对现有任务要求并保留指定口播方式。视频需按完整文稿完成制作；每段口播与画面对应，字幕需可读。本条为匿名测试任务书内容，必须保留真实来源记录，不涉及新的权限请求或媒体 API 示例。`).join('\n')
const cases=[
 [videoTask,'video-production'],
 ['按照文档进行视频的生成，注意语音合成用已安装的声音服务。','video-production'],
 ['按要求完成成片的制作，旁白使用本人声音。','video-production'],
 ['制作一条视频，配音采用本地声音服务，画面用已授权素材。','video-production'],
 ['生成一条道家视频，注意了语音合成用本人声音。','video-production'],
 ['制作一个使用本人声音配音的视频','video-production'],
 ['制作视频，使用本地服务生成旁白音频','video-production'],
 ['render a final video file mp4 from narration audio and generated images, deliver the produced video','video-production'],
 ['Create a video using cloned voice and generated images','video-production'],
 ['Create a video, voiceover uses the configured service.','video-production'],
 ['用本人声音制作视频','video-production'],
 ['制作视频，另外单独生成一首原创歌曲','mixed'],
 ['制作视频，额外开发配音服务的 API','mixed'],
 ['制作一个语音生成服务的演示视频','video-production'],
 ['开发视频生成插件，然后制作一条演示视频','mixed'],
 ['只做视频配音，不需要视频成片','audio'],
 ['Generate narration audio for this video','audio'],
 ['生成视频封面','image'],
 ['只写配音接口的说明文档','document'],
 ['将支持视频生成和语音合成的工具接入所有 Session','software'],
 ['编写视频生成流程的 SOP','sop-authoring'],
 ['怎么执行视频的生成？','information'],
 ['更新视频生成的说明文档','document'],
]
for(const [text,kind] of cases)test(`deliverable plus constraints: ${text.split('\n')[0]}`,()=>assert.equal(analyzeTask(text).kind,kind))
function core(task='只制作口播音频') {
 const e=new PlaybookEngine();for(const p of BUILTIN_PLAYBOOKS)e.register(p)
 const r=new PlaybookRouter(e),p=new ProjectLibrary(e,r);r.projects=p
 const progress=createIntakeProgress(e,r)
 const exec={agent:{id:'s',session:{header:{cwd:'/workspace/intake-fixture'}}},callId:'question',token:Symbol(),signal:new AbortController().signal}
 r.remember('s',task);p.capture('s',task)
 const questions=[{id:'deliverable',question:'请确认本次交付物是什么？',options:[{label:'完整视频成片 mp4'},{label:'只要口播音频'}]}]
 const ask={...exec,name:'ask_user_question',arguments:{questions}}
 return {e,r,p,progress,exec,ask}
}
const answer=text=>({isError:false,value:{answers:[{id:'deliverable',selected:[],custom:text}]}})
test('actual native free-text answer updates prepared scope without discarding original requirements',async()=>{
 const f=core();await f.p.intake(f.exec,{project_id:'culture',requirements:['本人声音，速度固定；不改已有许可边界。']})
 const prior=f.p.prepared.get('s').contractDigest
 f.progress.observeCall(f.ask)
 assert.equal(f.progress.observeResult(f.ask,answer('做成完整的成片，跟以前一样。')),true)
 assert.equal(f.p.view(f.exec).prepared.taskScope.kind,'video-production')
 assert.notEqual(f.p.prepared.get('s').contractDigest,prior)
 assert.deepEqual(f.p.prepared.get('s').requirements,['本人声音，速度固定；不改已有许可边界。'])
 const out=await f.r.route('s',{playbookId:'short-video-production',note:'Native user changed the deliverable before any execution.',exec:f.exec})
 assert.equal(out.started,true);assert.equal(out.status.input.contract.clarifications[0].source,'host-ask-user-result')
 assert.ok(out.status.input.task.includes('只制作口播音频'));assert.ok(out.status.input.task.includes('完整的成片'))
})
test('generic video clarification retains the previously explicit cultural domain',()=>{
 const scope=analyzeTask(videoTask+'\n用户补充 / Clarification: 做成完整的成片，跟以前一样。')
 assert.equal(scope.suggestedBase,'taoist-culture-video')
})
test('only the actual selected label is used, not unselected recommended descriptions',()=>{
 const f=core();f.progress.observeCall(f.ask)
 assert.equal(f.progress.observeResult(f.ask,{isError:false,value:{answers:[{id:'deliverable',selected:['完整视频成片 mp4']}]}}),true)
 assert.equal(analyzeTask(f.r.session('s').pendingTask).kind,'video-production')
 assert.ok(!f.r.session('s').pendingTask.includes('只要口播音频'))
})
for(const [name,mutate] of [
 ['rendered-only output',(f)=>({result:{isError:false,content:[{type:'text',text:JSON.stringify(answer('制作视频').value)}]}})],
 ['different call',(f)=>({exec:{...f.ask,callId:'forged'}})],
 ['different Agent',(f)=>({exec:{...f.ask,agent:{...f.ask.agent}}})],
 ['unknown question id',(f)=>({result:{isError:false,value:{answers:[{id:'invented',selected:[],custom:'制作视频'}]}}})],
 ['unselected/unknown label',(f)=>({result:{isError:false,value:{answers:[{id:'deliverable',selected:['另一个选项']}]}}})],
 ['failed ask',(f)=>({result:{...answer('制作视频'),isError:true}})],
 ['ambiguous yes',(f)=>({result:answer('是的')})],
 ['cancelled ask',(f)=>({exec:{...f.ask,signal:AbortSignal.abort()}})],
])test(`untrusted/incomplete clarification ignored: ${name}`,()=>{
 const f=core(),before=f.r.session('s').pendingTask;f.progress.observeCall(f.ask)
 const v=mutate(f);assert.equal(f.progress.observeResult(v.exec??f.ask,v.result??answer('制作视频')),false)
 assert.equal(f.r.session('s').pendingTask,before)
})
test('late user answer never rewrites an active run or its fixed SOP',async()=>{
 const f=core();f.progress.observeCall(f.ask);await f.e.start('s','music-production',{task:'fixed task'})
 const before=f.e.snapshot()
 assert.equal(f.progress.observeResult(f.ask,answer('制作视频')),false);assert.deepEqual(f.e.snapshot(),before)
})
test('answer redelivery is idempotent and changed task rejects an older answer',()=>{
 const f=core();f.progress.observeCall(f.ask)
 f.progress.observeResult(f.ask,answer('制作视频'))
 const before=f.r.session('s').pendingTask
 assert.equal(f.progress.observeResult(f.ask,answer('制作视频')),false)
 assert.equal(f.r.session('s').pendingTask,before)
 const g=core();g.progress.observeCall(g.ask);g.r.remember('s','现在只写说明文档')
 assert.equal(g.progress.observeResult(g.ask,answer('制作视频')),false)
})
test('third repeated scope rejection ends only the native turn; it does not create a run or reset evidence',()=>{
 const f=core(),out={ok:false,error:{code:'SOP_TASK_MISMATCH',message:'wrong deliverable'},taskScope:analyzeTask('只制作口播音频'),message:'Select a matching method.'}
 let ends=0;const exec={...f.exec,concludeTurn:()=>{ends++}}
 f.progress.rejection(exec,out);f.progress.rejection(exec,out)
 assert.equal(ends,0)
 const stopped=f.progress.rejection(exec,out)
 assert.equal(ends,1);assert.equal(stopped.nextAction,'report_intake_stall');assert.equal(f.e.runs.size,0)
 f.progress.onHumanInput('s');f.progress.rejection(exec,out);assert.equal(ends,1)
})
test('without native concludeTurn, return an honest advisory rather than cancelling/clearing',()=>{
 const f=core();let out={ok:false,error:{code:'SOP_TASK_MISMATCH',message:'mismatch'},message:'Choose'}
 for(let i=0;i<3;i++)out=f.progress.rejection(f.exec,out)
 assert.equal(out.intakeProgress.nativeTurnStop,false);assert.equal(f.e.runs.size,0)
})
test('continuation after restart restores only the actual direct user task, not plugin docs or model claims',()=>{
 const f=core();f.r.clear('s')
 f.exec.agent.session.snapshotEvents=()=>[
  {type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:videoTask}]}},
  {type:'user/message',seq:2,data:{source:{kind:'plugin'},content:[{type:'text',text:'只要音频'}]}},
  {type:'user/message',seq:3,data:{source:{kind:'user'},content:[{type:'text',text:'继续任务'}]}},
 ]
 assert.equal(f.progress.restoreForContinuation(f.exec.agent,'继续任务'),true)
 assert.equal(f.r.session('s').pendingTask,videoTask)
 assert.equal(f.progress.restoreForContinuation(f.exec.agent,'改做一份文档'),false)
})

// Entire plugin wiring, not only individual classifier functions. The SDK is
// neutral here; exact native ask result shape is simulated, no real model used.
async function wired(t,task=videoTask) {
 const dir=await mkdtemp(join(tmpdir(),'intake-wiring-')),handlers=new Map(),guards=[],commands=new Map();let tool
 const ctx={tools:{register:d=>{tool=d},guard:g=>guards.push(g)},systemPrompt:{section:()=>{}},
  on:(n,f)=>{const rows=handlers.get(n)??[];rows.push(f);handlers.set(n,rows)},effect:()=>{},provide:()=>{},
  inject:(_deps,fn)=>fn(ctx),commands:{register:c=>commands.set(c.name,c)}}
 const e=install(ctx,{define:d=>d,message:p=>({id:'notice',...p}),paths:{state:join(dir,'state.json'),directory:join(dir,'catalog')}})
 const exec={agent:{id:'s',session:{header:{cwd:dir}}},signal:new AbortController().signal,callId:'call'}
 const call=a=>tool.execute(a,exec)
 await call({action:'list'})
 let messages=[{id:'user-1',source:{kind:'user'},content:[{type:'text',text:task}]}]
 const pre=handlers.get('agent/pre-step')[0]
 await pre({agent:exec.agent,signal:exec.signal,messages},async()=>({kind:'enter',messages}))
 t.after(async()=>{await e.queue;await rm(dir,{recursive:true,force:true})})
 return {e,exec,call,handlers,guards,pre}
}
test('full wiring: pasted video request + voice constraints → intake → first route succeeds',async t=>{
 const h=await wired(t)
 const intake=await h.call({action:'intake',project_id:'culture',requirements:['保留完整文稿；语音使用指定服务，不变速。']})
 assert.equal(intake.taskScope.kind,'video-production')
 const route=await h.call({action:'route',playbook_id:'taoist-culture-video',note:'A real full video with voice constraints.'})
 assert.equal(route.started,true);assert.equal(route.status.run.playbookId,'taoist-culture-video')
 assert.equal(route.status.run.stageId,'brief')
})
test('full wiring: native question result updates intake before the next model tool call',async t=>{
 const h=await wired(t,'只制作口播音频')
 await h.call({action:'intake',project_id:'media-project',requirements:['保留本人声音，不改任何宿主权限。']})
 const ask={...h.exec,token:Symbol(),name:'ask_user_question',callId:'actual-question',arguments:{questions:[{id:'deliverable',question:'本次交付物要完整成片还是音频？'}]}}
 for(const handler of h.handlers.get('tools/pre-execute')??[])await handler(ask,async()=>({kind:'allow'}))
 for(const handler of h.handlers.get('tools/result')??[])handler(ask,answer('做成完整的成片，跟以前一样。'))
 const out=await h.call({action:'route',playbook_id:'short-video-production',note:'The actual user answered that they need the full video.'})
 assert.equal(out.started,true);assert.equal(out.status.run.stageId,'brief')
})
test('full wiring: repeated wrong route returns terminal diagnosis instead of 60+ attempts',async t=>{
 const h=await wired(t,'只制作口播音频');await h.call({action:'intake',project_id:'audio-project',requirements:['只做音频']})
 let stops=0;h.exec.concludeTurn=()=>{stops++}
 let out
 for(let i=0;i<3;i++)out=await h.call({action:'route',playbook_id:'short-video-production',note:'Incorrectly selecting video as a synthetic regression.'})
 assert.equal(stops,1);assert.equal(out.nextAction,'report_intake_stall');assert.equal(h.e.runs.size,0)
})

test('malformed native result cannot throw in the observer or rewrite the task',()=>{
 const f=core(),before=f.r.session('s').pendingTask;f.progress.observeCall(f.ask)
 assert.equal(f.progress.observeResult(f.ask,{isError:false,value:{answers:[null]}}),false)
 assert.equal(f.r.session('s').pendingTask,before)
})
test('supplementary direct user feedback preserves real read receipts and existing requirements',async()=>{
 const f=core();await f.p.intake(f.exec,{project_id:'media',requirements:['固定音色，不新增权限']})
 const record={callId:'r',path:'/workspace/intake-fixture/task.md',start:1,end:1,totalLines:1,text:'observed'}
 f.p.receipts.set('s',new Map([['r',record]]))
 f.r.remember('s','做成完整视频');f.p.capture('s','做成完整视频',{clarification:true})
 assert.equal(f.p.prepared.get('s').taskScope.kind,'video-production')
 assert.equal(f.p.receipts.get('s').get('r'),record)
 assert.deepEqual(f.p.prepared.get('s').requirements,['固定音色，不新增权限'])
})
test('a newly referenced document invalidates prepared intake, not the real source-read evidence',async()=>{
 const f=core();await f.p.intake(f.exec,{project_id:'media',requirements:['existing input']})
 f.p.receipts.set('s',new Map([['r',{path:'/workspace/intake-fixture/old.md'}]]))
 f.r.remember('s','根据新的任务书 updated-task.md 执行视频制作')
 f.p.capture('s','根据新的任务书 updated-task.md 执行视频制作',{clarification:true})
 assert.equal(f.p.prepared.has('s'),false);assert.equal(f.p.receipts.has('s'),true)
})
test('native continuation pre-step restores a pre-start task after transient-state restart',async t=>{
 const h=await wired(t,'你好')
 h.exec.agent.session.snapshotEvents=()=>[
  {type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:videoTask}]}},
  {type:'user/message',seq:2,data:{source:{kind:'user'},content:[{type:'text',text:'继续任务'}]}}
 ]
 const messages=[{id:'continuation',source:{kind:'user'},content:[{type:'text',text:'继续任务'}]}]
 await h.pre({agent:h.exec.agent,signal:h.exec.signal,messages},async()=>({kind:'enter',messages}))
 const intake=await h.call({action:'intake',project_id:'culture',requirements:['保留完整文稿和本人声音']})
 assert.equal(intake.taskScope.kind,'video-production')
 const routed=await h.call({action:'route',playbook_id:'taoist-culture-video',note:'Continue the actual original video task without retyping the entire brief.'})
 assert.equal(routed.started,true)
})

test('actual clarification adds next-step context without waking another turn or changing the result',()=>{
 const f=core(),messages=[]
 f.exec.agent.inject=m=>messages.push(m)
 const p=createIntakeProgress(f.e,f.r,{createMessage:m=>({id:'clarification',...m})})
 const result=answer('做成完整的成片，跟以前一样。'),before=structuredClone(result)
 p.observeCall(f.ask);assert.equal(p.observeResult(f.ask,result),true)
 assert.deepEqual(result,before);assert.equal(messages.length,1);assert.equal(messages[0].source.kind,'plugin')
 assert.match(messages[0].content[0].text,/video-production/)
})

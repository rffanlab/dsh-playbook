import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host.js'
const book={id:'rework-fixture',delivery:{review:true,revisionStage:'diagnose',repairStages:['produce','qa'],maxSelfRepairs:3},stages:[
  {id:'produce',objective:'Produce an output',gate:{evidence:['artifact']}},
  {id:'qa',objective:'Check it',gate:{evidence:['checked']},next:null},
  {id:'diagnose',objective:'Diagnose human feedback',gate:{evidence:['problem']},next:'produce'}]}
async function host(t) {
 const dir=await mkdtemp(join(tmpdir(),'revision-wakeup-')),commands=new Map(),hooks=new Map(),tools=new Map(),wakes=[]
 let n=0
 const agent={id:'s',status:'idle',session:{header:{cwd:dir}},inbox:{nextStep:[],nextTurn:[]},steer(message){this.inbox.nextStep.push(message);wakes.push(message);this.status='running'}}
 const ctx={on:(name,fn)=>hooks.set(name,fn),tools:{guard:()=>{},register:d=>tools.set(d.name,d)},systemPrompt:{section:()=>{}},commands:{register:c=>commands.set(c.name,c)},effect:()=>{},provide:()=>{},inject:(_a,fn)=>fn(ctx)}
 const path=join(dir,'state.json')
 const engine=install(ctx,{define:x=>x,message:p=>({id:`m-${++n}`,...p}),paths:{directory:join(dir,'catalog'),state:path}})
 const signal=new AbortController().signal
 await tools.get('playbook').execute({action:'list'},{agent,signal});engine.register(book)
 await engine.start('s',book.id,{task:'Keep original content except explicitly rejected parts'})
 await engine.submit('s',{stageId:'produce',evidence:{artifact:'fixture output'}})
 await engine.submit('s',{stageId:'qa',evidence:{checked:'fixture checks'}})
 const command=(rawInput,{commandId=`cmd-${++n}`,abort=signal}={})=>commands.get('playbook').handler({agent,commandId,rawInput,signal:abort})
 t.after(async()=>{await engine.queue;await rm(dir,{recursive:true,force:true})})
 return {engine,agent,path,command,wakes,hooks,tools,signal}
}
test('reject while idle persists feedback then actually steers the same Agent without a follow-up prompt',async t=>{
 const h=await host(t),old=h.engine.status('s');const received=[]
 h.agent.steer=function(message){
  const r=h.engine.status('s');assert.equal(r.run.revision,1);assert.equal(r.revisionDispatch.state,'pending')
  received.push(message);this.status='running'
 }
 const out=await h.command('revise 没有字幕，内容只是图片堆砌。')
 assert.equal(out.kind,'success',out.text);assert.match(out.text,/无需再发/)
 assert.equal(received.length,1);assert.equal(received[0].source.kind,'plugin')
 assert.match(received[0].content[0].text,/没有字幕/)
 const s=h.engine.status('s');assert.equal(s.run.id,old.run.id);assert.equal(s.run.stageId,'diagnose');assert.equal(s.revisionDispatch.state,'queued')
 assert.deepEqual(s.input,old.input);assert.equal(h.engine.archives.size,0)
 assert.equal(JSON.parse(await readFile(h.path,'utf8')).runs.s.revisionDispatches[0].state,'queued')
})
test('native inbox claimed receipt is recorded, not mislabeled completed rework',async t=>{
 const h=await host(t);await h.command('revise 修正字幕')
 const msg=h.wakes[0];h.hooks.get('agent/inbox/claimed')({agent:h.agent,message:msg,turn:3})
 await h.engine.queue
 const s=h.engine.status('s');assert.equal(s.revisionDispatch.state,'claimed');assert.equal(s.run.state,'active');assert.equal(s.run.stageId,'diagnose')
})
test('second review while active appends feedback and steers, not another revision or stage reset',async t=>{
 const h=await host(t);await h.command('revise 没有字幕，图片堆砌')
 await h.engine.repair('s','produce','Use the existing approved assets and repair the actual defect')
 const before=h.engine.status('s'),b=before.workBudget
 const out=await h.command('revise 补充：文稿不变，改进分镜与字幕可读性')
 assert.equal(out.kind,'success',out.text);const s=h.engine.status('s')
 assert.equal(s.run.revision,1);assert.equal(s.run.stageEpoch,before.run.stageEpoch);assert.equal(s.run.stageId,'produce')
 assert.deepEqual(s.workBudget,b);assert.deepEqual(s.evidence,before.evidence)
 assert.equal(s.revisionFeedback.supplements.length,1);assert.match(s.revisionFeedback.supplements[0].reason,/文稿不变/)
 assert.equal(h.wakes.length,2)
})
test('same command id redelivery does not repeat transition, feedback or wake',async t=>{
 const h=await host(t),args={commandId:'same'}
 await h.command('revise 字幕看不清',args);const before=h.engine.snapshot()
 await h.command('revise 字幕看不清',args)
 assert.deepEqual(h.engine.snapshot(),before);assert.equal(h.wakes.length,1)
})
test('distinct overlapping review requests serialize and preserve both opinions',async t=>{
 const h=await host(t);await Promise.all([h.command('revise 字幕看不清'),h.command('revise 镜头过于单调')])
 const s=h.engine.status('s');assert.equal(s.run.revision,1);assert.equal(s.revisionFeedback.supplements.length,1);assert.equal(h.wakes.length,2)
})
test('pre-aborted user command neither changes state nor wakes an Agent',async t=>{
 const h=await host(t),before=h.engine.snapshot()
 assert.equal((await h.command('revise 修改字幕',{abort:AbortSignal.abort()})).kind,'error')
 assert.deepEqual(h.engine.snapshot(),before);assert.equal(h.wakes.length,0)
})
test('state save failure cannot send uncommitted feedback; retry same event commits and sends once',async t=>{
 const h=await host(t),before=h.engine.snapshot(),persist=h.engine.persist
 h.engine.persist=async()=>{throw new Error('disk fixture failure')}
 const opts={commandId:'retry-state'};assert.equal((await h.command('revise 修正字幕',opts)).kind,'error')
 assert.deepEqual(h.engine.snapshot(),before);assert.equal(h.wakes.length,0)
 h.engine.persist=persist;assert.equal((await h.command('revise 修正字幕',opts)).kind,'success');assert.equal(h.wakes.length,1)
})
test('native sender rejection preserves saved feedback and exact failure, retry same event does not increment revision',async t=>{
 const h=await host(t),send=h.agent.steer
 h.agent.steer=()=>{throw new Error('Host disposed fixture')}
 const opts={commandId:'retry-native'};const out=await h.command('revise 改进字幕',opts)
 assert.equal(out.kind,'error');assert.match(out.text,/Host disposed fixture/);assert.match(out.text,/意见已保存/)
 assert.equal(h.engine.status('s').run.revision,1);assert.equal(h.engine.status('s').revisionDispatch.state,'failed')
 h.agent.steer=send;assert.equal((await h.command('revise 改进字幕',opts)).kind,'success');assert.equal(h.wakes.length,1);assert.equal(h.engine.status('s').run.revision,1)
})
test('missing waking API does not fall back to inject or claim execution started',async t=>{
 const h=await host(t);delete h.agent.steer;h.agent.inject=()=>assert.fail('inject cannot wake an idle Agent')
 const out=await h.command('revise 改进字幕');assert.equal(out.kind,'error');assert.match(out.text,/REVISION_STEER_UNAVAILABLE/)
 assert.equal(h.engine.status('s').run.state,'active');assert.equal(h.engine.status('s').revisionDispatch.state,'failed')
})
test('post-send audit write failure does not send twice when same command is retried',async t=>{
 const h=await host(t),persist=h.engine.persist
 h.engine.persist=async state=>{if(state.runs.s.revisionDispatches?.at(-1)?.state==='queued')throw new Error('post-send disk error');await persist(state)}
 const opts={commandId:'audit-retry'},out=await h.command('revise 字幕不清晰',opts)
 assert.equal(out.kind,'error');assert.match(out.text,/AUDIT_FAILED/);assert.equal(h.wakes.length,1)
 h.engine.persist=persist;await h.command('revise 字幕不清晰',opts);assert.equal(h.wakes.length,1);assert.equal(h.engine.status('s').run.revision,1)
})
test('queued message cancellation is observable and a duplicate command does not silently restart it',async t=>{
 const h=await host(t);const opts={commandId:'discarded'};await h.command('revise 修改字幕',opts)
 h.hooks.get('agent/inbox/discarded')({agent:h.agent,message:h.wakes[0]});await h.engine.queue
 const out=await h.command('revise 修改字幕',opts);assert.match(out.text,/宿主取消/);assert.equal(h.wakes.length,1)
})
test('stale UI target and cancelled Run never dispatch work',async t=>{
 const h=await host(t),target=h.engine.status('s').reviewControl.target
 await h.command('revise 修改字幕');const count=h.wakes.length
 assert.equal((await h.command('review reject '+target+' More feedback')).kind,'error');assert.equal(h.wakes.length,count)
 await h.engine.cancel('s');assert.equal((await h.command('revise 修改字幕')).kind,'error');assert.equal(h.wakes.length,count)
})
test('plain user chat already drives execution; it does not enqueue a second model turn',async t=>{
 const h=await host(t),m={id:'u1',source:{kind:'user'},content:[{type:'text',text:'拒绝候选，字幕不清楚'}]}
 const pre=(m)=>h.hooks.get('agent/pre-step')({agent:h.agent,signal:h.signal,messages:[m]},async()=>({kind:'enter',messages:[m]}))
 await pre(m);assert.equal(h.engine.status('s').run.revision,1);assert.equal(h.wakes.length,0)
 const second={...m,id:'u2',content:[{type:'text',text:'拒绝候选，补充：不要改文稿'}]};await pre(second)
 assert.equal(h.engine.status('s').run.revision,1);assert.equal(h.engine.status('s').revisionFeedback.supplements.length,1);assert.equal(h.wakes.length,0)
})
test('automatic intake off does not disable waking an explicit review command',async t=>{
 const h=await host(t);await h.command('auto off');await h.command('revise 修正字幕')
 assert.equal(h.wakes.length,1);assert.equal(h.engine.status('s').run.state,'active')
})
test('review controls cannot be invoked through model tool args',async t=>{
 const h=await host(t)
 for(const action of ['revise','reject','dispatch_revision']) await assert.rejects(h.tools.get('playbook').execute({action},{agent:h.agent,signal:h.signal}),/unsupported/)
 assert.equal(h.wakes.length,0);assert.equal(h.engine.status('s').run.state,'awaiting_review')
})

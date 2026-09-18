/** Real DSH command registry + AgentLoop + inbox + tool runtime.
 * The LLM adapter is scripted: no API key, real model, browser or video rendering.
 * Contract basis: upstream agent-loop/tests/agent.spec.ts and mock-adapter.ts.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import { install } from '../src/host.js'

let openFirst,releaseFirst
const firstEntered=new Promise(resolve=>{openFirst=resolve})
const firstRelease=new Promise(resolve=>{releaseFirst=resolve})
class ScriptedAdapter extends LlmAdapter {
  requests=[]
  async resolveModel(provider,model){return {provider,id:model,name:model}}
  async *stream(options){
    this.requests.push(options)
    if(this.requests.length===1){
      openFirst();await firstRelease
      const argumentsJson=JSON.stringify({action:'submit',stage_id:'diagnose',evidence:{problem:'Synthetic driver check: read saved feedback and enter the original correction stage.'}})
      yield {type:'block-start',index:0,blockType:'tool-call'}
      yield {type:'tool-call-delta',index:0,id:ToolCallId('revision-tool'),name:'playbook',argumentsDelta:argumentsJson}
      yield {type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId('revision-tool'),name:'playbook',arguments:argumentsJson}}
      yield {type:'finish',reason:{kind:'tool-calls'}}
    }else{
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:'Scripted acknowledgment; this is not a completed video.'}
      yield {type:'block-end',index:0,block:{type:'text',text:'Scripted acknowledgment; this is not a completed video.'}}
      yield {type:'finish',reason:{kind:'stop'}}
    }
  }
}
const ctx=new Context(),adapter=new ScriptedAdapter()
for(const plugin of [LlmRuntime,SessionStore,Projections,SystemPrompt,Tools,AgentRegistry,Commands])await ctx.plugin(plugin)
await ctx.plugin(AgentLoop,{agents:[]})
ctx.llm.registerAdapter(['scripted-review'],adapter)
const workspace=await mkdtemp(join(tmpdir(),'real-review-loop-'))
const engine=install(ctx,{define:defineTool,message:createUserMessage,paths:{directory:join(workspace,'sops'),state:join(workspace,'state.json')}})
const agent=await ctx.agentLoop.create(SessionId('revision-driver'),{provider:'scripted-review',model:'no-real-model'})
// Await hydration via the actual registered command, not a timing assumption.
const signal=new AbortController().signal
async function command(text){
  const result=await ctx.commands.execute(agent,'/playbook '+text,[],signal)
  assert.equal(result?.result?.kind,'success',JSON.stringify(result));return result
}
function bounded(promise,label){
  let timer
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),15000)})]).finally(()=>clearTimeout(timer))
}
try{
  await command('status json')
  engine.register({id:'driver-fixture',delivery:{review:true,revisionStage:'diagnose',repairStages:['produce','qa'],maxSelfRepairs:3},stages:[
    {id:'produce',objective:'Prepare fixture output',gate:{evidence:['artifact']}},
    {id:'qa',objective:'Check fixture',gate:{evidence:['checked']},next:null},
    {id:'diagnose',objective:'Execute requested rework',gate:{evidence:['problem']},next:'produce'},
  ]})
  await engine.start(String(agent.id),'driver-fixture',{task:'Synthetic same-run rework'})
  await engine.submit(String(agent.id),{stageId:'produce',evidence:{artifact:'fixture'}})
  await engine.submit(String(agent.id),{stageId:'qa',evidence:{checked:'fixture'}})
  const before=agent.session.snapshotEvents(),runId=engine.status(String(agent.id)).run.id
  assert.equal(agent.status,'idle');assert.equal(adapter.requests.length,0)
  const result=await command('revise 字幕不清晰，内容只是图片堆砌。')
  assert.match(result.result.text,/投递返修指令/)
  await bounded(firstEntered,'native steer -> model request')
  assert.equal(agent.status,'running')
  assert.equal(engine.status(String(agent.id)).run.revision,1)
  // This second user command arrives DURING the first actual model request.
  await command('revise 补充：不要改已确认的口播原文。')
  assert.equal(engine.status(String(agent.id)).run.revision,1)
  assert.equal(engine.status(String(agent.id)).revisionFeedback.supplements.length,1)
  releaseFirst()
  await bounded(agent.whenIdle(),'native loop settling after tool execution')
  await engine.queue
  const events=agent.session.snapshotEvents().slice(before.length)
  assert.equal(engine.status(String(agent.id)).run.id,runId)
  assert.equal(engine.status(String(agent.id)).run.stageId,'produce')
  assert.equal(engine.status(String(agent.id)).run.state,'active')
  assert.equal(engine.status(String(agent.id)).revisionDispatch.state,'claimed')
  assert.equal(events.filter(e=>e.type==='turn/start').length,1,'busy steering must not create a parallel/later duplicate ordinary turn')
  assert.ok(events.some(e=>e.type==='tool/call'),'real loop must dispatch an actual tool, not only change status')
  assert.equal(adapter.requests.length,2)
  assert.ok(JSON.stringify(adapter.requests[1]).includes('不要改已确认的口播原文'))
  assert.ok(events.some(e=>e.type==='agent/inbox/spliced'&&e.data.inserted.some(m=>m.source?.kind==='plugin'&&m.source.plugin==='dsh-playbook')))
  console.log('PASS: REAL Commands.execute → persisted rejection → REAL idle steer/inbox/turn/start → scripted LLM → REAL playbook tool execution → original produce stage.')
  console.log('PASS: second feedback DURING a real AgentLoop request is steered into its next step; one revision, one turn, all feedback retained.')
  console.log('No user continuation message, clear/cancel/new Run, real model/API call, E5 access or completed-media claim.')
}finally{
  releaseFirst()
  if(agent.status==='running'){agent.cancel({kind:'disposed'});await agent.whenIdle()}
  await engine.queue;await rm(workspace,{recursive:true,force:true})
}

/** Actual upstream AgentLoop/inbox/tools; only model and human answer provider
 * are scripted. No E5, credentials, live model or media generation. */
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
import { install } from '../src/host.js'

class Scripted extends LlmAdapter {
  constructor(steps){super();this.steps=steps;this.requests=[]}
  async resolveModel(provider,model){return {provider,id:model,name:model}}
  async *stream(options){
    this.requests.push(options)
    if(this.requests.length>this.steps.length)throw new Error('Unexpected additional model request: intake loop did not stop')
    const step=this.steps[this.requests.length-1]
    if(step.name){
      const id=ToolCallId('scripted-'+this.requests.length),args=JSON.stringify(step.args)
      yield {type:'block-start',index:0,blockType:'tool-call'}
      yield {type:'tool-call-delta',index:0,id,name:step.name,argumentsDelta:args}
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:step.name,arguments:args}}
      yield {type:'finish',reason:{kind:'tool-calls'}}
    }else{
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:'Fixture acknowledgment, not a produced video.'}
      yield {type:'block-end',index:0,block:{type:'text',text:'Fixture acknowledgment, not a produced video.'}}
      yield {type:'finish',reason:{kind:'stop'}}
    }
  }
}
function bounded(p,label){let timer;return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),20000)})]).finally(()=>clearTimeout(timer))}
async function scenario(clarify){
  const intake={name:'playbook',args:{action:'intake',project_id:'test-project',requirements:['Keep owner voice and current Host permissions.']}}
  const wrong={name:'playbook',args:{action:'route',playbook_id:'short-video-production',note:'Synthetic video selection to test the intake control contract.'}}
  const question={name:'ask_user_question',args:{questions:[{id:'deliverable',question:'本次交付物是完整成片还是口播音频？'}]}}
  const steps=clarify?[intake,question,wrong,{}]:[intake,wrong,wrong,wrong]
  const adapter=new Scripted(steps),ctx=new Context()
  for(const plugin of [LlmRuntime,SessionStore,Projections,SystemPrompt,Tools,AgentRegistry])await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop,{agents:[]})
  ctx.llm.registerAdapter(['scripted-intake'],adapter)
  const workspace=await mkdtemp(join(tmpdir(),'native-intake-'))
  const engine=install(ctx,{define:defineTool,message:createUserMessage,paths:{directory:join(workspace,'sops'),state:join(workspace,'state.json')}})
  ctx.tools.register(defineTool({name:'ask_user_question',description:'Scripted human answer provider for native tool-result integration only.',
    parameters:{questions:{type:'array',required:true,items:{type:'object',additionalProperties:true}}},
    output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},
    execute:async()=>({answers:[{id:'deliverable',selected:[],custom:'做成完整的成片，跟以前一样。'}]})}))
  const agent=await ctx.agentLoop.create(SessionId(clarify?'intake-answer':'intake-stop'),{provider:'scripted-intake',model:'no-real-model'},{cwd:workspace})
  try{
    // Wait for plugin hydration before defining the test-only non-media workflow.
    await ctx.tools.execute({name:'playbook',callId:ToolCallId('ready'),agent,signal:new AbortController().signal,arguments:{action:'list'}})
    engine.register({id:'short-video-production',stages:[{id:'brief',objective:'Fixture method admission only; no video generation',gate:{evidence:['goal']}}]})
    agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'只制作口播音频'}]}))
    await bounded(agent.whenIdle(),'native intake')
    await engine.queue
    const events=agent.session.snapshotEvents()
    assert.equal(events.filter(e=>e.type==='turn/start').length,1)
    assert.equal(adapter.requests.length,4,'bounded real model-step count')
    if(clarify){
      assert.equal(engine.status(String(agent.id)).run.playbookId,'short-video-production')
      assert.equal(engine.status(String(agent.id)).input.contract.taskScope.kind,'video-production')
      assert.equal(engine.status(String(agent.id)).input.contract.clarifications[0].source,'host-ask-user-result')
      console.log('PASS actual AgentLoop/tool-result: native answer -> same-project video route, first stage entered, no extra permission/retyping.')
    }else{
      assert.equal(engine.runs.size,0)
      assert.ok(JSON.stringify(events.filter(e=>e.type==='tool/result')).includes('report_intake_stall'))
      assert.ok(JSON.stringify(events.filter(e=>e.type==='tool/result')).includes('nativeTurnStop'))
      assert.equal(agent.status,'idle')
      console.log('PASS actual AgentLoop: third repeated pre-start mismatch concludes the current tool turn; no Run, cancellation, budget reset or 60-step loop.')
    }
  }finally{
    if(agent.status==='running'){agent.cancel({kind:'disposed'});await agent.whenIdle()}
    await engine.queue;await rm(workspace,{recursive:true,force:true})
  }
}
await scenario(true)
await scenario(false)

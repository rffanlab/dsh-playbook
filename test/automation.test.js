import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { PlaybookRouter } from '../src/routing.js'
import { installAutoRouting } from '../src/automation.js'
function setup(options={}) {
  const e=new PlaybookEngine(), r=new PlaybookRouter(e), handlers={}, guards=[]
  for(const p of BUILTIN_PLAYBOOKS)e.register(p)
  const ctx={on:(name,fn)=>{handlers[name]=fn},tools:{guard:fn=>guards.push(fn)}}
  let sequence=0
  installAutoRouting(ctx,e,r,{createMessage:props=>({id:`plugin-${++sequence}`,...props}),onError:()=>{},...options})
  return {e,r,hook:handlers['agent/pre-step'],guards}
}
const user=(id,text)=>({id,source:{kind:'user'},content:[{type:'text',text}]})
const agent=id=>({id,session:{header:{}}})
async function step(f,a,m,extra={}) {
  const payload={agent:a,messages:m,signal:new AbortController().signal,...extra}
  return f.hook(payload,async()=>({kind:'enter',messages:m,startsRequestSeries:true}))
}
test('direct work request auto-attaches before work and contributes current stage in the same step', async()=>{
  const f=setup(),a=agent('s'),m=[user('u1','修复这个接口bug')]
  const out=await step(f,a,m)
  assert.equal(f.e.status('s').run.playbookId,'bug-fix');assert.equal(out.messages[0],m[0]);assert.equal(out.startsRequestSeries,true)
  assert.equal(out.messages[1].source.kind,'plugin');assert.match(out.messages[1].content[0].text,/reproduce/)
  assert.equal(f.e.status('s').input.routing.method,'auto-rule')
  await step(f,a,m);assert.equal(f.e.activeRun('s').history.length,1)
})
test('keeps current SOP when the user sends clarification or a different task',async()=>{
  const f=setup(),a=agent('s');await step(f,a,[user('u1','修复这个接口bug')])
  await step(f,a,[user('u2','同时帮我写公众号文章')])
  assert.equal(f.e.status('s').run.playbookId,'bug-fix')
})
test('preserves downstream rejection and removed user batches',async()=>{
  const f=setup(),a=agent('s'),messages=[user('u1','修复接口bug')]
  const rejection={kind:'reject'}
  assert.equal(await f.hook({agent:a,messages},async()=>rejection),rejection)
  await f.hook({agent:a,messages},async()=>({kind:'enter',messages:[]}));assert.equal(f.e.runs.size,0)
})
test('tool/plugin messages and child-agent prompts cannot auto-route',async()=>{
  const f=setup(),a=agent('s')
  await step(f,a,[{...user('u1','修复接口bug'),source:{kind:'plugin',plugin:'test'}}])
  a.session.header.parentSession='parent';await step(f,a,[user('u2','修复接口bug')]);assert.equal(f.e.runs.size,0)
})
test('ambiguous work becomes a selection request, not an invented run',async()=>{
  const f=setup(),a=agent('s');const out=await step(f,a,[user('u1','修复bug并写篇公众号')])
  assert.equal(f.e.runs.size,0);assert.equal(f.r.view('s').pending,true);assert.match(out.messages[1].content[0].text,/不要让用户/)
})
test('automatic mode can be disabled without cancelling an active run',async()=>{
  const f=setup(),a=agent('s');f.r.setAuto('s',false);await step(f,a,[user('u1','修复接口bug')]);assert.equal(f.e.runs.size,0)
  f.r.setAuto('s',true);await step(f,a,[user('u2','修复接口bug')]);f.r.setAuto('s',false);assert.equal(f.e.status('s').active,true)
})
test('waits for state hydration and does not replace a restored active run',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve}),f=setup({ready:()=>waiting}),a=agent('s')
  const pending=step(f,a,[user('u1','写一篇公众号文章')]);await Promise.resolve();await f.e.start('s','bug-fix');release();await pending
  assert.equal(f.e.status('s').run.playbookId,'bug-fix')
})
test('routing failures do not throw from startup or falsely claim an active SOP',async()=>{
  const f=setup({ready:async()=>{throw new Error('state unavailable')}}),a=agent('s');const out=await step(f,a,[user('u1','修复接口bug')])
  assert.equal(f.e.runs.size,0);assert.match(out.messages[1].content[0].text,/未启动/)
})
test('cancellation is observed before automatic start',async()=>{
  const f=setup();await assert.rejects(step(f,agent('s'),[user('u1','修复接口bug')],{signal:AbortSignal.abort()}));assert.equal(f.e.runs.size,0)
})
test('long requests are handed to Agent selection instead of auto-starting from a truncated intent',async()=>{
  const f=setup(),a=agent('s');await step(f,a,[user('u1','修复接口bug。'+ '背景信息。'.repeat(1000))])
  assert.equal(f.e.runs.size,0);assert.equal(f.r.view('s').pending,true)
})

test('unknown maintenance task bypasses Playbook and leaves normal tools available',async()=>{
  const f=setup(),a=agent('s'),out=await step(f,a,[user('u1','把model-mgr 这个插件删了吧。')])
  assert.equal(f.e.runs.size,0);assert.equal(f.r.view('s').pending,false);assert.equal(f.r.view('s').lastDecision.kind,'passthrough')
  assert.equal(f.guards.map(g=>g({agent:a,name:'bash'})).find(Boolean),undefined)
  assert.match(out.messages.at(-1).content[0].text,/Playbook 不接管/)
})

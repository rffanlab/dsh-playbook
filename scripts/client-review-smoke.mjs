/** Render the actual bundled panel in React + jsdom and dispatch its real commands
 * into the Host plugin. No live DSH server, browser engine or model is claimed. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { install } from '../src/host.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {runScripts:'outside-only',pretendToBeVisual:true})
globalThis.window=dom.window;globalThis.document=dom.window.document
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const { createRoot }=await import('react-dom/client')
const workspace=await mkdtemp(join(tmpdir(),'panel-review-'))
let client,Panel,selected='a',sequence=0
const woken=[],recorded=[],hostCommands=new Map(),tools=new Map()
const signal=new AbortController().signal
const agents=new Map(['a','b'].map(id=>[id,{id,session:{header:{cwd:workspace}},steer:m=>woken.push({id,message:m})}]))
const host={on:()=>{},effect:()=>{},provide:()=>{},inject:(_d,fn)=>fn(host),systemPrompt:{section:()=>{}},
  tools:{register:d=>tools.set(d.name,d),guard:()=>{}},commands:{register:d=>hostCommands.set(d.name,d)}}
const engine=install(host,{define:d=>d,message:p=>({id:`notice-${++sequence}`,...p}),paths:{directory:join(workspace,'catalog'),state:join(workspace,'state.json')}})
await tools.get('playbook').execute({action:'list'},{agent:agents.get('a'),signal})
const fixture={id:'panel-fixture',delivery:{review:true,revisionStage:'diagnose',maxRevisions:3,repairStages:['produce','qa'],maxSelfRepairs:4},stages:[
  {id:'produce',objective:'Produce an actual artifact in the real workflow',gate:{evidence:['artifact']}},
  {id:'qa',objective:'Inspect a real artifact in the real workflow',gate:{evidence:['checked']},next:null},
  {id:'diagnose',objective:'Diagnose current feedback',next:'produce'},
]}
engine.register(fixture)
async function candidate(id) {
  await engine.start(id,fixture.id,{task:'Synthetic UI test, not a real video.'})
  await engine.submit(id,{stageId:'produce',evidence:{artifact:'synthetic fixture'}})
  await engine.submit(id,{stageId:'qa',evidence:{checked:'synthetic check'}})
}
async function revisedCandidate(id) {
  await engine.requestRevision(id,'Synthetic fixture replacing the candidate before a stale click.')
  await engine.repair(id,'produce','Synthetic fixture: follow the original revision path.')
  await engine.submit(id,{stageId:'produce',evidence:{artifact:'second candidate'}})
  await engine.submit(id,{stageId:'qa',evidence:{checked:'second check'}})
}
await candidate('a');await candidate('b')
const clientCtx={uiSession:{adapter:{current:{getSnapshot:()=>({props:{sessionId:selected}})}}},
  remote:{commands:{execute:async(id,raw)=>{
    recorded.push({id,raw})
    const result=await hostCommands.get('playbook').handler({agent:agents.get(id),session:{id},signal,commandId:`ui-command-${++sequence}`,rawInput:raw.replace(/^\/playbook\s*/,'')})
    return {ok:true,value:{result}}
  }}},slots:{inject:(_name,fn)=>fn(),register:(_slot,component)=>{Panel=component}}}
dom.window.__ModuleLoader__={load:({factory})=>{client=factory(id=>{assert.equal(id,'react');return React})}}
dom.window.eval(await readFile(new URL('../lib/client.js',import.meta.url),'utf8'))
client.apply(clientCtx)
assert.equal(typeof Panel,'function')
const root=createRoot(document.getElementById('root'))
const buttons=()=>[...document.querySelectorAll('button')]
const button=label=>{const b=buttons().find(x=>x.textContent===label);assert.ok(b,`Missing actual button: ${label}`);return b}
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})}
async function click(label) {await act(async()=>{button(label).click()});await flush()}
try {
  await act(async()=>{root.render(React.createElement(Panel,{clientCtx}))});await flush()
  assert.ok(button('拒绝候选'));assert.ok(button('验收通过'))
  assert.match(document.body.textContent,/不必点击按钮/)
  // Real textarea event and real bundled button callback, not a hand-built handler.
  const textarea=document.querySelector('textarea[aria-label="返修意见"]'),feedback='只替换第三个镜头；保留其余文稿、语速与素材。'
  await act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,feedback)
    textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}))
  })
  const originalId=engine.status('a').run.id
  await click('拒绝候选')
  assert.equal(engine.status('a').run.id,originalId);assert.equal(engine.status('a').run.revision,1)
  assert.equal(engine.status('a').run.stageId,'diagnose')
  assert.equal(engine.status('a').revisionFeedback.reason,feedback)
  assert.equal(engine.status('b').run.state,'awaiting_review')
  assert.equal(woken.length,1);assert.equal(woken[0].id,'a');assert.equal(woken[0].message.source.kind,'plugin')
  assert.ok(woken[0].message.content[0].text.includes(feedback))
  assert.equal(engine.status('a').revisionDispatch.state,'queued')
  assert.equal(buttons().some(x=>x.textContent==='拒绝候选'),false)
  console.log('PASS: actual panel button and feedback → Host command → original run revision → actual steer invocation; no separate continuation')

  // Refresh onto B, replace its candidate on the server without refreshing UI.
  selected='b';await click('刷新')
  const displayedTarget=engine.status('b').reviewControl.target
  await revisedCandidate('b')
  assert.notEqual(engine.status('b').reviewControl.target,displayedTarget)
  const before=engine.snapshot()
  await click('拒绝候选')
  assert.deepEqual(engine.snapshot(),before)
  assert.match(document.body.textContent,/REVIEW_TARGET_CHANGED/)
  console.log('PASS: stale candidate action fails on Host without changing new candidate')

  await click('刷新')
  // Switch sessions immediately before click. The currently rendered B card may
  // still exist, but it cannot send a review command to the new A session.
  selected='a'
  const count=recorded.filter(row=>/\/playbook review /.test(row.raw)).length
  await click('拒绝候选')
  assert.equal(recorded.filter(row=>/\/playbook review /.test(row.raw)).length,count)
  assert.deepEqual(engine.snapshot(),before)
  console.log('PASS: session switch never reviews the wrong run')

  selected='b';await click('刷新');await click('验收通过')
  assert.equal(engine.status('b').run.state,'accepted')
  assert.equal(engine.status('a').run.state,'active')
  assert.equal(recorded.some(row=>/\/playbook (?:cancel|start)\b/.test(row.raw)),false)
  console.log('PASS: exact-current-candidate acceptance; review never cancelled/recreated a task')

  // A remains in the original revision. Produce and reject more candidates via
  // the actual button, exceeding its old maxRevisions=3 and lifetime repair cap.
  selected='a'
  for(let expected=2;expected<=5;expected++) {
    await engine.repair('a','produce','Synthetic user-directed correction without replacing the run.')
    await engine.submit('a',{stageId:'produce',evidence:{artifact:'UI candidate '+expected}})
    await engine.submit('a',{stageId:'qa',evidence:{checked:'UI checked '+expected}})
    await click('刷新');await click('拒绝候选')
    assert.equal(engine.status('a').run.id,originalId)
    assert.equal(engine.status('a').run.revision,expected)
    assert.equal(engine.status('a').run.state,'active')
  }
  assert.equal(recorded.some(row=>/\/playbook (?:cancel|start)\b/.test(row.raw)),false)
  console.log('PASS: actual panel continues past legacy human cap and lifetime repair totals, preserving original Run')
} finally {
  await act(async()=>root.unmount());dom.window.close()
  await engine.queue;await rm(workspace,{recursive:true,force:true})
}
console.log('Actual React + DOM/Host review interaction smoke passed. Not an E5 or live-model end-to-end test.')

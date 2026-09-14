/** Real installed DSH SDK contract smoke; no model/API keys or live user profile. */
import assert from 'node:assert/strict'
import { createPlaybookTool } from '../src/index.js'
import { PlaybookEngine } from '../src/engine.js'
import { PlaybookRouter } from '../src/routing.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { ProjectLibrary } from '../src/project-library.js'
import { playbookDefinition } from '../src/tool.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
const engine = new PlaybookEngine()
for (const p of BUILTIN_PLAYBOOKS) engine.register(p)
const router = new PlaybookRouter(engine)
const tool = createPlaybookTool(engine, async () => engine.listPlaybooks(), router)
assert.equal(tool.name, 'playbook')
for (const action of ['intake', 'sop_list', 'sop_save', 'sop_validate', 'route', 'check', 'block', 'repair', 'report', 'export_report']) assert.ok(tool.parameters.properties.action.enum.includes(action))
const exec = { agent: { id: 'sdk-smoke' }, signal: new AbortController().signal }
for (const args of [{ action: 'list' }, { action: 'inspect', playbook_id: 'dsh-plugin-development' }, { action: 'route', task: '修复这个接口的bug' }, { action: 'status' }, { action: 'check', stage_id: 'reproduce', evidence: {} }, { action: 'block', note: 'Synthetic SDK smoke: a required input is unavailable.' }, { action: 'report' }]) {
  const value = await tool.execute(args, exec)
  assert.deepEqual(value, JSON.parse(JSON.stringify(value)))
  assert.ok(tool.output.render(args, value)[0].text)
}
const msg = createUserMessage({ content: [{ type: 'text', text: 'SOP context' }], source: { kind: 'plugin', plugin: 'dsh-playbook' } })
assert.ok(msg.id)
assert.equal(msg.source.kind, 'plugin')
console.log('Real DSH SDK import, tool-definition, canonical-result and message contracts passed. Not a live Web Profile smoke test.')

// Check new authoring schemas against the actual SDK, while using an isolated in-memory library.
const e2 = new PlaybookEngine(); for (const p of BUILTIN_PLAYBOOKS) e2.register(p)
const r2 = new PlaybookRouter(e2), library = new ProjectLibrary(e2,r2); r2.projects = library
const t2 = defineTool(playbookDefinition(e2,async()=>[],r2,async()=>{},undefined,undefined,library))
const x2 = {agent:{id:'project-sdk',session:{header:{cwd:'/workspace/sdk-fixture'}}},signal:new AbortController().signal}
r2.remember('project-sdk','制作道家文化视频，发到B站')
for (const args of [
  {action:'intake',project_id:'culture',requirements:['保留原文和自然口播。'],source_call_ids:[]},
  {action:'sop_validate',sop_id:'culture-production',base_id:'taoist-culture-video',rules:['逐条核对出处。']},
  {action:'sop_save',sop_id:'culture-production',base_id:'taoist-culture-video',rules:['逐条核对出处。']},
  {action:'sop_list'}, {action:'route',sop_id:'culture-production'},
]) { const v=await t2.execute(args,x2); assert.deepEqual(v,JSON.parse(JSON.stringify(v))); assert.ok(t2.output.render(args,v)[0].text) }
assert.equal(e2.status('project-sdk').input.sop.status,'trial')
console.log('Project intake/save/route with real DSH defineTool passed; not a live Agent or browser test.')

// The actual installed SDK must accept the new workspace controller and canonical output.
const { IsolatedPlaybookEngine } = await import('../src/run-isolation.js')
const { createIsolationManager } = await import('../src/host-isolation.js')
const isolated = new IsolatedPlaybookEngine(); for (const p of BUILTIN_PLAYBOOKS) isolated.register(p)
const ir = new PlaybookRouter(isolated), im = createIsolationManager({tools:{}}, isolated)
const it = defineTool(im.wrap(playbookDefinition(isolated,async()=>[],ir)))
assert.ok(it.parameters.properties.action.enum.includes('workspace'))
const ix = {agent:{id:'isolated-sdk',session:{header:{cwd:'/workspace/sdk-isolated'}}},signal:new AbortController().signal}
// No token: this is a schema/unit fixture, not an actual directory preparation.
const iv = await it.execute({action:'start',playbook_id:'bilibili-video-production'},ix)
assert.deepEqual(iv,JSON.parse(JSON.stringify(iv)))
assert.equal(iv.status.isolation.prepared,false)
assert.ok(iv.status.isolation.root.includes('.dsh-runs'))
console.log('Run-isolation control schema and pending allocation canonical output passed; no live workspace/model claimed.')

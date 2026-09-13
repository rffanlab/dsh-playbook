/** Real installed DSH SDK contract smoke; no model/API keys or live user profile. */
import assert from 'node:assert/strict'
import { createPlaybookTool } from '../src/index.js'
import { PlaybookEngine } from '../src/engine.js'
import { PlaybookRouter } from '../src/routing.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
const engine = new PlaybookEngine()
for (const p of BUILTIN_PLAYBOOKS) engine.register(p)
const router = new PlaybookRouter(engine)
const tool = createPlaybookTool(engine, async () => engine.listPlaybooks(), router)
assert.equal(tool.name, 'playbook')
for (const action of ['route', 'check', 'block', 'repair', 'report', 'export_report']) assert.ok(tool.parameters.properties.action.enum.includes(action))
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

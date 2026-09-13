import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../src/host.js'

async function host(t) {
  const directory = await mkdtemp(join(tmpdir(), 'playbook-host-test-'))
  const listeners = new Map(), guards = [], commands = new Map(), sections = []
  let tool
  const ctx = {
    tools: { register: d => { tool = d }, guard: f => { guards.push(f) } },
    systemPrompt: { section: p => { sections.push(p) } },
    commands: { register: c => { commands.set(c.name, c) } },
    on: (name, fn) => { listeners.set(name, fn) },
    effect: () => {}, inject: (_deps, callback) => callback(ctx), provide: () => {},
  }
  const engine = install(ctx, { define: d => d, message: p => ({ id: 'notice', ...p }), paths: { directory: join(directory, 'catalog'), state: join(directory, 'state.json') } })
  const agent = { id: 'session', session: { header: {} } }, signal = new AbortController().signal
  const call = args => tool.execute(args, { agent, signal })
  const command = rawInput => commands.get('playbook').handler({ agent, signal, rawInput })
  await call({ action: 'list' })
  t.after(async () => { await engine.queue; await rm(directory, { recursive: true, force: true }) })
  return { engine, listeners, guards, sections, agent, signal, call, command }
}
const receiptStage = { id: 'verify', objective: 'Verify a real check',
  gate: { evidence: [{ key: 'cmd', type: 'string' }, { key: 'id', type: 'string' }], toolResults: [{ name: 'bash', callIdKey: 'id', commandKey: 'cmd' }] },
  retry: { maxAttempts: 2 }, next: null }

test('Host final-result observer supplies receipt without model-authored facts', async t => {
  const h = await host(t)
  h.engine.register({ id: 'fixture', stages: [receiptStage] })
  await h.call({ action: 'start', playbook_id: 'fixture' })
  const exec = { name: 'bash', callId: 'real-callback', token: Symbol(), agent: h.agent, arguments: { command: 'npm test' }, signal: h.signal }
  await h.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
  h.listeners.get('tools/result')(exec, Object.freeze({ isError: false, value: Object.freeze({ kind: 'foreground', exitCode: 1, signal: null, timedOut: false, aborted: false }) }))
  const out = await h.call({ action: 'check', stage_id: 'verify', evidence: { cmd: 'npm test', id: 'real-callback' } })
  assert.equal(out.gate.passed, false)
  assert.equal(h.engine.status('session').observations.bash.receipts[0].exitCode, 1)
})
test('human commands resume/cancel blocked runs; model tools cannot bypass them', async t => {
  const h = await host(t)
  await h.call({ action: 'start', playbook_id: 'bug-fix' })
  await h.call({ action: 'block', note: 'Missing the source repository. Need an accessible checkout.' })
  assert.match(h.sections[0].text({ agent: h.agent }), /BLOCKED/)
  assert.ok(h.guards.some(guard => guard({ agent: h.agent, name: 'write' })))
  assert.equal((await h.command('resume')).kind, 'success')
  assert.equal(h.engine.status('session').run.state, 'active')
  assert.equal((await h.command('report')).kind, 'success')
  await h.call({ action: 'block', note: 'Still cannot access the requested repository.' })
  assert.equal((await h.command('cancel')).kind, 'success')
  assert.equal(h.engine.status('session').run.state, 'cancelled')
})
test('automatic routing is preserved and delivers the new current-stage contract', async t => {
  const h = await host(t)
  const message = { id: 'new-user-message', source: { kind: 'user' }, content: [{ type: 'text', text: '修复这个接口bug' }] }
  const out = await h.listeners.get('agent/pre-step')({ agent: h.agent, signal: h.signal, messages: [message] }, async () => ({ kind: 'enter', messages: [message] }))
  assert.equal(h.engine.status('session').run.playbookId, 'bug-fix')
  assert.equal(h.engine.status('session').run.playbookVersion, '0.3.0')
  assert.match(out.messages[1].content[0].text, /actual stage work/)
})
test('a blocked active task is not replaced on the next direct user request', async t => {
  const h = await host(t)
  await h.call({ action: 'start', playbook_id: 'bug-fix' }); await h.call({ action: 'block', note: 'Need a working test runner for this environment.' })
  const message = { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '给我写篇公众号文章' }] }
  await h.listeners.get('agent/pre-step')({ agent: h.agent, signal: h.signal, messages: [message] }, async () => ({ kind: 'enter', messages: [message] }))
  assert.equal(h.engine.status('session').run.playbookId, 'bug-fix'); assert.equal(h.engine.status('session').run.state, 'blocked')
})
test('late callbacks cannot credit a different epoch through the Host observer', async t => {
  const h = await host(t); await h.call({ action: 'start', playbook_id: 'bug-fix' })
  const exec = { name: 'bash', callId: 'old', token: Symbol(), agent: h.agent, arguments: { command: 'old check' }, signal: h.signal }
  await h.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
  await h.call({ action: 'submit', stage_id: 'reproduce', evidence: { reproduction: 'Real fixture reproduction steps', observed_behavior: 'Real fixture observed behavior' } })
  h.listeners.get('tools/result')(exec, { isError: false, value: { kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false } })
  await h.engine.queue; assert.deepEqual(h.engine.status('session').observations, {})
})

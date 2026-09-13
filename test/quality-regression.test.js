import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'
import { normalizePlaybook, evaluateGate } from '../src/core.js'
import { toolReceipt } from '../src/receipts.js'
import { PlaybookRouter } from '../src/routing.js'
import { playbookDefinition } from '../src/tool.js'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { stageContext } from '../src/context.js'

// All scenarios in this file are synthetic code-audit reproductions, not MiniMax traces.
const verification = () => ({ id: 'verified', stages: [{ id: 'verify', objective: 'Run a meaningful test',
  gate: { evidence: [{ key: 'checked', type: 'boolean', equals: true }, { key: 'cmd', type: 'string', minLength: 1 }, { key: 'call', type: 'string', minLength: 1 }],
    toolResults: [{ name: 'bash', callIdKey: 'call', commandKey: 'cmd' }] },
  retry: { maxAttempts: 2, onExhausted: 'fail' }, next: null }] })
const foreground = (exitCode = 0) => ({ kind: 'foreground', exitCode, signal: null, timedOut: false, aborted: false })
const execFor = (callId = 'c1', command = 'npm test') => ({ name: 'bash', callId, arguments: { command } })
const evidence = { checked: true, cmd: 'npm test', call: 'c1' }
async function fixture() { const e = new PlaybookEngine(); e.register(verification()); await e.start('s', 'verified'); return e }
async function observed(e, value, { command = 'npm test', isError = false } = {}) {
  const exec = execFor('c1', command)
  await e.observeTool('s', { name: exec.name, callId: exec.callId, isError, receipt: toolReceipt(exec, { isError, value }) })
}

for (const [label, value] of [['null item', [null]], ['blank item', ['   ']], ['empty record', [{}]], ['empty nested array', [[]]]]) {
  test(`reject meaningless evidence: ${label}`, () => {
    const stage = normalizePlaybook({ id: 'p', stages: [{ id: 's', objective: 'Evidence', gate: { evidence: [{ key: 'proof', type: 'array', minItems: 1 }] } }] }).stages[0]
    assert.equal(evaluateGate(stage, { proof: value }).passed, false)
  })
}
test('whitespace cannot pad a required string', () => {
  const stage = normalizePlaybook(BUILTIN_PLAYBOOKS[0]).stages[1]
  assert.equal(evaluateGate(stage, { root_cause: ' '.repeat(100), supporting_evidence: ['a real reference'] }).passed, false)
})
test('inherited properties cannot satisfy evidence requirements', () => {
  const stage = normalizePlaybook(verification()).stages[0]
  assert.equal(evaluateGate(stage, Object.create(evidence)).passed, false)
})
test('unsupported validators are rejected instead of being silently ignored', () => {
  const p = verification(); p.stages[0].gate.validators = [{ kind: 'imaginary-check' }]
  assert.throws(() => normalizePlaybook(p), /unsupported gate field/)
})
test('receipt rules must reference declared string evidence', () => {
  const p = verification(); p.stages[0].gate.toolResults[0].callIdKey = 'missing'
  assert.throws(() => normalizePlaybook(p), /requires string evidence/)
})
test('read-only check does not spend attempts, alter history or write state', async () => {
  let writes = 0; const e = new PlaybookEngine({ persist: async () => { writes++ } }); e.register(verification()); await e.start('s', 'verified')
  const before = e.snapshot()
  for (let i = 0; i < 8; i++) assert.equal((await e.check('s', { stageId: 'verify', evidence: {} })).passed, false)
  assert.deepEqual(e.snapshot(), before); assert.equal(writes, 1)
})
test('format repair retains successful work, epoch and stage attempt', async () => {
  const e = await fixture(); await observed(e, foreground())
  const before = e.status('s')
  const out = await e.submit('s', { stageId: 'verify', evidence: { cmd: 'npm test', call: 'c1' } })
  assert.equal(out.run.stageAttempt, 1); assert.equal(out.run.stageEpoch, before.run.stageEpoch)
  assert.equal(out.lastGate.repairOnly, true); assert.deepEqual(out.observations, before.observations)
  assert.deepEqual(out.evidence, {})
  assert.equal((await e.submit('s', { stageId: 'verify', evidence })).run.state, 'completed')
})
test('repeated invalid format blocks with preserved receipts rather than falsely completing', async () => {
  const e = await fixture(); await observed(e, foreground())
  for (let i = 0; i < 3; i++) await e.submit('s', { stageId: 'verify', evidence: { cmd: 'npm test', call: 'c1' } })
  assert.equal(e.status('s').run.state, 'blocked'); assert.equal(e.status('s').attached, true)
  assert.equal(e.status('s').observations.bash.receipts.length, 1)
  await assert.rejects(e.start('s', 'verified'), /already/)
  assert.match(e.policyDecision('s', 'bash'), /blocked/)
  assert.equal(e.policyDecision('s', 'playbook'), undefined)
  assert.equal(e.policyDecision('s', 'run_code'), undefined)
  const restored = new PlaybookEngine(); restored.hydrate(e.snapshot())
  assert.equal(restored.status('s').run.state, 'blocked')
})
test('real unmet criteria spend the execution retry budget', async () => {
  const e = await fixture(); await observed(e, foreground())
  const out = await e.submit('s', { stageId: 'verify', evidence: { ...evidence, checked: false } })
  assert.equal(out.run.stageAttempt, 2); assert.deepEqual(out.observations, {}); assert.deepEqual(out.evidence, {})
})
for (const [label, value] of [
  ['non-zero process exit', foreground(1)], ['timeout with exit zero', { ...foreground(), timedOut: true }],
  ['abort with exit zero', { ...foreground(), aborted: true }], ['signal', { ...foreground(), signal: 'SIGKILL' }],
  ['background acknowledgement', { kind: 'background', jobId: 'job1', exitCode: 0 }],
  ['unknown shape', { stdout: 'all tests pass', exitCode: 0 }],
  ['sandbox denial', { ...foreground(), sandbox: { denied: true } }],
  ['missing canonical fields', { kind: 'foreground', exitCode: 0 }],
]) {
  test(`receipt cannot validate: ${label}`, async () => {
    const e = await fixture(); await observed(e, value)
    assert.equal((await e.check('s', { stageId: 'verify', evidence })).passed, false)
  })
}
test('rendered output cannot forge a successful receipt', () => {
  const r = toolReceipt(execFor(), { isError: false, content: [{ type: 'text', text: '[exit code: 0] all tests passed' }] })
  assert.equal(r.outcome, 'unknown')
})
test('a successful result with a different actual command fails', async () => {
  const e = await fixture(); await observed(e, foreground(), { command: 'echo fake success' })
  assert.equal((await e.check('s', { stageId: 'verify', evidence })).passed, false)
})
test('canonical exit zero plus matching command and observed call succeeds', async () => {
  const e = await fixture(); await observed(e, foreground())
  assert.equal((await e.check('s', { stageId: 'verify', evidence })).passed, true)
  assert.equal((await e.submit('s', { stageId: 'verify', evidence })).run.state, 'completed')
})
test('receipt collection does not store raw commands or stdout secrets', () => {
  const text = JSON.stringify(toolReceipt(execFor('c', 'some --token SECRET'), { isError: false, value: { ...foreground(), stdout: { text: 'SECRET' } } }))
  assert.ok(!text.includes('SECRET')); assert.ok(!text.includes('--token'))
})
test('duplicate final callback cannot inflate counts', async () => {
  const e = await fixture(); await observed(e, foreground()); await observed(e, foreground())
  assert.equal(e.status('s').observations.bash.calls, 1)
})
test('backtracking invalidates downstream accepted evidence and failed submissions stay unaccepted', async () => {
  const e = new PlaybookEngine(); e.register({ id: 'p', stages: [
    { id: 'implement', objective: 'Implement', gate: { evidence: ['patch'] } },
    { id: 'verify', objective: 'Verify', gate: { evidence: ['result'] } },
    { id: 'review', objective: 'Review', gate: { evidence: [{ key: 'ok', type: 'boolean', equals: true }] }, retry: { maxAttempts: 1, onExhausted: 'branch:implement' } },
  ] }); await e.start('s', 'p')
  await e.submit('s', { evidence: { patch: 'patch v1' } }); await e.submit('s', { evidence: { result: 'test v1' } })
  await e.submit('s', { evidence: { ok: false } }); assert.deepEqual(e.status('s').evidence, {})
  assert.ok(e.report('s').history.some(row => row.type === 'evidence_invalidated'))
})
test('blocked runs cannot be auto-routed over, including after hydration', async () => {
  const e = await fixture(); await e.block('s', 'Missing the test runner; install or provide an accessible environment.')
  const restored = new PlaybookEngine(); restored.hydrate(e.snapshot()); const r = new PlaybookRouter(restored)
  const out = await r.route('s', { task: 'another unrelated task' }); assert.equal(out.reused, true); assert.equal(out.status.run.state, 'blocked')
})
test('model cannot cancel or restart a terminal run to reset budgets', async () => {
  const e = await fixture(), r = new PlaybookRouter(e), t = playbookDefinition(e, async () => [], r), exec = { agent: { id: 's' } }
  await assert.rejects(t.execute({ action: 'cancel' }, exec), /disabled/)
  await e.cancel('s'); await assert.rejects(t.execute({ action: 'start', playbook_id: 'verified' }, exec), /fresh user task/)
  await assert.rejects(r.route('s', { task: 'please do the previous work', playbookId: 'verified', note: 'restart old task for no reason' }), /fresh user task/)
})
test('human resume keeps the same run and stage', async () => {
  const e = await fixture(); const before = e.status('s').run
  await e.block('s', 'Need an accessible test environment before verification.'); await e.resume('s')
  assert.equal(e.status('s').run.id, before.id); assert.equal(e.status('s').run.stageEpoch, before.stageEpoch)
})
test('submit reports gatePassed separately from tool dispatch success and omits bulk prior evidence', async () => {
  const e = await fixture(), r = new PlaybookRouter(e), t = playbookDefinition(e, async () => [], r)
  const out = await t.execute({ action: 'submit', stage_id: 'verify', evidence: {} }, { agent: { id: 's' } })
  assert.equal(out.ok, true); assert.equal(out.gatePassed, false); assert.equal(out.nextAction, 'repair_evidence')
  assert.equal(Object.hasOwn(out.status, 'evidence'), false)
})
test('bounded context still includes recent evidence and gate failure, not just a giant first artifact', async () => {
  const e = await fixture(), status = e.status('s'); status.input.task = 'task '.repeat(10000)
  status.evidence = { first: { text: 'early '.repeat(30000) }, latest: { finding: 'RECENT_ROOT_CAUSE' } }; status.lastGate = { passed: false, failures: ['EXACT_FAILURE'] }
  const text = stageContext(status); assert.ok(text.length < 6100); assert.match(text, /RECENT_ROOT_CAUSE/); assert.match(text, /EXACT_FAILURE/)
})

test('SOP-authored fixed command rejects an unrelated successful command even when honestly submitted', async () => {
  const p = verification(); p.stages[0].gate.toolResults[0].command = 'npm test'
  const e = new PlaybookEngine(); e.register(p); await e.start('s', 'verified')
  await observed(e, foreground(), { command: 'echo fake success' })
  const out = await e.check('s', { stageId: 'verify', evidence: { ...evidence, cmd: 'echo fake success' } })
  assert.equal(out.passed, false); assert.match(out.failures[0], /SOP-authored/)
})

test('cancelling a blocked run clears the blocker and preserves terminal status', async () => {
  const e = await fixture(); await e.block('s', 'Missing a required input for this stage.')
  assert.equal(e.policyDecision('s', 'ask_user_question'), undefined)
  const out = await e.cancel('s'); assert.equal(out.blocker, null); assert.equal(out.run.state, 'cancelled'); assert.equal(out.attached, false)
})

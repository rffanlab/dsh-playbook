import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../src/host.js'
import { PLUGIN_VERSION } from '../src/controller-ux.js'
import { runtimeRecoveryPlan, recoveryProbeFailure } from '../src/runtime-recovery.js'

// Synthetic failed-run records; no user task, media or session is published.
async function harness(t, { rejectHost = false, alterNested, probeValue } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'playbook-control-chain-'))
  const listeners = new Map(), guards = [], definitions = new Map(), calls = [], decisions = []
  const agent = { id: 'test-session', session: { header: { cwd: workspace } } }
  const signal = new AbortController().signal
  let sequence = 0, engine
  const ctx = {
    tools: {
      register: value => definitions.set(value.name, value), guard: fn => guards.push(fn),
      execute: async input => {
        let exec = { ...input, rootCallId: input.rootCallId ?? input.callId, token: Symbol(), deferContext: () => {} }
        if (input.name === 'bash' && alterNested) exec = alterNested(exec)
        calls.push(exec)
        await listeners.get('tools/pre-execute')?.(exec, async () => ({ kind: 'allow' }))
        const reasons = guards.map(guard => guard(exec)).filter(Boolean)
        decisions.push({ tool: exec.name, reasons })
        let out
        if (reasons.length) out = { isError: true, error: { message: reasons[0], info: { name: 'GuardError', code: 'TOOL_GUARD_DENIED' } }, content: [] }
        else if (rejectHost && exec.name === 'bash') out = { isError: true,
          error: { message: 'Synthetic external Host policy denied this probe.', info: { name: 'PolicyError', code: 'EXTERNAL_POLICY_TEST' } }, content: [] }
        else if (exec.name === 'bash') {
          const run = engine.runs.get(agent.id), plan = runtimeRecoveryPlan(engine, agent.id), path = plan.manifest
          const measured = { validatorVersion: '0.4.0', kind: 'narration', status: 'pass', passed: true,
            manifestPath: path, bindings: { [path]: { path, sha256: '2'.repeat(64) } },
            narration: { scriptSha256: '3'.repeat(64) },
            ownership: { runId: run.id, root: run.isolation.realRoot, markerSha256: run.isolation.markerSha256 } }
          out = { isError: false, value: probeValue ?? { kind: 'foreground', exitCode: 0, signal: null,
            aborted: false, timedOut: false, stdout: { truncated: false, text: JSON.stringify(measured) } }, content: [] }
        } else out = { isError: false, value: await definitions.get(exec.name).execute(exec.arguments, exec), content: [] }
        listeners.get('tools/result')?.(exec, out)
        return out
      },
    },
    on: (event, fn) => listeners.set(event, fn), effect: () => {},
    systemPrompt: { section: () => {} }, commands: { register: () => {} },
    inject: (_deps, fn) => fn(ctx), provide: () => {},
  }
  engine = install(ctx, { define: d => d, message: p => ({ id: `notice-${++sequence}`, ...p }),
    paths: { directory: join(workspace, 'catalog'), state: join(workspace, 'state.json') } })
  const call = async args => {
    const out = await ctx.tools.execute({ name: 'playbook', callId: `controller-${++sequence}`, agent, signal, arguments: args })
    assert.equal(out.isError, false, out.error?.message)
    return out.value
  }
  await call({ action: 'list' }) // hydration, as a real controller call would await
  t.after(async () => { await engine.queue; await rm(workspace, { recursive: true, force: true }) })
  function seed() {
    const key = '01234567-0123-4123-8123-0123456789ab', root = join(workspace, '.dsh-runs', key)
    const book = engine.getPlaybook('short-video-production')
    engine.runs.set(agent.id, { id: 'synthetic-retained-run', sessionId: agent.id, playbookId: book.id,
      playbookVersion: '0.7.0', playbookSnapshot: structuredClone(book), state: 'failed', stageId: 'script', stageEpoch: 12,
      stageAttempt: 2, revision: 1, selfRepairs: 1, formatRepairs: 0, blocker: null,
      startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z', finishedAt: '2026-01-01T01:00:00Z',
      input: { task: 'Retain approved narration and correct the ending.' }, evidence: {}, observations: {}, machineEvidence: {}, candidates: [], revisions: [{ revision: 1, reason: 'Correct the ending.' }],
      history: [{ type: 'run_started' }, { type: 'artifact_root_allocated' }, { type: 'gate_failed' }],
      recoveryCounts: { '1:script:manifest': 3 },
      lastGate: { stageId: 'script', passed: false, failures: [`narration: Missing artifact: .dsh-runs/${key}/work/production.json`], recovery: { code: 'manifest', exhausted: true } },
      isolation: { protocol: 1, runId: 'synthetic-retained-run', sessionId: agent.id, key, workspace, root, realRoot: root,
        prepared: true, markerSha256: '1'.repeat(64), createdAtMs: 1, routesObserved: [{ provider: 'unknown', model: 'unknown' }] } })
  }
  const user = async text => {
    const message = { id: `user-${++sequence}`, source: { kind: 'user' }, content: [{ type: 'text', text }] }
    return listeners.get('agent/pre-step')({ agent, signal, messages: [message] }, async () => ({ kind: 'enter', messages: [message], startsRequestSeries: true }))
  }
  return { engine, agent, calls, decisions, call, user, seed, ctx, signal }
}

for (const text of ['继续生成 v3，保留已批准文稿与素材。', '执行', '继续完成收尾，不要问我选哪条。', '请按照原文重做 v3']) {
  test(`failed-run continuation does not create intake or block recovery: ${text}`, async t => {
    const h = await harness(t); h.seed()
    const before = structuredClone(h.engine.runs.get(h.agent.id))
    const step = await h.user(text)
    assert.equal(step.startsRequestSeries, true)
    assert.match(step.messages.at(-1).content[0].text, /不是一次新接单/)
    assert.match(step.messages.at(-1).content[0].text, /action="recover"/)
    assert.equal((await h.call({ action: 'status' })).routing.pending, false)
    const out = await h.call({ action: 'recover' }), after = h.engine.runs.get(h.agent.id)
    assert.equal(out.recovered, true); assert.equal(out.notAGate, true); assert.equal(after.state, 'active')
    for (const field of ['id', 'input', 'revision', 'revisions', 'stageId', 'stageAttempt', 'selfRepairs', 'recoveryCounts']) assert.deepEqual(after[field], before[field])
    assert.deepEqual(after.history.slice(0, -1), before.history)
    assert.equal(after.lastGate.passed, false)
    assert.ok(h.decisions.every(d => d.reasons.length === 0))
    assert.equal(out.runtimePluginVersion, PLUGIN_VERSION)
  })
}

test('exact recovery probe works even when stale pending intake already exists', async t => {
  const h = await harness(t)
  await h.user('制作一条视频') // deliberately reproduce stale intake before hydrating a failed run
  assert.equal((await h.call({ action: 'status' })).routing.pending, true)
  h.seed()
  const out = await h.call({ action: 'recover' })
  assert.equal(out.recovered, true)
  assert.deepEqual(h.decisions.filter(d => d.tool === 'bash').map(d => d.reasons), [[]])
})

test('an external Host refusal remains a refusal with its actual code, not a recover retry loop', async t => {
  const h = await harness(t, { rejectHost: true }); await h.user('生成视频'); h.seed()
  const before = h.engine.snapshot(), out = await h.call({ action: 'recover' })
  assert.equal(out.ok, false); assert.equal(out.recovered, false)
  assert.equal(out.nextAction, 'report_actual_host_failure')
  assert.equal(out.hostFailure.code, 'EXTERNAL_POLICY_TEST')
  assert.equal(out.hostFailure.message, 'Synthetic external Host policy denied this probe.')
  assert.equal(out.hostFailure.automaticRetry, false)
  assert.deepEqual(h.engine.snapshot(), before)
  assert.equal(h.calls.filter(c => c.name === 'bash').length, 1)
})

for (const [name, change] of [
  ['root identity', e => ({ ...e, rootCallId: 'foreign-root' })],
  ['parent token', e => ({ ...e, parent: Symbol() })],
  ['call id', e => ({ ...e, callId: 'forged:runtime-recovery' })],
  ['agent object', e => ({ ...e, agent: { ...e.agent } })],
  ['shell command', e => ({ ...e, arguments: { ...e.arguments, command: 'echo not-the-validator' } })],
  ['workdir', e => ({ ...e, arguments: { ...e.arguments, workdir: '/tmp' } })],
  ['extra escalation flag', e => ({ ...e, arguments: { ...e.arguments, sandbox_permissions: 'require_escalated' } })],
  ['timeout', e => ({ ...e, arguments: { ...e.arguments, timeoutMs: 999999 } })],
]) test(`control exemption cannot authorize a changed ${name}`, async t => {
  const h = await harness(t, { alterNested: change }); await h.user('生成视频'); h.seed()
  const before = h.engine.snapshot(), out = await h.call({ action: 'recover' })
  assert.equal(out.recovered, false); assert.equal(out.nextAction, 'report_actual_host_failure')
  assert.ok(h.decisions.some(d => d.tool === 'bash' && d.reasons.length))
  assert.deepEqual(h.engine.snapshot(), before)
})

test('a real content failure stays governed, does not acquire adapter-recovery authority', async t => {
  const h = await harness(t); h.seed()
  const run = h.engine.runs.get(h.agent.id); run.lastGate.failures = ['narration: NARRATION_COVERAGE: missing words']
  const step = await h.user('继续生成视频')
  assert.match(step.messages.at(-1).content[0].text, /action="repair"/)
  assert.equal((await h.call({ action: 'recover' })).recovered, false)
  const out = await h.ctx.tools.execute({ name: 'bash', callId: 'ordinary-work', agent: h.agent, signal: h.signal,
    arguments: { command: 'echo bypass', workdir: run.isolation.root } })
  assert.equal(out.isError, true)
  assert.equal(h.engine.runs.get(h.agent.id).state, 'failed')
})

test('unknown/timeout/process errors retain classification without inventing an approval cause', () => {
  for (const [value, category] of [
    [{ kind: 'foreground', exitCode: 2 }, 'process-exit'],
    [{ kind: 'foreground', exitCode: 0, timedOut: true }, 'timeout'],
    [{ kind: 'background' }, 'background'], [{ unexpected: true }, 'invalid-result'],
  ]) assert.equal(recoveryProbeFailure({ isError: false, value }, 'call').category, category)
})

for (const text of ['not JSON', 'null', '{"passed":true}']) test('invalid recovery response is not relabelled as an authorization request: '+text, async t => {
  const h = await harness(t, { probeValue: { kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{truncated:false,text} } }); h.seed()
  const before=h.engine.snapshot(), out=await h.call({action:'recover'})
  assert.equal(out.ok,false);assert.equal(out.recovered,false);assert.equal(out.nextAction,'report_actual_host_failure')
  assert.equal(out.hostFailure.category,'invalid-validator-response');assert.deepEqual(h.engine.snapshot(),before)
})

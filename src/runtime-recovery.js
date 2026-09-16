import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, normalize, resolve, relative, sep } from 'node:path'
import { manifestPath } from './artifact-paths.js'
import { validatorCommand } from './host-media.js'

const PATCH = '0.7.1'
const clone = value => structuredClone(value)
const legacyError = 'No prepared run-owned artifact root; legacy runs require a fresh task, not adoption of old outputs'
const within = (root, p) => { const r = relative(root, p); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)) }
const guardStates = ['active', 'blocked', 'failed']
function scopedLegacy(run, caller) {
  if (!run || run.isolation || run.legacyContinuation || !caller?.workspace || run.input?.project?.workspace && run.input.project.workspace !== caller.workspace) return null
  // New runs cannot erase their allocation and acquire the old compatibility path.
  if (!/^0\.[0-5]\./.test(run.playbookVersion ?? '') || (run.history ?? []).some(h => h.type === 'artifact_root_allocated')) return null
  if (!(run.revision > 0 && (run.history ?? []).some(h => h.type === 'human_review_rejected'))) return null
  if (!run.candidates?.length) return null
  const bindings = run.candidates.flatMap(c => Object.values(c.artifacts?.bindings ?? {}))
  const checks = Object.values(run.machineEvidence ?? {}).flat().filter(c => c.passed)
  bindings.push(...checks.flatMap(c => Object.values(c.bindings ?? {})))
  const recorded = new Set(bindings.filter(b => typeof b.path === 'string' && /^[a-f0-9]{64}$/.test(b.sha256 ?? '')).map(b => normalize(b.path)))
  const candidates = [...checks.map(c => c.manifestPath), ...Object.values(run.evidence ?? {}).map(e => e.production_manifest)].filter(p => typeof p === 'string')
  // Older snapshots did not name manifestPath but did bind the actual manifest bytes.
  candidates.push(...[...recorded].filter(p => p.endsWith('/production.json')))
  const workspace = caller.workspace
  const paths = [...new Set(candidates.map(p => isAbsolute(p) ? normalize(p) : resolve(workspace, p)))].filter(p =>
    recorded.has(p) && within(workspace, p) && !within(join(workspace, '.dsh-runs'), p))
  if (!paths.length) return null
  return { mode: 'legacy-same-run', runId: run.id, workspace, manifest: paths.at(-1),
    allowedRoots: [...new Set(paths.map(dirname))],
    allowedFiles: [...recorded].filter(p => isAbsolute(p) && within(workspace, p) && !within(join(workspace, '.dsh-runs'), p)),
    independentRun: false, creationAttested: false, originalStartedAt: run.startedAt }
}
/** Only recognize recorded, narrow adapter faults, never a user/model claim of a bug. */
export function runtimeRecoveryPlan(engine, id) {
  const run = engine.runs.get(String(id))
  if (!run || !guardStates.includes(run.state)) return null
  const done = run.history?.some(e => e.type === 'runtime_incident_recovered' && e.patch === PATCH && e.stageId === run.stageId && e.revision === (run.revision ?? 0))
  if (done) return null
  const caller = engine.callers?.get(String(id))
  const scope = scopedLegacy(run, caller)
  if (scope && (!run.blocker || run.blocker.reason === 'Independent media check unavailable: ' + legacyError) &&
      (run.state === 'active' || run.lastGate?.failures?.every(f => f === 'Independent media check unavailable: ' + legacyError)))
    return { code: 'legacy-continuation', stageId: run.stageId, scope, nextAction: 'recover',
      message: 'Keep this same-run user-requested revision. Recover compatibility automatically; do not cancel, clear state, relabel old bytes as a new run, or delete validators.' }
  if (!run.isolation?.prepared || run.state !== 'failed' || run.blocker || run.lastGate?.stageId !== run.stageId) return null
  const failures = run.lastGate.failures ?? []
  if (!failures.length) return null
  const rawPaths = []
  for (const f of failures) {
    const m = /^(narration|pilot|video|handoff): Missing artifact: (.+)$/.exec(f)
    if (!m || !m[2].replace(/^(\.\/)+/, '').startsWith(`.dsh-runs/${run.isolation.key}/`)) return null
    try { rawPaths.push(manifestPath(m[2], run.isolation)) } catch { return null }
  }
  if (new Set(rawPaths.map(p => p.path)).size !== 1) return null
  return { code: 'manifest-base', stageId: run.stageId, manifest: rawPaths[0].path, submitted: rawPaths[0].submitted, nextAction: 'recover',
    message: 'A recorded project-relative manifest was resolved against the run root. The plugin can recheck its canonical path and reopen this stage without clearing history or weakening a gate.' }
}

/** Preserve the actual Host reason; an execution error is not necessarily an approval denial. */
export function recoveryProbeFailure(out, callId) {
  const value = out?.value
  const clip = text => typeof text === 'string' ? text.slice(0, 1200) : null
  let category = 'invalid-result'
  if (out?.isError === true) category = 'tool-error'
  else if (value?.sandbox?.denied || value?.sandbox?.runnerFailed) category = 'sandbox-denied'
  else if (value?.timedOut === true) category = 'timeout'
  else if (value?.aborted === true || value?.signal) category = 'aborted'
  else if (value?.kind === 'background') category = 'background'
  else if (value?.kind === 'foreground' && Number.isSafeInteger(value.exitCode) && value.exitCode !== 0) category = 'process-exit'
  else if (value?.stdout?.truncated === true) category = 'truncated-result'
  return { callId, tool: 'bash', category, code: clip(out?.error?.info?.code),
    message: clip(out?.error?.message) ?? clip(out?.message) ?? `Recovery probe returned ${category}; inspect this exact tool call.`,
    exitCode: Number.isSafeInteger(value?.exitCode) ? value.exitCode : null,
    signal: clip(value?.signal), permissionsChanged: false, automaticRetry: false }
}

/** Recovery probes are fixed read-only validators through the SAME Host pipeline. */
export function createRuntimeRecovery(ctx, engine, ready) {
  const pending = new Map(), inflight = new Map()
  const allows = exec => {
    const r = pending.get(exec.callId)
    return !!r && exec.parent === r.parent && exec.agent === r.agent && exec.name === 'bash' &&
      exec.rootCallId === r.rootCallId && isDeepStrictEqual(exec.arguments, r.arguments)
  }
  async function recover(exec) {
    await ready(); engine.noteCaller(exec); await engine.queue
    const id = String(exec.agent?.id ?? ''), plan = runtimeRecoveryPlan(engine, id), run = engine.runs.get(id)
    if (!plan) {
      const status = engine.status(id)
      return { ok: true, recovered: false, status,
        nextAction: status.run?.state === 'awaiting_review' ? 'await_direct_user_review' : 'use_existing_stage_or_controlled_repair',
        message: status.run?.state === 'awaiting_review'
          ? 'Candidate awaits direct user review, not runtime recovery. Chat “拒绝候选” is supported; UI is optional. Do not cancel, clear or create a new run to manufacture rejection.'
          : 'No eligible plugin incident. No state/permission/budget was reset; do not cancel or replace the SOP to bypass checks.' }
    }
    if (inflight.has(run.id)) return inflight.get(run.id)
    const promise = perform(exec, id, clone(run), plan)
    inflight.set(run.id, promise)
    try { return await promise } finally { inflight.delete(run.id) }
  }
  async function perform(exec, id, before, plan) {
    if (!exec.agent || !exec.token || typeof ctx.tools.execute !== 'function') throw new Error('Recovery requires the original live Host tool pipeline; no filesystem/shell fallback')
    exec.signal?.throwIfAborted()
    const scope = plan.scope, own = before.isolation
    const path = scope?.manifest ?? plan.manifest, workdir = own?.realRoot ?? scope.workspace
    const command = validatorCommand('narration', path, own, undefined, scope)
    const callId = `${exec.callId}:runtime-recovery:${randomUUID()}`
    const rootCallId = exec.rootCallId ?? exec.callId
    const args = { command, workdir, description: 'Recheck recorded manifest after plugin path repair', timeoutMs: 120000 }
    pending.set(callId, { parent: exec.token, agent: exec.agent, rootCallId, arguments: clone(args) })
    let result
    try {
      const out = await ctx.tools.execute({ name: 'bash', callId, rootCallId, parent: exec.token,
        agent: exec.agent, signal: exec.signal, arguments: args })
      for (const c of out.additionalContexts ?? []) exec.deferContext?.(c)
      exec.signal?.throwIfAborted()
      const v = out.value
      if (out.isError !== false || v?.kind !== 'foreground' || v.exitCode !== 0 || v.signal !== null || v.aborted !== false ||
          v.timedOut !== false || v.stdout?.truncated !== false || v.sandbox?.denied || v.sandbox?.runnerFailed)
        return { ok: false, recovered: false, readOnly: true, notAGate: true, nextAction: 'report_actual_host_failure',
          hostFailure: recoveryProbeFailure(out, callId),
          message: 'Report the exact hostFailure, not a generic request for authorization. Do not retry unchanged, offer SOP-external production, clear the run, or guess that Host code needs editing. Existing Host permissions remain authoritative.', status: engine.status(id) }
      try {
        if (typeof v.stdout.text !== 'string' || v.stdout.text.length > 4 * 1024 * 1024) throw new Error('Invalid response length')
        result = JSON.parse(v.stdout.text)
        if (!result || result.validatorVersion !== '0.4.0' || result.kind !== 'narration' || typeof result.passed !== 'boolean') throw new Error('Unsupported response shape')
      } catch {
        return { ok: false, recovered: false, readOnly: true, notAGate: true, nextAction: 'report_actual_host_failure',
          hostFailure: { ...recoveryProbeFailure(out, callId), category: 'invalid-validator-response',
            message: 'Expected bounded narration-validator JSON; returned data did not match that contract.' },
          message: 'This is a validator-response error, not missing user authorization. Preserve the original run and report this exact call; no raw-shell fallback or repeated unchanged recovery.', status: engine.status(id) }
      }
    } finally { pending.delete(callId) }
    const binding = result.bindings?.[result.manifestPath]
    const proof = result.passed && result.status === 'pass' && result.manifestPath === path &&
      /^[a-f0-9]{64}$/.test(binding?.sha256 ?? '') && /^[a-f0-9]{64}$/.test(result.narration?.scriptSha256 ?? '')
    if (!proof) return { ok: false, recovered: false, status: engine.status(id), measurements: result.failures,
      nextAction: 'fix_actual_input_with_controlled_repair', message: 'Canonical input has not passed its read-only probe. A real content/missing-file failure is not automatically waived.' }
    if (own && (result.ownership?.runId !== own.runId || result.ownership.markerSha256 !== own.markerSha256 || result.ownership.root !== own.realRoot))
      throw new Error('Recovery ownership mismatch')
    if (scope && (result.legacyContinuation?.runId !== before.id || result.legacyContinuation?.workspace !== scope.workspace))
      throw new Error('Legacy continuation scope mismatch')
    return engine.serialize(async () => {
      exec.signal?.throwIfAborted()
      const run = engine.runs.get(id)
      if (!run || run.id !== before.id || run.stageEpoch !== before.stageEpoch || run.state !== before.state || run.revision !== before.revision)
        throw new Error('STALE_RECOVERY: run changed while the read-only probe was in flight; inspect current status')
      if (run.history.filter(h => ['gate_passed','gate_failed'].includes(h.type)).length >= engine.maxSubmissions)
        throw new Error('Global gate budget is exhausted; recovery does not reset it')
      const at = new Date(engine.clock()).toISOString()
      if (scope) run.legacyContinuation = { ...scope, establishedAt: at, manifestSha256: binding.sha256 }
      run.history.push({ type: 'runtime_incident_recovered', patch: PATCH, code: plan.code, stageId: run.stageId,
        revision: run.revision ?? 0, at, previousState: run.state, previousGate: clone(run.lastGate ?? null),
        previousBlocker: clone(run.blocker ?? null), probe: { callId, path, sha256: binding.sha256 },
        gatesBypassed: false, countersReset: false })
      run.state = 'active'; run.blocker = null; run.finishedAt = null; run.updatedAt = at
      run.stageEpoch = (run.stageEpoch ?? 0) + 1
      // Keep last failure honest, only mark the adapter repair. Normal submit is still required.
      if (run.lastGate) run.lastGate.recovery = { code: plan.code, target: run.stageId, exhausted: false, runtimeFixed: true,
        instruction: 'Continue this stage with the canonical manifest. Prior failures and budgets remain recorded; nothing has been accepted yet.' }
      await engine.save()
      return { ok: true, recovered: true, notAGate: true, status: engine.status(id), canonicalManifest: path,
        nextAction: 'execute_current_stage', message: 'Plugin incident recovered in the original run. Task, revisions, budgets and files retained; no gate was passed, no new experiment was created. Continue without asking the user to clear/cancel/restart.' }
    })
  }
  function wrap(definition) {
    return { ...definition,
      description: definition.description + ' recover repairs only recognized plugin path/legacy compatibility incidents in the same run after a real read-only probe. Never ask the user to clear/cancel a run or remove a validator to solve such an incident.',
      parameters: { ...definition.parameters, action: { ...definition.parameters.action, enum: [...definition.parameters.action.enum, 'recover'] } },
      async execute(args, exec) {
        await ready(); engine.noteCaller(exec)
        const id = String(exec.agent?.id ?? '')
        if (args.action === 'recover') return recover(exec)
        let repaired
        if (['route','submit','repair','workspace'].includes(args.action) && runtimeRecoveryPlan(engine, id)) {
          repaired = await recover(exec)
          if (!repaired.recovered || ['route','repair'].includes(args.action)) return repaired
        }
        const legacy = engine.runs.get(id)?.legacyContinuation
        if (args.action === 'workspace' && legacy) return { ok: true, workspace: legacy.allowedRoots[0], manifest: legacy.manifest,
          legacyContinuation: legacy, status: engine.status(id), message: 'Same-run revision of recorded legacy artifacts, not a new independent generation. No files or state were cleared.' }
        const result = await definition.execute(args, exec)
        return repaired ? { ...result, runtimeRecovery: { recovered: true, notAGate: true } } : result
      } }
  }
  return { recover, wrap, allows, clear: () => { pending.clear(); inflight.clear() } }
}

import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { PlaybookEngine } from './engine.js'

export const hasMediaContract = book => book?.stages?.some(stage => stage.gate?.validators?.length)
const clone = value => structuredClone(value)
const scopeKey = workspace => createHash('sha256').update(normalize(workspace)).digest('hex')
export function inside(root, path) {
  if (typeof root !== 'string' || typeof path !== 'string' || !isAbsolute(path)) return false
  const r = relative(root, path)
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r))
}
/** Host-selected route metadata, not an assertion about who generated file bytes. */
export function callerFacts(exec) {
  const agent = exec?.agent, header = agent?.session?.header ?? exec?.session?.header
  const sessionId = agent?.id ?? exec?.session?.id
  let config
  try { config = agent?.session?.requestHeader?.()?.config } catch { /* route remains unknown */ }
  return { sessionId: sessionId == null ? null : String(sessionId),
    workspace: typeof header?.cwd === 'string' && isAbsolute(header.cwd) ? normalize(header.cwd) : null,
    modelRoute: { provider: String(config?.provider ?? agent?.options?.provider ?? 'unknown'),
      model: String(config?.model ?? agent?.options?.model ?? 'unknown') } }
}

/** Media ownership is allocated by the engine, never from input/evidence run_id. */
export class IsolatedPlaybookEngine extends PlaybookEngine {
  constructor(options) { super(options); this.callers = new Map(); this.starting = new Map() }
  noteCaller(exec) {
    const facts = callerFacts(exec)
    if (facts.sessionId) this.callers.set(facts.sessionId, facts)
    return facts
  }
  async start(sessionId, bookId, input, options = {}) {
    const key = String(sessionId), book = options.definition ?? this.getPlaybook(bookId)
    const context = this.callers.get(key)
    if (hasMediaContract(book) && !context?.workspace) throw new Error('ISOLATION_CONTEXT_MISSING: media runs require the real Host session cwd; no process-cwd fallback')
    const ticket = { context: clone(context ?? null), oldId: this.runs.get(key)?.id }
    this.starting.set(key, ticket)
    try { return await super.start(sessionId, bookId, input, options) }
    finally { if (this.starting.get(key) === ticket) this.starting.delete(key) }
  }
  async save() {
    for (const [id, ticket] of this.starting) {
      const run = this.runs.get(id)
      if (!run || run.id === ticket.oldId || run.isolation || !hasMediaContract(this.playbookForRun(run))) continue
      const key = randomUUID(), workspace = ticket.context.workspace
      run.isolation = { protocol: 1, runId: run.id, sessionId: id, key, workspace,
        root: join(workspace, '.dsh-runs', key), prepared: false, allocatedAt: run.startedAt,
        modelRouteAtStart: ticket.context.modelRoute, routesObserved: [] }
      run.history.push({ type: 'artifact_root_allocated', at: run.startedAt, root: run.isolation.root })
    }
    for (const [id, run] of this.runs) {
      const route = this.callers.get(id)?.modelRoute, isolation = run.isolation
      if (!isolation || !route || run.state !== 'active') continue
      if (!isolation.routesObserved.some(row => row.provider === route.provider && row.model === route.model))
        isolation.routesObserved.push({ ...route, firstObservedAt: new Date(this.clock()).toISOString() })
    }
    // Recheck at the serialized commit boundary: two concurrent sessions must not
    // both pass before either candidate is visible to the other preflight.
    for (const run of this.runs.values()) {
      if (!run.isolation) continue
      for (const candidate of run.candidates ?? []) {
        if (candidate.isolationCommitted) continue
        const hash = candidate.artifacts?.video?.binding?.sha256
        if (hash && this.knownOutputs(run.id).some(file => file.sha256 === hash))
          throw new Error('CROSS_RUN_DUPLICATE_CONCURRENT: another retained run already owns the same final bytes; candidate was not committed')
        candidate.isolationCommitted = true
      }
    }
    await super.save()
  }
  status(sessionId) {
    const status = super.status(sessionId), run = this.runs.get(String(sessionId))
    if (!run) return status
    const isolation = run.isolation
    status.isolation = isolation ? clone(isolation) : null
    if (isolation && status.instruction) status.instruction += '\n' + [
      `CURRENT RUN ARTIFACT ROOT: ${isolation.realRoot ?? isolation.root}`,
      `Canonical manifest: ${join(isolation.realRoot ?? isolation.root, 'production.json')}`,
      isolation.prepared ? 'Directory is prepared.' : 'Before work call playbook action=workspace. Never create/adopt an existing output directory yourself.',
      'Use absolute file paths below this root and bash workdir below this root. Shared project cwd and the SOP library are NOT this run output directory.',
      'Reuse only public tools/templates, not another run final, narration, report, evidence or generated work scripts. Configure shared tools to write NEW outputs here.',
      'Ownership/timestamps/hashes are measured by the Host. A copied file with a fresh timestamp or a model-authored run_id is NOT proof of independent generation.',
    ].join('\n')
    return status
  }
  async markPrepared(sessionId, expectedRunId, result) {
    return this.serialize(async () => {
      const run = this.runs.get(String(sessionId)), own = run?.isolation
      if (!own || run.id !== expectedRunId || !['active', 'blocked'].includes(run.state)) throw new Error('STALE_WORKSPACE_PREPARATION')
      if (result.runId !== own.runId || result.key !== own.key || result.status !== 'pass' ||
          !/^[a-f0-9]{64}$/.test(result.markerSha256 ?? '') || !isAbsolute(result.root ?? '') ||
          !Number.isSafeInteger(result.createdAtMs)) throw new Error('INVALID_WORKSPACE_RECEIPT')
      if (own.prepared && (own.markerSha256 !== result.markerSha256 || own.realRoot !== result.root)) throw new Error('WORKSPACE_OWNERSHIP_CHANGED')
      const first = !own.prepared
      Object.assign(own, { prepared: true, realRoot: result.root, markerSha256: result.markerSha256, createdAtMs: result.createdAtMs })
      if (first) run.history.push({ type: 'artifact_root_prepared', at: new Date(this.clock()).toISOString(), root: result.root })
      await this.save(); return this.status(sessionId)
    })
  }
  allRuns() { return [...this.runs.values(), ...[...this.archives.values()].flat()] }
  knownOutputs(excludeRun) {
    const rows = []
    for (const run of this.allRuns()) {
      if (run.id === excludeRun) continue
      const checks = Object.values(run.machineEvidence ?? {}).flat()
      const artifacts = [...checks.filter(c => ['video', 'handoff'].includes(c.kind)).map(c => c.video?.binding),
        ...(run.candidates ?? []).map(c => c.artifacts?.video?.binding)]
      for (const file of artifacts) if (file?.sha256) rows.push({ runId: run.id, sessionId: run.sessionId, ...file })
    }
    return rows
  }
  async excludeHash(exec, sha256, reason = 'User-supplied prior output; not an independent result') {
    const context = this.noteCaller(exec)
    if (!context.workspace || !/^[a-f0-9]{64}$/i.test(sha256 ?? '')) throw new Error('exclude-hash requires Host cwd and a SHA-256 digest')
    return this.serialize(async () => {
      const excluded = this.sopLibrary.outputExclusions ??= {}, key = scopeKey(context.workspace), rows = excluded[key] ??= []
      if (!rows.some(r => r.sha256 === sha256.toLowerCase())) {
        if (rows.length >= 256) throw new Error('Workspace exclusion list reached 256 entries; review the state before adding more')
        rows.push({ sha256: sha256.toLowerCase(), reason: String(reason).slice(0, 500), at: new Date(this.clock()).toISOString() })
      }
      await this.save(); return { recorded: true, scope: 'workspace', sha256: sha256.toLowerCase() }
    })
  }
  async submit(sessionId, options = {}) {
    const run = this.runs.get(String(sessionId)), own = run?.isolation
    let checks = options.runtimeChecks
    if (own && !own.prepared) throw new Error('WORKSPACE_NOT_PREPARED: call playbook action=workspace before stage submission')
    if (!own && run?.legacyContinuation && checks?.length) {
      const scope = run.legacyContinuation, known = this.knownOutputs(run.id)
      checks = checks.map(raw => {
        const check = clone(raw), failures = []
        if (check.status === 'unavailable') return check
        if (check.legacyContinuation?.runId !== run.id || check.legacyContinuation?.workspace !== scope.workspace)
          failures.push('LEGACY_SCOPE_MISMATCH: continuation scope comes from the retained run, never model claims')
        for (const file of Object.values(check.bindings ?? {}))
          if (!scope.allowedRoots.some(root => inside(root,file.path)) && !scope.allowedFiles.includes(file.path)) failures.push('LEGACY_SCOPE_MISMATCH: artifact outside recorded same-run locations')
        if (['video','handoff'].includes(check.kind) && known.some(file => file.sha256 === check.video?.binding?.sha256))
          failures.push('CROSS_RUN_DUPLICATE: legacy repair cannot borrow another retained run final')
        if (failures.length) { check.passed=false;check.status='fail';check.failures=[...(check.failures??[]),...failures] }
        check.provenance={runId:run.id,sessionId:run.sessionId,revision:run.revision??0,mode:'legacy-same-run',independentRun:false,creationAttested:false}
        return check
      })
    }
    if (own && checks?.length) {
      const known = this.knownOutputs(run.id), exclusions = this.sopLibrary.outputExclusions?.[scopeKey(own.workspace)] ?? []
      checks = checks.map(raw => {
        const check = clone(raw), errors = []
        if (check.status === 'unavailable') return check
        const identity = check.ownership
        if (!identity || identity.runId !== run.id || identity.key !== own.key || identity.root !== own.realRoot ||
            identity.markerSha256 !== own.markerSha256 || identity.createdAtMs !== own.createdAtMs)
          errors.push('RUN_OWNERSHIP_MISMATCH: missing or foreign Host artifact ownership')
        for (const binding of Object.values(check.bindings ?? {})) if (!inside(own.realRoot, binding.path))
          errors.push('CROSS_RUN_PATH: artifact is not in the current allocated run root')
        const digest = check.video?.binding?.sha256
        if (['video','handoff'].includes(check.kind) && digest) {
          const duplicate = known.find(row => row.sha256 === digest)
          if (duplicate) errors.push(`CROSS_RUN_DUPLICATE: final bytes equal recorded output of run ${duplicate.runId}. Independent production is not established; do not relabel or re-encode to conceal reuse.`)
          if (exclusions.some(row => row.sha256 === digest)) errors.push('EXCLUDED_OUTPUT_HASH: final bytes match a user-registered prior result')
        }
        if (errors.length) { check.failures = [...(check.failures ?? []), ...errors]; check.passed = false; check.status = 'fail' }
        check.provenance = { runId: run.id, sessionId: run.sessionId, revision: run.revision ?? 0,
          verifiedInStage: options.stageId, verifiedAt: new Date(this.clock()).toISOString(),
          hostSelectedModel: clone(this.callers.get(String(sessionId))?.modelRoute ?? own.modelRouteAtStart),
          creationAttested: false }
        return check
      })
    }
    return super.submit(sessionId, { ...options, runtimeChecks: checks })
  }
  report(sessionId) {
    const report = super.report(sessionId), run = this.runs.get(String(sessionId))
    if (!run?.isolation) return { ...report, legacyContinuation: clone(run?.legacyContinuation ?? null), artifactIsolation: 'legacy-or-non-media: no independent-run guarantee' }
    const artifacts = Object.entries(run.machineEvidence ?? {}).flatMap(([stage, checks]) => checks.flatMap(check =>
      Object.values(check.bindings ?? {}).map(binding => ({ ...binding, ...check.provenance, verifiedInStage: stage }))))
    return { ...report, isolation: clone(run.isolation), artifactLineage: artifacts,
      provenanceLimit: 'Host-measured validation-time ownership and selected model route; NOT proof of generation by that model, an OS sandbox, or a signature. Known-hash coverage is limited to retained runs and user exclusions.' }
  }
}

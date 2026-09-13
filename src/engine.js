import * as control from './run-control.js'
import { mediaIssues } from './media-checks.js'
import { randomUUID } from 'node:crypto'
import { repairEvidenceShape, gateDiagnostics, formatStageInstruction, normalizePlaybook, publicStage, stageById, toolPolicyDecision } from './core.js'

function nowIso(clock) {
  return new Date(clock()).toISOString()
}

function clone(value) {
  return structuredClone(value)
}

function emptyObservations() {
  return {}
}

function runIdOf(sessionId, playbookId, clock) {
  return `${playbookId}:${sessionId}:${clock()}:${randomUUID()}`
}

export class PlaybookEngine {
  constructor({ clock = Date.now, persist = async () => {}, maxSubmissions = 64, maxFormatRepairs = 3 } = {}) {
    if (!Number.isSafeInteger(maxSubmissions) || maxSubmissions < 1) throw new Error('maxSubmissions must be positive')
    if (!Number.isSafeInteger(maxFormatRepairs) || maxFormatRepairs < 1) throw new Error('maxFormatRepairs must be positive')
    this.maxFormatRepairs = maxFormatRepairs
    this.maxSubmissions = maxSubmissions
    this.clock = clock
    this.persist = persist
    this.catalog = new Map()
    this.runs = new Map()
    this.archives = new Map()
    this.queue = Promise.resolve()
  }

  serialize(task) {
    // A failed durable write must not leave an uncommitted run active in memory.
    const transaction = async () => {
      const before = new Map([...this.runs].map(([key, value]) => [key, clone(value)]))
      const archived = new Map([...this.archives].map(([key, value]) => [key, clone(value)]))
      try { return await task() } catch (error) { this.runs = before; this.archives = archived; throw error }
    }
    const next = this.queue.then(transaction, transaction)
    this.queue = next.catch(() => {})
    return next
  }

  register(input, { source = 'runtime' } = {}) {
    const playbook = normalizePlaybook(input)
    this.catalog.set(playbook.id, { playbook, source })
    return clone(playbook)
  }

  replaceCatalog(entries) {
    const next = new Map()
    for (const entry of entries) {
      const playbook = normalizePlaybook(entry.playbook ?? entry)
      next.set(playbook.id, { playbook, source: entry.source ?? 'runtime' })
    }
    this.catalog = next
    return this.listPlaybooks()
  }

  listPlaybooks() {
    return [...this.catalog.values()]
      .map(({ playbook, source }) => ({ id: playbook.id, name: playbook.name, version: playbook.version, description: playbook.description, stages: playbook.stages.length, routing: clone(playbook.routing), source }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  getPlaybook(id) {
    return this.catalog.get(id)?.playbook
  }

  hydrate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return
    for (const [id, rows] of Object.entries(snapshot.archives ?? {})) if (Array.isArray(rows)) this.archives.set(id, clone(rows.slice(-20)))
    const rows = snapshot.runs && typeof snapshot.runs === 'object' ? snapshot.runs : {}
    for (const [sessionId, run] of Object.entries(rows)) {
      if (!run || typeof run !== 'object') continue
      if (!this.runs.has(sessionId)) this.runs.set(sessionId, clone(run))
    }
  }

  snapshot() {
    return { version: 2, archives: Object.fromEntries(this.archives), runs: Object.fromEntries([...this.runs.entries()].map(([key, value]) => [key, clone(value)])) }
  }

  async save() {
    await this.persist(this.snapshot())
  }

  activeRun(sessionId) {
    const run = this.runs.get(String(sessionId))
    return run?.state === 'active' ? run : undefined
  }

  attachedRun(sessionId) {
    const run = this.runs.get(String(sessionId))
    return ['active', 'blocked', 'awaiting_review'].includes(run?.state) ? run : undefined
  }

  playbookForRun(run) {
    if (run?.playbookSnapshot) return run.playbookSnapshot
    return run ? this.getPlaybook(run.playbookId) : undefined
  }

  currentStage(sessionId) {
    const run = this.attachedRun(sessionId)
    if (!run) return undefined
    const playbook = this.playbookForRun(run)
    return playbook ? stageById(playbook, run.stageId) : undefined
  }

  async start(sessionId, playbookId, input = {}, { signal } = {}) {
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const key = String(sessionId)
      if (['active', 'blocked'].includes(this.runs.get(key)?.state)) throw new Error(`session ${key} already has an active playbook`)
      const playbook = this.getPlaybook(playbookId)
      if (!playbook) throw new Error(`unknown playbook: ${playbookId}`)
      if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) throw new Error('playbook input must be an object')
      const at = nowIso(this.clock)
      const run = {
        id: runIdOf(key, playbook.id, this.clock),
        sessionId: key,
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        playbookSnapshot: clone(playbook),
        state: 'active',
        stageId: playbook.initialStage,
        stageAttempt: 1,
        stageEpoch: 1,
        formatRepairs: 0,
        input: clone(input ?? {}),
        evidence: {},
        observations: emptyObservations(),
        startedAt: at,
        updatedAt: at,
        finishedAt: null,
        history: [{ type: 'run_started', at, stageId: playbook.initialStage }],
      }
      run.revision = 0; run.selfRepairs = 0; run.machineEvidence = {}; run.candidates = []; run.revisions = []
      if (this.runs.has(key)) this.archives.set(key, [...(this.archives.get(key) ?? []), clone(this.runs.get(key))].slice(-20))
      this.runs.set(key, run)
      await this.save()
      return this.status(key)
    })
  }

  status(sessionId) {
    const key = String(sessionId)
    const run = this.runs.get(key)
    if (!run) return { active: false, sessionId: key }
    const playbook = this.playbookForRun(run)
    const stage = playbook ? stageById(playbook, run.stageId) : undefined
    return {
      active: run.state === 'active',
      attached: ['active', 'blocked', 'awaiting_review'].includes(run.state),
      machineEvidence: clone(run.machineEvidence ?? {}),
      previousCandidate: clone(run.previousCandidate ?? null),
      revisionFeedback: clone(run.revisions?.at(-1) ?? null),
      blocker: clone(run.blocker ?? null),
      run: {
        id: run.id,
        sessionId: run.sessionId,
        playbookId: run.playbookId,
        playbookVersion: run.playbookVersion,
        state: run.state,
        stageId: run.stageId,
        stageAttempt: run.stageAttempt,
        stageEpoch: run.stageEpoch ?? 0,
        revision: run.revision ?? 0,
        selfRepairs: run.selfRepairs ?? 0,
        formatRepairs: run.formatRepairs ?? 0,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        finishedAt: run.finishedAt,
      },
      stage: stage ? publicStage(stage) : null,
      instruction: stage ? formatStageInstruction(stage, run.stageAttempt) : null,
      input: clone(run.input ?? {}),
      evidence: clone(run.evidence ?? {}),
      observations: clone(run.observations ?? {}),
      lastGate: clone(run.lastGate ?? null),
    }
  }

  async observeTool(sessionId, event) {
    const key = String(sessionId)
    return this.serialize(async () => {
      const run = this.activeRun(key)
      if (!run) return false
      if (!event || typeof event.name !== 'string' || event.name === 'playbook') return false
      if (event.runId !== undefined && (event.runId !== run.id || event.stageId !== run.stageId || event.attempt !== run.stageAttempt || (event.epoch !== undefined && event.epoch !== (run.stageEpoch ?? 0)))) return false
      const row = (Object.hasOwn(run.observations, event.name) ? run.observations[event.name] : undefined) ?? { calls: 0, successes: 0, failures: 0, lastAt: null, lastCallId: null }
      // The same callback/receipt must not inflate success counts.
      const callId = event.callId === undefined ? null : String(event.callId)
      const seen = row.seenCallIds ?? []
      if (callId && seen.includes(callId)) return false
      if (callId) row.seenCallIds = [...seen, callId].slice(-128)
      if (event.receipt && event.receipt.callId === callId && event.receipt.tool === event.name) {
        row.receipts = [...(row.receipts ?? []), clone(event.receipt)].slice(-16)
      }
      run.toolResultsObserved = (run.toolResultsObserved ?? 0) + 1
      row.calls += 1
      if (event.isError) row.failures += 1
      else row.successes += 1
      row.lastAt = event.at ?? nowIso(this.clock)
      row.lastCallId = event.callId === undefined ? null : String(event.callId)
      Object.defineProperty(run.observations, event.name, { value: row, writable: true, enumerable: true, configurable: true })
      run.updatedAt = row.lastAt
      await this.save()
      return true
    })
  }

  async submit(sessionId, { stageId, evidence = {}, note = '', signal, runtimeChecks, expected } = {}) {
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const key = String(sessionId)
      const run = this.activeRun(key)
      if (!run) throw new Error(`session ${key} has no active playbook`)
      if (expected && (expected.runId !== run.id || expected.epoch !== run.stageEpoch || expected.revision !== (run.revision ?? 0))) throw new Error('Stale validation result: run/stage/revision changed during checking')
      const playbook = this.playbookForRun(run)
      if (!playbook) throw new Error(`playbook ${run.playbookId} is unavailable and the run has no embedded snapshot`)
      const stage = stageById(playbook, run.stageId)
      if (!stage) throw new Error(`current stage ${run.stageId} no longer exists in playbook ${playbook.id}`)
      if (stageId !== undefined && stageId !== stage.id) throw new Error(`stage mismatch: current=${stage.id}, submitted=${stageId}`)
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('evidence must be an object')
      const at = nowIso(this.clock)
      const submissions = run.history.filter(event => event.type === 'gate_passed' || event.type === 'gate_failed').length
      if (submissions >= this.maxSubmissions) {
        run.state = 'failed'
        run.finishedAt = at
        run.updatedAt = at
        run.lastGate = { stageId: stage.id, attempt: run.stageAttempt, passed: false, failures: ['total submission budget exhausted'], at }
        run.history.push({ type: 'run_failed', at, stageId: stage.id, reason: 'submission_budget' })
        await this.save()
        return this.status(key)
      }
      if (JSON.stringify(evidence).length > 32768) throw new Error('evidence exceeds 32768 characters; submit artifact references and concise findings')
      const shaped = repairEvidenceShape(stage, evidence)
      evidence = shaped.evidence
      if (shaped.corrections.length) run.history.push({ type: 'evidence_shape_corrected', at, revision: run.revision ?? 0, corrections: shaped.corrections })
      const gate = gateDiagnostics(stage, evidence, run.observations)
      if (!gate.issues.some(item => item.kind === 'format')) {
        const machine = mediaIssues(stage, runtimeChecks, run)
        gate.issues.push(...machine); gate.failures.push(...machine.map(item => item.message)); gate.passed = gate.issues.length === 0
      }
      run.validatorCalls = (run.validatorCalls ?? 0) + (runtimeChecks?.length ?? 0)
      if (runtimeChecks?.length) run.history.push({ type: 'artifact_validation', at, revision: run.revision ?? 0, stageId: stage.id,
        checks: runtimeChecks.map(c => ({ kind: c.kind, passed: c.passed, status: c.status, failures: c.failures, callId: c.callId ?? null })) })
      if (runtimeChecks?.some(check => check.status === 'unavailable')) {
        run.state = 'blocked'; run.blocker = { kind: 'prerequisite', reason: 'Independent media check unavailable: ' + runtimeChecks.flatMap(c => c.failures ?? []).join('; ').slice(0, 1500), at }
        run.lastGate = { stageId: stage.id, passed: false, failures: [run.blocker.reason], at }; run.updatedAt = at
        run.history.push({ type: 'run_blocked', at, revision: run.revision ?? 0, stageId: stage.id, reason: run.blocker.reason })
        await this.save(); return this.status(key)
      }
      run.lastGate = { stageId: stage.id, attempt: run.stageAttempt, passed: gate.passed, failures: gate.failures, issues: gate.issues, at }
      const formatOnly = gate.issues.length > 0 && gate.issues.every(issue => issue.kind === 'format')
      if (formatOnly) {
        run.formatRepairs = (run.formatRepairs ?? 0) + 1
        run.updatedAt = at
        run.lastGate.repairOnly = true
        run.history.push({ type: 'format_repair', at, stageId: stage.id, failures: clone(gate.failures) })
        if (run.formatRepairs >= this.maxFormatRepairs) {
          run.state = 'blocked'
          run.blocker = { kind: 'format', reason: 'Repeated invalid evidence format; use bounded action=repair after inspecting expected shapes.', at }
          run.history.push({ type: 'run_blocked', at, stageId: stage.id, reason: run.blocker.reason })
        }
        await this.save()
        return this.status(key)
      }
      if (gate.passed) { run.evidence[stage.id] = clone(evidence); (run.machineEvidence ??= {})[stage.id] = clone(runtimeChecks ?? []) }
      run.history.push({ type: gate.passed ? 'gate_passed' : 'gate_failed', at, stageId: stage.id, attempt: run.stageAttempt, failures: clone(gate.failures), note: String(note ?? '') })

      if (gate.passed) {
        run.formatRepairs = 0
        if (stage.next === null) {
          run.state = playbook.delivery?.review ? 'awaiting_review' : 'completed'
          run.finishedAt = at
          run.updatedAt = at
          const media = Object.values(run.machineEvidence ?? {}).flat().find(c => c.kind === 'video')
          run.candidates ??= []; run.candidates.push({ at, revision: run.revision ?? 0, state: run.state, artifacts: media ? clone({ video: media.video, cover: media.cover, bindings: media.bindings }) : null })
          run.history.push({ type: run.state === 'awaiting_review' ? 'candidate_ready' : 'run_completed', at, revision: run.revision ?? 0, stageId: stage.id })
        } else {
          run.stageId = stage.next
          run.stageAttempt = 1
          run.stageEpoch = (run.stageEpoch ?? 0) + 1
          run.observations = emptyObservations()
          run.updatedAt = at
          run.history.push({ type: 'stage_entered', at, stageId: stage.next, from: stage.id, reason: 'gate_passed' })
        }
      } else if (run.stageAttempt < stage.retry.maxAttempts) {
        run.stageAttempt += 1
        run.formatRepairs = 0
        run.stageEpoch = (run.stageEpoch ?? 0) + 1
        run.observations = emptyObservations()
        run.updatedAt = at
        run.history.push({ type: 'stage_retry', at, stageId: stage.id, attempt: run.stageAttempt })
      } else {
        const exhausted = stage.retry.onExhausted
        let target = stage.onFailure
        let reason = 'onFailure'
        if (exhausted.startsWith('branch:')) {
          target = exhausted.slice('branch:'.length)
          reason = 'retry_branch'
        } else if (exhausted === 'explore') {
          target = stage.onFailure
          reason = 'explore'
        }
        if (target) {
          const invalidated = control.invalidate(run, playbook, target)
          run.history.push({ type: 'evidence_invalidated', at, revision: run.revision ?? 0, stages: invalidated })
          run.formatRepairs = 0
          run.stageId = target
          run.stageAttempt = 1
          run.stageEpoch = (run.stageEpoch ?? 0) + 1
          run.observations = emptyObservations()
          run.updatedAt = at
          run.history.push({ type: 'stage_entered', at, stageId: target, from: stage.id, reason })
        } else {
          run.state = 'failed'
          run.finishedAt = at
          run.updatedAt = at
          run.history.push({ type: 'run_failed', at, stageId: stage.id, reason: exhausted, failures: clone(gate.failures) })
        }
      }
      await this.save()
      return this.status(key)
    })
  }

  async check(sessionId, { stageId, evidence = {}, signal } = {}) {
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const run = this.attachedRun(sessionId)
      if (!run) throw new Error('no attached playbook')
      const stage = this.currentStage(sessionId)
      if (stageId !== stage.id) throw new Error(`stage mismatch: current=${stage.id}, submitted=${stageId}`)
      const fixed = repairEvidenceShape(stage, evidence)
      const preliminary = gateDiagnostics(stage, fixed.evidence, run.observations)
      return { ...preliminary, passed: preliminary.passed && !(stage.gate.validators ?? []).length, formatPassed: preliminary.passed, stageId, dryRun: true, corrections: fixed.corrections, machineChecksPending: (stage.gate.validators ?? []).length > 0, note: 'Format/receipt preflight only; independent artifact checks execute on submit.' }
    })
  }

  async block(sessionId, reason, { signal } = {}) {
    if (typeof reason !== 'string' || reason.trim().length < 8) throw new Error('block requires a concrete reason (at least 8 characters)')
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const run = this.attachedRun(sessionId)
      if (!run || !['active','blocked'].includes(run.state)) throw new Error('no active/blocked playbook to block')
      const at = nowIso(this.clock)
      run.state = 'blocked'
      run.blocker = { kind: 'prerequisite', reason: reason.trim().slice(0, 2000), at }
      run.updatedAt = at
      run.history.push({ type: 'run_blocked', at, stageId: run.stageId, reason: run.blocker.reason })
      await this.save()
      return this.status(sessionId)
    })
  }

  /** Only the human command surface exposes resume; never the model tool. */
  async resume(sessionId, { signal } = {}) {
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const run = this.attachedRun(sessionId)
      if (run?.state !== 'blocked') throw new Error('run is not blocked')
      run.state = 'active'
      run.blocker = null
      run.formatRepairs = 0
      run.updatedAt = nowIso(this.clock)
      run.history.push({ type: 'run_resumed', at: run.updatedAt, stageId: run.stageId })
      await this.save()
      return this.status(sessionId)
    })
  }

  repair(sessionId, target, reason, options) { return control.repair(this, sessionId, target, reason, options) }
  requestRevision(sessionId, reason, options) { return control.requestRevision(this, sessionId, reason, options) }
  accept(sessionId, options) { return control.accept(this, sessionId, options) }
  report(sessionId) { return control.report(this, sessionId) }

  async cancel(sessionId, reason = 'cancelled by caller', { signal } = {}) {
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const key = String(sessionId)
      const found = this.runs.get(key)
      const run = ['active', 'blocked', 'awaiting_review', 'failed'].includes(found?.state) ? found : undefined
      if (!run) throw new Error(`session ${key} has no active playbook`)
      const at = nowIso(this.clock)
      run.state = 'cancelled'
      run.blocker = null
      run.finishedAt = at
      run.updatedAt = at
      run.history.push({ type: 'run_cancelled', at, stageId: run.stageId, reason: String(reason) })
      await this.save()
      return this.status(key)
    })
  }

  policyDecision(sessionId, toolName, controllerToolName = 'playbook') {
    const state = this.runs.get(String(sessionId))?.state
    const controls = [controllerToolName, 'run_code', 'ask_user_question', 'AskUserQuestion']
    if (['failed', 'blocked'].includes(state) && !controls.includes(toolName)) return `Playbook is ${state}. Use controlled repair or report the missing prerequisite; do not work outside the SOP.`
    if (state === 'awaiting_review' && ![...controls, 'present_file', 'present_files', 'read', 'read_image'].includes(toolName)) return 'Candidate awaits user review. Use report/presentation or handle explicit user revision; do not silently edit the delivered version.'
    return toolPolicyDecision(this.currentStage(String(sessionId)), toolName, controllerToolName)
  }
}

import { workBudget } from './work-budget.js'
import { runtimeRecoveryPlan } from './runtime-recovery.js'
import { IsolatedPlaybookEngine } from './run-isolation.js'
import { invalidate } from './run-control.js'
import { toolPolicyDecision } from './core.js'

/** Recover the faulty dependency, never relax its gate or silently rerender media. */
export function recoveryFor(stageId, failures, book) {
  const text = (failures ?? []).join('\n')
  let target, code, instruction
  if (/NARRATION_STALE|NARRATION_COVERAGE/.test(text)) {
    target = 'script'; code = 'narration'; instruction = 'Reconcile the full script and exact segment text here. Reuse unchanged same-run audio; regenerate only changed text. Do not loop through produce/qa.'
  } else if (/QA_STALE/.test(text)) {
    target = 'qa'; code = 'qa-stale'; instruction = 'Recheck the current files at qa. A stale snapshot alone is not a reason to regenerate audio, images or the whole video.'
  } else if (/SUBTITLE_|SRT time ranges|SRT block|SRT has no|subtitle/i.test(text) && !/audio|RUN_|CROSS_RUN|OWNERSHIP/.test(text)) {
    target = stageId === 'handoff' ? 'qa' : stageId; code = 'subtitles'; instruction = 'Fix only the narration subtitle track, manifest selection or timing. ASS quote/title overlays are separate from narration; punctuation differences do not require TTS or image regeneration.'
  } else if (/Missing artifact:|A non-empty local path|Declared duration is stale|Cover binding is missing\/stale/.test(text)) {
    target = stageId; code = 'manifest'; instruction = 'Check the exact missing/stale manifest reference first. Paths are relative to the manifest, not an extra copy of its parent path. Do not fabricate files or automatically redo production.'
  }
  if (!target || !book.stages.some(s => s.id === target)) return null
  const from = book.stages.findIndex(s => s.id === stageId), to = book.stages.findIndex(s => s.id === target)
  if (to > from) return null
  return { target, code, instruction }
}

/** Runtime fixes also help old pinned runs, without rewriting their SOP definitions. */
export class WorkflowEngine extends IsolatedPlaybookEngine {
  constructor(options) { super(options); this.submissions = new Map() }
  async submit(id, options) {
    const key = String(id); this.submissions.set(key, (this.submissions.get(key) ?? 0) + 1)
    try { return await super.submit(id, options) }
    finally { const n = this.submissions.get(key) - 1; if (n) this.submissions.set(key, n); else this.submissions.delete(key) }
  }
  async save() {
    for (const [id, run] of this.runs) {
      const gate = run.lastGate
      if (!this.submissions.has(id) || !gate || gate.passed || gate.repairOnly || gate.recovery ||
          !['active','failed'].includes(run.state) || run.updatedAt !== gate.at ||
          !(gate.issues ?? []).length || !gate.issues.every(i => i.kind === 'verification')) continue
      const book = this.playbookForRun(run), plan = recoveryFor(gate.stageId, gate.failures, book)
      if (!plan) continue
      const continuations = run.history.filter(e => e.type === 'human_work_continued').length
      const key = `${run.revision ?? 0}:${gate.stageId}:${plan.code}${continuations ? ':c' + continuations : ''}`
      const count = (run.recoveryCounts ??= {})[key] ?? 0
      const budget = workBudget(this, run)
      if (count >= 3 || budget.submissions.exhausted) {
        // Stop a repeated corrective loop, not a permission issue. User controls remain.
        run.state = 'failed'; run.finishedAt = gate.at
        gate.recovery = { ...plan, exhausted: true }
        run.history.push({ type: 'recovery_exhausted', at: gate.at, stageId: gate.stageId, code: plan.code })
        continue
      }
      run.recoveryCounts[key] = count + 1
      const invalidated = invalidate(run, book, plan.target)
      run.state = 'active'; run.blocker = null; run.finishedAt = null
      run.stageId = plan.target; run.stageAttempt = 1; run.stageEpoch = (run.stageEpoch ?? 0) + 1
      run.formatRepairs = 0; run.observations = {}
      gate.recovery = { ...plan, exhausted: false, automatic: true }
      run.history.push({ type: 'dependency_recovery', at: gate.at, from: gate.stageId, stageId: plan.target,
        revision: run.revision ?? 0, code: plan.code, invalidated, attempt: count + 1 })
    }
    await super.save()
  }
  status(id) {
    const status = super.status(id), run = this.runs.get(String(id))
    if (!run) return status
    const plan = runtimeRecoveryPlan(this, String(id))
    status.runtimeRecovery = plan ? {code:plan.code,nextAction:'recover',message:plan.message} : null
    status.legacyContinuation = run.legacyContinuation ? structuredClone(run.legacyContinuation) : null
    if (plan && status.instruction) status.instruction = `PLUGIN INCIDENT: ${plan.message} Call playbook(action="recover") automatically before other work. No user clear/cancel is needed.\n${status.instruction}`
    if (run.legacyContinuation && status.instruction) status.instruction = `LEGACY SAME-RUN CONTINUATION: ${run.legacyContinuation.allowedRoots.join(', ')}. Keep original identity; not an independent new-model experiment.\n${status.instruction}`
    const rows = Object.values(run.observations ?? {})
    const calls = rows.reduce((sum, row) => sum + (row.calls ?? 0), 0)
    status.activity = { stageToolCalls: calls, nonBlocking: true }
    if (run.state === 'active' && calls >= 32) status.activity.notice = `This stage has ${calls} observed tool results. Check whether work is expanding beyond its objective. Finish a pilot after ONE complete natural segment; do not batch the whole film or repeatedly repaint minor details here. Reuse unchanged verified same-run assets. This notice does not cancel jobs or change quality gates.`
    if (status.lastGate?.recovery) status.recovery = status.lastGate.recovery
    return status
  }
  policyDecision(id, name, controller = 'playbook') {
    const state = this.runs.get(String(id))?.state
    if (['awaiting_review','failed','blocked'].includes(state) &&
        ['present','present_file','present_files','read','read_image','grep','glob','job_output'].includes(name))
      return toolPolicyDecision(this.currentStage(String(id)), name, controller)
    const plan = runtimeRecoveryPlan(this, String(id))
    if (plan && name === 'bash' && ['failed','blocked'].includes(state)) return 'Recover this recorded plugin incident automatically with playbook(action="recover"). Do not ask the user to clear/cancel/restart or remove validators.'
    const decision = super.policyDecision(id, name, controller)
    return decision && name === 'bash' && ['awaiting_review','failed','blocked'].includes(state)
      ? `${decision} For read-only media measurements use playbook(action="diagnose"); do not retry shell variants or ask for cancellation.` : decision
  }
  report(id) {
    const result = super.report(id)
    if (result.summary) result.summary.runtimeRecoveries = (result.history ?? []).filter(e => e.type === 'runtime_incident_recovered').length
    if (result.summary) result.summary.dependencyRecoveries = (result.history ?? []).filter(e => e.type === 'dependency_recovery').length
    return result
  }
}

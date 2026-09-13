/** Durable revision control and reports. No model-authored counts or grades. */
const clone = value => structuredClone(value)
const at = engine => new Date(engine.clock()).toISOString()
const terminal = new Set(['completed', 'awaiting_review', 'accepted', 'failed', 'cancelled'])
export function invalidate(run, book, target) {
  const previous = Object.values(run.machineEvidence ?? {}).flat().find(check => check.kind === 'video')
  if (previous?.video) run.previousCandidate = clone({ video: previous.video, cover: previous.cover })
  const ids = new Set()
  let cursor = target
  while (cursor && !ids.has(cursor)) {
    ids.add(cursor); cursor = book.stages.find(stage => stage.id === cursor)?.next
  }
  for (const id of ids) { delete run.evidence[id]; if (run.machineEvidence) delete run.machineEvidence[id] }
  return [...ids]
}
export async function repair(engine, sessionId, target, reason, { signal } = {}) {
  if (typeof reason !== 'string' || reason.trim().length < 8) throw new Error('repair needs a concrete diagnosis, not a budget reset')
  return engine.serialize(async () => {
    signal?.throwIfAborted()
    const run = engine.runs.get(String(sessionId)), book = engine.playbookForRun(run)
    if (!run || !['active', 'blocked', 'failed'].includes(run.state)) throw new Error('No repairable run; candidate rejection requires direct user feedback')
    if (run.state === 'blocked' && run.blocker?.kind !== 'format') throw new Error('Missing prerequisites/permissions require the user to resolve and resume; technical repair cannot waive them')
    if (run.history.filter(e => ['gate_passed', 'gate_failed'].includes(e.type)).length >= engine.maxSubmissions) throw new Error('Total gate budget exhausted; cannot reset it by repair')
    const max = book.delivery?.maxSelfRepairs ?? 2
    if ((run.selfRepairs ?? 0) >= max) throw new Error(`Self-repair budget ${max} exhausted; report the blocker to the user`)
    target ||= run.stageId
    const currentIndex = book.stages.findIndex(s => s.id === run.stageId), targetIndex = book.stages.findIndex(s => s.id === target)
    if (targetIndex < 0 || targetIndex > currentIndex) throw new Error('repair may only return to the same or an earlier stage')
    if (book.delivery && !book.delivery.repairStages.includes(target) && target !== run.stageId) throw new Error('Target is outside declared repair stages')
    const invalidated = invalidate(run, book, target), from = run.stageId
    run.selfRepairs = (run.selfRepairs ?? 0) + 1
    run.state = 'active'; run.blocker = null; run.finishedAt = null
    run.stageId = target; run.stageAttempt = 1; run.stageEpoch = (run.stageEpoch ?? 0) + 1
    run.formatRepairs = 0; run.observations = {}; run.updatedAt = at(engine)
    run.history.push({ type: 'controlled_repair', at: run.updatedAt, revision: run.revision ?? 0,
      from, stageId: target, reason: reason.trim().slice(0, 2000), invalidated, selfRepairs: run.selfRepairs })
    await engine.save(); return engine.status(sessionId)
  })
}
export async function requestRevision(engine, sessionId, reason, { signal, messageId } = {}) {
  return engine.serialize(async () => {
    signal?.throwIfAborted()
    const run = engine.runs.get(String(sessionId)), book = engine.playbookForRun(run)
    if (!run || !book || !terminal.has(run.state) || run.state === 'cancelled') throw new Error('No completed/candidate/failed run to revise')
    if (messageId && (run.feedbackIds ?? []).includes(messageId)) return engine.status(sessionId)
    const revision = (run.revision ?? 0) + 1, max = book.delivery?.maxRevisions ?? 2
    if (revision > max) throw new Error(`User revision budget ${max} reached; start a deliberate new task instead of hiding the old run`)
    const target = book.delivery?.revisionStage ?? (book.stages.find(s => s.id === 'qa')?.id ?? book.initialStage)
    const now = at(engine)
    run.previousCandidate = clone(run.candidates?.at(-1)?.artifacts ?? run.previousCandidate ?? null)
    // Keep a truthful historical snapshot before invalidating the rework chain.
    run.revisions ??= []
    run.revisions.push({ revision, requestedAt: now, previousState: run.state, reason: String(reason).slice(0, 4000),
      previousCandidate: clone(run.previousCandidate) })
    run.revision = revision
    run.feedbackIds = [...(run.feedbackIds ?? []), ...(messageId ? [messageId] : [])].slice(-64)
    const start = book.stages.find(s => s.id === 'qa')?.id ?? target
    const invalidated = invalidate(run, book, start)
    run.state = 'active'; run.blocker = null; run.finishedAt = null
    run.stageId = target; run.stageAttempt = 1; run.stageEpoch = (run.stageEpoch ?? 0) + 1
    run.observations = {}; run.formatRepairs = 0; run.updatedAt = now
    run.history.push({ type: 'human_review_rejected', at: now, revision, stageId: target,
      reason: String(reason).slice(0, 4000), invalidated, messageId: messageId ?? null })
    await engine.save(); return engine.status(sessionId)
  })
}
export async function accept(engine, sessionId, { signal, messageId } = {}) {
  return engine.serialize(async () => {
    signal?.throwIfAborted()
    const run = engine.runs.get(String(sessionId))
    if (run?.state !== 'awaiting_review') throw new Error('Only an awaiting-review candidate can be accepted')
    run.state = 'accepted'; run.updatedAt = at(engine); run.acceptedAt = run.updatedAt
    run.history.push({ type: 'human_review_accepted', at: run.updatedAt, revision: run.revision ?? 0, messageId: messageId ?? null })
    await engine.save(); return engine.status(sessionId)
  })
}
export function report(engine, sessionId) {
  const run = engine.runs.get(String(sessionId)), status = engine.status(sessionId)
  if (!run) return { ...status, reportVersion: 2, summary: null, history: [], archivedRuns: [] }
  const book = engine.playbookForRun(run), h = run.history ?? [], count = type => h.filter(e => e.type === type).length
  const normal = new Set(); let cursor = book?.initialStage
  while (cursor && !normal.has(cursor)) { normal.add(cursor); cursor = book.stages.find(s => s.id === cursor)?.next }
  return { ...status, reportVersion: 2, summary: {
    declaredStageCount: book?.stages.length ?? 0, normalPathStageCount: normal.size,
    currentAcceptedStageCount: Object.keys(run.evidence ?? {}).length,
    gatesPassed: count('gate_passed'), gatesFailed: count('gate_failed'),
    formatRepairs: count('format_repair'), losslessShapeCorrections: count('evidence_shape_corrected'),
    selfRepairs: run.selfRepairs ?? 0, humanReviewRejections: count('human_review_rejected'),
    humanReviewAcceptances: count('human_review_accepted'), revisions: run.revision ?? 0,
    validatorCalls: run.validatorCalls ?? 0, toolResultsObserved: run.toolResultsObserved ?? 0,
    engineStartedAt: run.startedAt, lastCandidateAt: run.candidates?.at(-1)?.at ?? null,
    engineElapsedMs: Math.max(0, (run.finishedAt ? Date.parse(run.finishedAt) : engine.clock()) - Date.parse(run.startedAt)),
    timeDefinition: 'Engine start to candidate/terminal timestamp (or now); includes waits, not model compute time or user enqueue time',
    semanticVerification: 'Not independently certified; no A/B grade or user acceptance is inferred',
  }, history: clone(h), candidates: clone(run.candidates ?? []), revisions: clone(run.revisions ?? []),
    archivedRuns: (engine.archives.get(String(sessionId)) ?? []).map(old => ({ id: old.id, playbookId: old.playbookId, state: old.state, startedAt: old.startedAt, finishedAt: old.finishedAt })),
    retention: 'Latest 20 previous runs per session, plus the current run; full raw chat/tool output not included',
    warning: 'System facts derive from this plugin event history. Artifact inspection is not speech recognition, visual comprehension or a universal task-quality score.' }
}
export function reportMarkdown(value) {
  return '# Playbook 系统执行报告 / System run report\n\n'
    + '本区由插件事件生成；不是模型自评，不代表用户已验收。\n\n'
    + '```json\n' + JSON.stringify(value, null, 2) + '\n```\n'
}
/** Conservative direct-user review cues; never read tool logs as authorization. */
export function reviewFeedback(text) {
  if (typeof text !== 'string' || text.length > 1600 || /```|~~~|^\s*>/.test(text) || /如果|假如|示例|日志里|他说|what if/i.test(text)) return null
  if (/^(?:如何|怎么|为什么|请问|帮我写|给我写|解释)/.test(text.trim())) return null
  if (/验收不通过|验收未通过|不合格.*返修|请.*(?:返修|重做)|这版.*(?:不行|不满意)|reject (?:this|the)|needs? revision|not accepted/i.test(text)) return 'reject'
  if (/^(?:好的[，,。\s]*)?(?:这版)?(?:我确认)?(?:验收通过|确认通过|通过验收|接受这版)[！!。\s]*$|^I accept this(?: version)?[.!\s]*$/i.test(text.trim())) return 'accept'
  return null
}

import { createHash } from 'node:crypto'
/** Durable revision control and reports. No model-authored counts or grades. */
const clone = value => structuredClone(value)
const at = engine => new Date(engine.clock()).toISOString()
const terminal = new Set(['completed', 'awaiting_review', 'accepted', 'failed', 'cancelled'])

/** Binding for a displayed candidate, not a permission grant or a signed token. */
export function reviewTarget(run) {
  if (run?.state !== 'awaiting_review') return null
  const candidate = run.candidates?.at(-1)
  return createHash('sha256').update(JSON.stringify([
    run.id, run.sessionId, run.revision ?? 0, run.stageEpoch ?? 0,
    run.candidates?.length ?? 0, candidate?.at ?? null,
    candidate?.artifacts?.video?.binding?.sha256 ?? null,
  ])).digest('hex')
}
export function reviewControl(run) {
  const target = reviewTarget(run)
  if (!target) return null
  return { target, needsUserReview: true, uiRequired: false,
    rejectText: '拒绝候选', acceptText: '验收通过',
    rejectCommand: '/playbook revise <返修意见，可省略>',
    acceptCommand: '/playbook accept',
    panelLocation: '设置 → 插件 → Playbook（可选，不是聊天工具卡）',
    message: '直接用户聊天“拒绝候选”或“打回当前候选”就是有效退回，不需要 UI 专用事件。'
      + '未登记时不要声称已退回，也不要建议取消/清空/新建 Run；报告实际状态和版本。'
      + '模型的 repair/recover 不能代替用户评审，也不能自行生成批准或否决。' }
}
function checkReviewTarget(run, expected) {
  if (expected === undefined) return
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || reviewTarget(run) !== expected) {
    const error = new Error('REVIEW_TARGET_CHANGED: displayed candidate is stale; refresh the current session before reviewing. No run was changed.')
    error.code = 'REVIEW_TARGET_CHANGED'
    throw error
  }
}
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
    if (!run || !['active', 'blocked', 'failed'].includes(run.state)) {
      const error = new Error('No repairable run; candidate rejection requires direct user feedback. Direct chat “拒绝候选” is supported; UI is optional. Do not cancel or clear the run.')
      error.code = run?.state === 'awaiting_review' ? 'USER_REVIEW_REQUIRED' : 'NO_REPAIRABLE_RUN'
      throw error
    }
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
export async function requestRevision(engine, sessionId, reason, { signal, messageId, expectedReviewTarget } = {}) {
  return engine.serialize(async () => {
    signal?.throwIfAborted()
    const run = engine.runs.get(String(sessionId)), book = engine.playbookForRun(run)
    // A redelivered direct-user message must not reject a later candidate or
    // consume a second revision, even after a Host restart.
    if (messageId && (run?.feedbackIds ?? []).includes(messageId)) return engine.status(sessionId)
    checkReviewTarget(run, expectedReviewTarget)
    if (!run || !book || !terminal.has(run.state) || run.state === 'cancelled') throw new Error('No completed/candidate/failed run to revise')
    const revision = (run.revision ?? 0) + 1, max = book.delivery?.maxRevisions ?? 2
    if (revision > max) throw new Error(`User revision budget ${max} reached; start a deliberate new task instead of hiding the old run`)
    const target = book.delivery?.revisionStage ?? (book.stages.find(s => s.id === 'qa')?.id ?? book.initialStage)
    const now = at(engine)
    run.previousCandidate = clone(run.candidates?.at(-1)?.artifacts ?? run.previousCandidate ?? null)
    // Keep a truthful historical snapshot before invalidating the rework chain.
    run.revisions ??= []
    run.revisions.push({ revision, requestedAt: now, previousState: run.state, reason: String(reason).slice(0, 24000),
      previousCandidate: clone(run.previousCandidate) })
    run.revision = revision
    run.feedbackIds = [...(run.feedbackIds ?? []), ...(messageId ? [messageId] : [])].slice(-64)
    const start = book.stages.find(s => s.id === 'qa')?.id ?? target
    const invalidated = invalidate(run, book, start)
    run.state = 'active'; run.blocker = null; run.finishedAt = null
    run.stageId = target; run.stageAttempt = 1; run.stageEpoch = (run.stageEpoch ?? 0) + 1
    run.observations = {}; run.formatRepairs = 0; run.updatedAt = now
    run.history.push({ type: 'human_review_rejected', at: now, revision, stageId: target,
      reason: String(reason).slice(0, 24000), invalidated, messageId: messageId ?? null })
    await engine.save(); return engine.status(sessionId)
  })
}
export async function accept(engine, sessionId, { signal, messageId, expectedReviewTarget } = {}) {
  return engine.serialize(async () => {
    signal?.throwIfAborted()
    const run = engine.runs.get(String(sessionId))
    if (messageId && (run?.feedbackIds ?? []).includes(messageId)) return engine.status(sessionId)
    checkReviewTarget(run, expectedReviewTarget)
    if (run?.state !== 'awaiting_review') throw new Error('Only an awaiting-review candidate can be accepted')
    run.feedbackIds = [...(run.feedbackIds ?? []), ...(messageId ? [messageId] : [])].slice(-64)
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
/** Direct-user intent, not a whole-message blacklist. Long reviews may contain examples. */
export function reviewFeedback(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 64000) return null
  const lines = []
  let fence = null
  for (const raw of text.split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(raw)
    if (f) { if (!fence) fence=f[1][0]; else if (fence===f[1][0]) fence=null; continue }
    if (fence || /^\s*>/.test(raw)) continue
    const line = raw.trim().replace(/^#{1,6}\s*/, '').replaceAll('**','')
    if (line) lines.push(line)
  }
  if (!lines.length) return null
  const lead=lines[0]
  if (/^(?:如果|假如|假设|示例|日志里|他说|如何|怎么|为什么|请问|帮我写|给我写|解释|分析|总结|翻译|提取|复述|请分析|帮我分析|请解释|请翻译|帮我解释|帮我翻译|(?:please )?(?:summarize|translate|analy[sz]e)|what if|example|write (?:an? )?example)/i.test(lead)) return null
  const direct = lines.filter(line => !/^(?:如果|假如|假设|示例|日志里|他说|例如|say |what if|example)/i.test(line))
  // Structured verdict must be introduced as a real review, not a quoted log/example.
  const isReview = /Human Review|人工(?:审核|验收)|最终(?:审核|验收)|终审/i.test(lines.slice(0,4).join(' '))
  if (isReview && direct.some(line => /^(?:结论|FINAL_STATUS|VERDICT|审核结论)\s*[:：]\s*(?:REVISE_ONCE|REVISE|DO_NOT_PUBLISH_YET|REJECT)\b/i.test(line))) return 'reject'
  if (isReview && direct.some((line,i) => /^FINAL_STATUS\s*[:：]\s*$/i.test(line) && /^(?:REVISE_ONCE|DO_NOT_PUBLISH_YET|REJECT)\b/.test(direct[i+1]??''))) return 'reject'
  if (/^(?:好的[，,。\s]*)?(?:这版)?(?:我确认)?(?:验收通过|确认通过|通过验收|接受这版)[！!。\s]*$|^I accept this(?: version)?[.!\s]*$/i.test(lines.join('\n'))) return 'accept'
  // Only a direct instruction near the beginning, not an example embedded later.
  const head=direct.slice(0,4).join('\n')
  const imperative = /^(?:(?:大佬|老哥)[，,：:\s]*)?(?:请|麻烦)?\s*(?:拒绝(?:(?:当前|这个|本次|这[一版份个])?候选(?:版本|成片|结果)?|这版(?:成片)?|当前(?:成片|版本))|不接受(?:(?:当前|这个|本次|这[一版份个])?候选(?:版本|成片|结果)?|这版(?:成片)?|当前(?:成片|版本))|候选(?:验收)?(?:不|未)通过)(?:[。.!！]?[ \t]*$|[，,；;：:][ \t]*(?:请|按|只|仅|保留|其余|不要|不改|修改|替换|重做|返修|自行|进入|原因|问题|因为|镜头|画面|声音|字幕|前|s\d))/i
  if (direct.slice(0,4).some(line => imperative.test(line))) return 'reject'
  if (/^(?:please )?reject (?:the |this |current )?candidate[.!\s]*$/i.test(head)) return 'reject'
  if (/^(?:(?:大佬|老哥|请|麻烦)[，,：:\s]*)?(?:打回(?:当前|这[一版份个])?(?:候选|成片|版本)|退回(?:当前|这[一版份个])?(?:候选|成片|版本)|(?:最终成片)?验收(?:不|未)通过)/m.test(head)) return 'reject'
  if (/^(?:请|麻烦)(?:按|按照|仅|只|把|将|自行|对|就|基于|修|返|重).{0,100}(?:返修|重做|修订|修正|修改)/m.test(head)) return 'reject'
  if (/^按.{0,100}(?:重做|返修|修订|修改).{0,40}(?:v\d+|收尾|这版|当前|候选)/im.test(head)) return 'reject'
  if (/^(?:这版|这个成片|当前版本).{0,40}(?:不行|不满意|不合格).{0,40}(?:返修|重做)?/m.test(head) || /^(?:please )?(?:reject (?:this|the)|needs? revision|not accepted)/im.test(head)) return 'reject'
  return null
}

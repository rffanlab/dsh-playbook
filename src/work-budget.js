/** Human-directed work cycles, with lifetime audit counters kept intact.
 * Only trusted Host user-review/continue entry points append the boundary events.
 * A model tool argument, SOP version, repair, recover, reload or status is not one.
 */
const cycleEvents = new Set(['human_review_rejected', 'human_work_continued'])
const gateEvent = event => ['gate_passed', 'gate_failed'].includes(event.type)
const repairEvent = event => event.type === 'controlled_repair'

export function workBudget(engine, run) {
  const history = run?.history ?? []
  let boundary = -1
  for (let i = history.length - 1; i >= 0; i--) if (cycleEvents.has(history[i].type)) { boundary = i; break }
  const current = history.slice(boundary + 1)
  const lifetimeSubmissions = history.filter(gateEvent).length
  const lifetimeRepairs = Math.max(run?.selfRepairs ?? 0, history.filter(repairEvent).length)
  // New boundaries pin the baseline; legacy runs derive it from retained events.
  // Unexplained old cumulative counts are counted conservatively, never erased.
  const priorRepairs = boundary < 0 ? 0 : history[boundary].automationBaseline?.selfRepairs
    ?? history.slice(0, boundary + 1).filter(repairEvent).length
  const book = engine.playbookForRun(run)
  const limit = (used, maximum) => ({ used, limit: maximum, remaining: Math.max(0, maximum - used), exhausted: used >= maximum })
  return {
    scope: 'since_last_direct_user_instruction',
    cycle: history.filter(event => cycleEvents.has(event.type)).length,
    startedBy: boundary < 0 ? 'initial_task' : history[boundary].type,
    submissions: limit(current.filter(gateEvent).length, engine.maxSubmissions),
    selfRepairs: limit(Math.max(current.filter(repairEvent).length, lifetimeRepairs - priorRepairs), book?.delivery?.maxSelfRepairs ?? 2),
    lifetime: { submissions: lifetimeSubmissions, selfRepairs: lifetimeRepairs },
    userRevisions: { used: run?.revision ?? 0, limit: null },
  }
}

export function automaticBudgetError(kind, budget) {
  const error = new Error(`Automatic ${kind} budget for this user-directed cycle is exhausted. Keep the same run and report actual progress/blockers; a direct user continuation may authorize another bounded cycle. Do not clear state, cancel/recreate the run, or waive quality checks.`)
  error.code = 'AUTOMATIC_WORK_BUDGET_EXHAUSTED'
  error.workBudget = budget
  return error
}

/** Entire durable review history, not just the short feedbackIds cache. */
export function userEventSeen(run, messageId) {
  return !!messageId && ((run?.feedbackIds ?? []).includes(messageId) || (run?.history ?? []).some(event =>
    (cycleEvents.has(event.type) || event.type === 'human_review_accepted' || event.type === 'human_revision_feedback') && event.messageId === messageId))
}

export function mayContinueWork(engine, run) {
  if (!run || !['active', 'failed'].includes(run.state)) return false
  const budget = workBudget(engine, run)
  return budget.submissions.exhausted || budget.selfRepairs.exhausted || (run.lastGate?.recovery?.exhausted === true && !run.lastGate.recovery.continuedByUser)
}

/** Deliberately narrow: direct current-user continuation, never quoted/example text. */
export function isWorkContinuation(text) {
  if (typeof text !== 'string' || text.length > 1000) return false
  return /^(?:请|麻烦)?(?:继续(?:原任务|当前任务|返修|修改|处理|执行)?|继续(?:完成|生成)\s*v\d+|continue(?: (?:the |this |current |original )?task)?)[，,。.!！\s]*$/i.test(text.trim())
}

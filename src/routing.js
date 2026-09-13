/** Deterministic, literal-only routing. Scores are ranking hints, never probabilities. */
function strings(value, label, limit = 40) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} must be an array of at most ${limit} strings`)
  return [...new Set(value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 240) throw new Error(`${label} contains an invalid string`)
    return item.trim()
  }))]
}
export function normalizeRouting(value) {
  if (value === undefined) value = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('routing must be an object')
  const allowed = ['groups', 'keywords', 'exclude', 'priority', 'autoStart', 'examples']
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unsupported routing field: ${key}`)
  if (value.groups !== undefined && (!Array.isArray(value.groups) || value.groups.length > 12)) throw new Error('routing.groups must contain at most 12 groups')
  const groups = (value.groups ?? []).map(group => {
    const out = strings(group, 'routing.groups[]')
    if (!out.length) throw new Error('routing.groups[] must not be empty')
    return out
  })
  const priority = value.priority ?? 0
  if (!Number.isInteger(priority) || priority < -50 || priority > 50) throw new Error('routing.priority must be an integer in [-50, 50]')
  if (value.autoStart !== undefined && typeof value.autoStart !== 'boolean') throw new Error('routing.autoStart must be boolean')
  return { groups, keywords: strings(value.keywords, 'routing.keywords'), exclude: strings(value.exclude, 'routing.exclude'), priority, autoStart: value.autoStart !== false, examples: strings(value.examples, 'routing.examples', 12) }
}
export function requireTask(task) {
  if (typeof task !== 'string' || !task.trim()) throw new Error('task must be a non-empty string')
  if (task.length > 24000) throw new Error('task exceeds 24000 characters; provide a concise task, not full logs')
  return task.trim()
}
/** Avoid routing on quoted code/logs or on the topic of a requested article/video. */
export function intentText(task) {
  let value = task.slice(0, 24000).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/^\s*>.*$/gm, ' ').replace(/https?:\/\/\S+/g, ' ')
  value = value.split(/[\n，,；;]/).filter(part => !/^\s*(不要|别|不用|do not\b|don't\b)/i.test(part)).join('，')
  const topic = /(?:介绍|讲解|讲述|主题是|内容是|关于|\babout\b|\bexplaining\b|\bintroducing\b)/i.exec(value)
  if (topic && /公众号|视频|文章|歌词|歌曲|\b(article|video|song|post)\b/i.test(value.slice(0, topic.index))) value = value.slice(0, topic.index)
  return value.trim().toLowerCase().slice(0, 2000)
}
function matches(text, term) {
  const needle = term.toLowerCase()
  if (/^[a-z0-9][a-z0-9 -]*$/.test(needle)) {
    const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z0-9_])${safe}(?:$|[^a-z0-9_])`, 'i').test(text)
  }
  return text.includes(needle)
}
export function isConversation(text) {
  if (/(?:帮我|给我|麻烦你|请你).{0,20}(?:写|制作|生成|开发|实现|部署|修复)/.test(text) || /^(?:写|制作|生成|开发|实现|部署|修复)/.test(text)) return false
  if (!text || /^(你好|您好|谢谢|多谢|辛苦了|很好|好的|好|收到|ok|okay|thanks|thank you|hello|hi|great)[!！。.,，\s]*$/i.test(text)) return true
  if (/^(?:请问|解释一下|解释|什么是|怎么|如何|为什么|what (?:is|are)|how (?:do|does|to)|why\b)/i.test(text)) return true
  return /(?:是什么|什么意思|怎么用|如何使用|什么区别|能做什么)[?？。\s]*$/i.test(text)
}
function looksLikeWork(text) {
  return /帮我|请|麻烦|帮忙|修|排查|恢复|部署|安装|开发|新增|实现|制作|生成|创作|整理|写|审|检查|分析|统计|复盘|调研|补全|完善|发布|发行|准备|启动不了|宕机|故障|\b(fix|debug|build|implement|create|write|produce|generate|review|audit|check|analy[sz]e|research|deploy|install|configure|prepare|release|restore|migrate|design|serve|add)\b/i.test(text)
}
export function recommendPlaybook(task, catalog) {
  const original = requireTask(task), text = intentText(original)
  if (isConversation(text)) return { kind: 'conversation', confidence: 'none', recommendedId: null, candidates: [], reason: '普通问答/闲聊，不自动启动 SOP。' }
  const candidates = []
  for (const entry of catalog) {
    const r = normalizeRouting(entry.routing)
    if (r.exclude.some(term => matches(text, term))) continue
    const hits = r.groups.map(group => group.filter(term => matches(text, term)))
    const complete = hits.length > 0 && hits.every(group => group.length > 0)
    const keywords = r.keywords.filter(term => matches(text, term))
    const count = hits.filter(group => group.length > 0).length
    if (!count && !keywords.length) continue
    const score = (complete ? 100 : count * 10) + r.priority + Math.min(keywords.length, 5)
    candidates.push({ id: entry.id, name: entry.name, description: entry.description, score, complete, autoStart: r.autoStart,
      matched: [...new Set([...hits.flat(), ...keywords])], examples: r.examples })
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const top = candidates[0], second = candidates[1]
  const compound = /然后|同时|并且|以及|并(?:写|做|生成|发布)|\band (?:then |also )?(?:write|create|deploy|publish|produce)\b/i.test(text)
  const confident = !!top?.complete && top.autoStart && looksLikeWork(text)
    && (!second?.complete || top.score - second.score >= 10)
    && !(compound && second?.complete)
  return { kind: confident ? 'match' : candidates.length ? 'ambiguous' : looksLikeWork(text) ? 'unmatched' : 'conversation',
    confidence: confident ? 'high' : candidates.length ? 'low' : 'none',
    recommendedId: confident ? top.id : null, candidates: candidates.slice(0, 5),
    reason: confident ? `按交付意图匹配：${top.matched.join(' / ')}` : '规则不足以唯一确定流程；由 Agent 根据用户目标选择，缺关键信息时才追问。' }
}

/** Session-local selection context; accepted selections are durable in run.input.routing. */
export class PlaybookRouter {
  constructor(engine, { enabled = true } = {}) {
    this.engine = engine
    this.enabled = enabled
    this.sessions = new Map()
    this.queue = Promise.resolve()
  }
  session(id) {
    const key = String(id)
    if (!this.sessions.has(key)) this.sessions.set(key, { enabled: this.enabled, pendingTask: '', lastDecision: null })
    return this.sessions.get(key)
  }
  setAuto(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean')
    const state = this.session(id)
    state.enabled = enabled
    if (!enabled) state.pendingTask = ''
    return { enabled, scope: 'current session until host restart', activeRunUnaffected: true }
  }
  recommend(task) { return recommendPlaybook(task, this.engine.listPlaybooks()) }
  remember(id, task) {
    const state = this.session(id)
    const incoming = requireTask(task)
    const combined = state.pendingTask && state.pendingTask !== incoming ? `${state.pendingTask}\n用户补充 / Clarification: ${incoming}` : incoming
    state.pendingTask = combined.length <= 24000 ? combined : `${combined.slice(0, 12000)}\n[中间内容省略，见原对话]\n${combined.slice(-10000)}`
    state.lastDecision = this.recommend(state.pendingTask)
    if (state.lastDecision.kind === 'conversation') state.pendingTask = ''
    return state.lastDecision
  }
  view(id) {
    const state = this.session(id)
    return { enabled: state.enabled, pending: !!state.pendingTask && !this.engine.attachedRun(id), lastDecision: structuredClone(state.lastDecision) }
  }
  clear(id) { this.session(id).pendingTask = '' }
  async route(id, { task, playbookId, note = '', origin = 'agent', signal } = {}) {
    const work = async () => {
      signal?.throwIfAborted()
      if (this.engine.attachedRun(id)) return { ok: true, reused: true, status: this.engine.status(id), message: '当前 SOP 尚未结束（可能处于阻塞状态）；不会自动替换或取消。新任务请另开会话或由用户明确取消当前流程。' }
      const state = this.session(id)
      if (origin === 'agent' && this.engine.status(id).run && !state.pendingTask) throw new Error('Previous run is terminal. A fresh user task or /playbook start is required; do not restart to reset budgets.')
      const actual = requireTask(state.pendingTask || task)
      const decision = this.recommend(actual)
      const selected = playbookId || decision.recommendedId
      if (!selected) return { ok: true, needsSelection: true, decision, fallbackId: 'task-intake',
        message: '请 Agent 根据实际目标选择 SOP，再用 action=route、playbook_id、note 调用。只在交付物/范围不明确时向用户追问，不要求用户挑 SOP 名称。' }
      if (!this.engine.getPlaybook(selected)) throw new Error(`unknown playbook: ${selected}`)
      if (playbookId && playbookId !== decision.recommendedId && (typeof note !== 'string' || note.trim().length < 8)) throw new Error('semantic selection requires note explaining the fit (at least 8 characters)')
      signal?.throwIfAborted()
      const status = await this.engine.start(String(id), selected, { task: actual, routing: {
        method: playbookId ? 'agent-selected' : origin === 'auto' ? 'auto-rule' : 'rule',
        reason: note || decision.reason, confidence: decision.confidence,
      } }, { signal })
      state.pendingTask = ''
      state.lastDecision = { ...decision, selectedId: selected }
      return { ok: true, started: true, decision: state.lastDecision, status,
        message: `已采用 ${selected} SOP。先用一句话告知用户所选流程，然后按当前阶段执行；每阶段提交 evidence，不重复询问用户是否选它。` }
    }
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }
  guard(id, toolName) {
    if (!this.view(id).pending || this.engine.attachedRun(id)) return undefined
    // run_code is a transport; nested native calls re-enter this same guard.
    if (['playbook', 'run_code', 'ask_user_question', 'AskUserQuestion'].includes(toolName)) return undefined
    return '请先调用 playbook(action="route") 自动选择 SOP；流程未确定前不执行工作工具。仅缺关键需求时询问用户。'
  }
}

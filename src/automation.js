/** Public DSH pre-step adapter. SDK message construction is supplied by the Host entry. */
export function installAutoRouting(ctx, engine, router, { ready = async () => {}, createMessage, onError = console.error } = {}) {
  if (typeof createMessage !== 'function') throw new Error('createMessage is required')
  const seenByAgent = new WeakMap()
  const notice = text => createMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-playbook' } })
  ctx.on('agent/pre-step', async (payload, next) => {
    const downstream = await next()
    // Never resurrect a downstream rejection or an intentionally emptied batch.
    if (downstream.kind !== 'enter' || !downstream.messages.length) return downstream
    const { agent, signal } = payload
    if (!agent?.id || agent.session?.header?.parentSession) return downstream
    const id = String(agent.id)
    if (!router.view(id).enabled) return downstream
    const admitted = new Set(downstream.messages.map(message => message.id))
    const users = (payload.messages ?? []).filter(message => message.source?.kind === 'user' && admitted.has(message.id))
    if (!users.length) return downstream
    let seen = seenByAgent.get(agent)
    if (!seen) { seen = new Set(); seenByAgent.set(agent, seen) }
    const fresh = users.filter(message => !seen.has(message.id ?? message))
    if (!fresh.length) return downstream
    const raw = fresh.flatMap(message => (message.content ?? []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text)).join('\n').trim()
    if (!raw || raw.startsWith('/')) return downstream
    signal?.throwIfAborted()
    try {
      await ready()
      signal?.throwIfAborted()
      // Clarification and additional requirements belong to the current run.
      if (engine.activeRun(id)) return downstream
      for (const message of fresh) seen.add(message.id ?? message)
      while (seen.size > 64) seen.delete(seen.values().next().value)
      const oversized = raw.length > 24000
      const task = oversized ? `${raw.slice(0, 6000)}\n[路由摘要截断；完整任务仍在原用户消息中]\n${raw.slice(-6000)}` : raw
      if (router.recommend(task).kind === 'conversation' && !router.view(id).pending) return downstream
      const decision = router.remember(id, task)
      if (decision.kind === 'conversation') return downstream
      let instruction
      if (decision.kind === 'match' && raw.length <= 4000) {
        const routed = await router.route(id, { task, origin: 'auto', signal })
        instruction = `${routed.message}\n${routed.status?.instruction ?? ''}`
      } else {
        const summaries = engine.listPlaybooks().map(p => `${p.id}: ${p.description}`).join('\n')
        instruction = 'SOP 接单：用户只需给任务，不必记命令。请根据交付意图判断适用流程，先调用 playbook(action="route", playbook_id=选中的ID, note=选择理由)。\n'
          + '可先用 action=recommend 查询候选，或 action=inspect 阅读完整流程。不要让用户在内部 SOP 名称中选择。\n'
          + '只有缺少会改变执行结果的目标/输入/范围时才追问；不要复问已有信息。无专用流程时明确说明并选择 task-intake。复合任务先界定先后顺序，不声称已并行跑完多个 SOP。\n'
          + `规则候选（不是命令，也不是概率）：${JSON.stringify(decision.candidates)}\n可用目录：\n${summaries}`
      }
      return { ...downstream, messages: [...downstream.messages, notice(instruction)] }
    } catch (error) {
      if (signal?.aborted) throw error
      onError(`[dsh-playbook] automatic routing unavailable: ${error?.message ?? error}`)
      return { ...downstream, messages: [...downstream.messages, notice(`自动 SOP 未启动：${error?.message ?? error}。不得声称流程正在执行；先告知用户这个限制。`)] }
    }
  })
  ctx.tools.guard(exec => exec.agent?.id ? router.guard(String(exec.agent.id), exec.name) : undefined)
}

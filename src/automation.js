import { isVideoTask, mentionsSource } from './intake-policy.js'
import { reviewFeedback } from './run-control.js'
/** Public DSH pre-step adapter. SDK message construction is supplied by the Host entry. */
export function installAutoRouting(ctx, engine, router, { ready = async () => {}, createMessage, onError = console.error, allowsControl = () => false } = {}) {
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
      for (const message of fresh) seen.add(message.id ?? message)
      while (seen.size > 64) seen.delete(seen.values().next().value)
      engine.noteCaller?.({ agent })
      const existing = engine.status(id), feedback = reviewFeedback(raw)
      if (!existing.runtimeRecovery && existing.run && feedback === 'reject' && ['completed', 'awaiting_review', 'accepted', 'failed'].includes(existing.run.state)) {
        const status = await engine.requestRevision(id, raw, { signal, messageId: String(fresh.at(-1).id) })
        return { ...downstream, messages: [...downstream.messages, notice(`原交付被否决：已进入同一 run 的 revision ${status.run.revision}，不得新开审核流程丢失原任务。\n${status.instruction}`)] }
      }
      if (existing.run?.state === 'awaiting_review' && feedback === 'accept') {
        await engine.accept(id, { signal, messageId: String(fresh.at(-1).id) })
        return { ...downstream, messages: [...downstream.messages, notice('用户明确验收通过，已记录 accepted；不是模型自评。')] }
      }
      // A failed run still owns this task. Do not turn a continuation into an
      // intake whose guard then blocks the run's own read-only recovery probe.
      if (existing.runtimeRecovery || existing.run?.state === 'failed') {
        const action = existing.runtimeRecovery ? 'recover' : 'repair'
        const instruction = existing.runtimeRecovery
          ? existing.runtimeRecovery.message
          : '先查看失败证据，再通过 repair 指定原流程中的恢复阶段和具体诊断；保留原预算，不自动新开任务。'
        return { ...downstream, messages: [...downstream.messages, notice(
          `当前任务仍归属 run ${existing.run.id}，不是一次新接单。\n${instruction}\n`
          + `先调用 playbook(action="${action}") 的原任务恢复入口（repair 需 stage_id、note）。`
          + '不要要求用户再次授权 SOP 外制作、清空状态或修改宿主来解决插件内部故障。'
          + '若真实宿主权限仍拒绝，报告具体 callId、错误码与原因；不得绕过或把技术检查失败说成权限不足。'
        )] }
      }
      // Clarification and additional requirements belong to the current run.
      if (engine.attachedRun(id)) return downstream
      const oversized = raw.length > 24000
      const task = oversized ? `${raw.slice(0, 6000)}\n[路由摘要截断；完整任务仍在原用户消息中]\n${raw.slice(-6000)}` : raw
      if (router.recommend(task).kind === 'conversation' && !router.view(id).pending) return downstream
      const decision = router.remember(id, task)
      if (decision.kind === 'conversation') return downstream
      let instruction
      const documentAttached = fresh.some(m => (m.content ?? []).some(b => !['text','image','audio','video'].includes(b.type)))
      const requiresIntake = isVideoTask(raw) || mentionsSource(raw) || documentAttached
      router.projects?.capture(id, task, { attachment: documentAttached })
      if (decision.kind === 'match' && raw.length <= 4000 && !requiresIntake) {
        const routed = await router.route(id, { task, origin: 'auto', signal, exec: { agent, signal } })
        instruction = `${routed.message}\n${routed.status?.instruction ?? ''}`
      } else {
        const summaries = engine.listPlaybooks().map(p => `${p.id}: ${p.description}`).join('\n')
        instruction = 'SOP 接单（先读后选）：视频/任务书请求不可仅凭平台关键词直接启动。允许 read/grep/glob 等只读发现；先读完整任务文档，调用 intake（project_id、requirements、source_call_ids），项目 ID 由你根据真实项目决定，不要求用户记。\n当前任务的主题、输出路径属于 input，不要每期创建新 SOP。用 sop_list/sop_inspect 优先查该项目已确认方法；不适配时 sop_validate/sop_save 起草试用定义，不能削弱已确认规则或替换在途流程。\n道家文化内容即使发布到 B 站仍按文化项目处理。没有任务文档时以用户原始任务登记；提到但拿不到文档时先索取，不伪造读取。\n用户只需给任务，不必记命令。请根据交付意图判断适用流程，先调用 playbook(action="route", playbook_id=选中的ID, note=选择理由)。\n'
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
  // Only plugin-owned, exact registered control calls are exempt from intake.
  // Other plugin guards and the Host's permissions still run normally.
  ctx.tools.guard(exec => allowsControl(exec) ? undefined : exec.agent?.id ? router.guard(String(exec.agent.id), exec.name) : undefined)
}

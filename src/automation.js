import { mayContinueWork, isWorkContinuation } from './work-budget.js'
import { analyzeTask, recommendationFits } from './task-scope.js'
import { mentionsSource } from './intake-policy.js'
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
    let reviewOperation = null
    // Remember only successful processing. A failed durable write must be
    // retryable with the same admitted user event rather than silently ignored.
    const finish = output => {
      for (const message of fresh) seen.add(message.id ?? message)
      while (seen.size > 64) seen.delete(seen.values().next().value)
      return output
    }
    try {
      await ready()
      signal?.throwIfAborted()
      engine.noteCaller?.({ agent })
      const existing = engine.status(id), feedback = reviewFeedback(raw)
      if (!existing.runtimeRecovery && existing.run && feedback === 'reject' && ['completed', 'awaiting_review', 'accepted', 'failed'].includes(existing.run.state)) {
        reviewOperation = 'reject'
        const status = await engine.requestRevision(id, raw, { signal,
          messageId: fresh.at(-1).id == null ? undefined : String(fresh.at(-1).id),
          expectedReviewTarget: existing.reviewControl?.target })
        const summary = status.active
          ? `原交付被否决：已进入同一 run 的 revision ${status.run.revision}；聊天退回已登记，不再索要 UI 点击或额外授权。`
          : '该用户评审消息已处理；不重复否决后续候选，当前状态保持不变。'
        return finish({ ...downstream, messages: [...downstream.messages, notice(`${summary}\nrun=${status.run.id}; state=${status.run.state}; stage=${status.run.stageId}\n不得取消/清空/新开任务；仅按本次反馈修正，保留未要求修改的内容。\n${status.instruction}`)] })
      }
      if (existing.run?.state === 'awaiting_review' && feedback === 'accept') {
        reviewOperation = 'accept'
        const status = await engine.accept(id, { signal,
          messageId: fresh.at(-1).id == null ? undefined : String(fresh.at(-1).id),
          expectedReviewTarget: existing.reviewControl?.target })
        return finish({ ...downstream, messages: [...downstream.messages, notice(`用户明确验收通过，已记录 accepted；不是模型自评。run=${status.run.id}`)] })
      }
      // Explicit human continuation can renew an exhausted automatic allowance,
      // without rejecting an awaiting candidate or turning it into a new Run.
      if (mayContinueWork(engine, engine.runs.get(id)) && isWorkContinuation(raw)) {
        reviewOperation = 'continue'
        const status = await engine.continueWork(id, { signal,
          messageId: fresh.at(-1).id == null ? undefined : String(fresh.at(-1).id),
          expectedRunId: existing.run.id, expectedEpoch: existing.run.stageEpoch })
        return finish({ ...downstream, messages: [...downstream.messages, notice(
          (status.workBudget.cycle > existing.workBudget.cycle
            ? `已登记用户继续原任务：同一 run ${status.run.id}，当前阶段 ${status.run.stageId}。本轮自动执行额度可继续；历史失败、累计消耗及全部质量检查保留，不取消/新建任务，不再次索要授权。`
            : '该用户续做消息已经处理，未再次增加自动额度；保留当前实际状态。') + `\n${status.instruction}`)] })
      }
      // 'auto off' disables NEW task routing, not an explicit human decision
      // about a candidate which was already submitted for review.
      if (!router.view(id).enabled) return finish(downstream)
      // A failed run still owns this task. Do not turn a continuation into an
      // intake whose guard then blocks the run's own read-only recovery probe.
      if (existing.runtimeRecovery || existing.run?.state === 'failed') {
        const action = existing.runtimeRecovery ? 'recover' : 'repair'
        const instruction = existing.runtimeRecovery
          ? existing.runtimeRecovery.message
          : '先查看失败证据，再通过 repair 指定原流程中的恢复阶段和具体诊断；保留原预算，不自动新开任务。'
        return finish({ ...downstream, messages: [...downstream.messages, notice(
          `当前任务仍归属 run ${existing.run.id}，不是一次新接单。\n${instruction}\n`
          + `先调用 playbook(action="${action}") 的原任务恢复入口（repair 需 stage_id、note）。`
          + '不要要求用户再次授权 SOP 外制作、清空状态或修改宿主来解决插件内部故障。'
          + '若真实宿主权限仍拒绝，报告具体 callId、错误码与原因；不得绕过或把技术检查失败说成权限不足。'
        )] })
      }
      // Clarification and additional requirements belong to the current run.
      if (engine.attachedRun(id)) return finish(downstream)
      const oversized = raw.length > 24000
      const task = oversized ? `${raw.slice(0, 6000)}\n[路由摘要截断；完整任务仍在原用户消息中]\n${raw.slice(-6000)}` : raw
      if (router.recommend(task).kind === 'conversation' && !router.view(id).pending) return finish(downstream)
      const decision = router.remember(id, task)
      if (decision.kind === 'conversation') return finish(downstream)
      let instruction
      const documentAttached = fresh.some(m => (m.content ?? []).some(b => !['text','image','audio','video'].includes(b.type)))
      const taskScope = analyzeTask(task)
      const requiresIntake = taskScope.producesVideo || mentionsSource(raw) || documentAttached
      router.projects?.capture(id, task, { attachment: documentAttached })
      if (decision.kind === 'match' && raw.length <= 4000 && !requiresIntake) {
        const routed = await router.route(id, { task, origin: 'auto', signal, exec: { agent, signal } })
        instruction = `${routed.message}\n${routed.status?.instruction ?? ''}`
      } else {
        const summaries = engine.listPlaybooks().filter(p => recommendationFits(taskScope,p.id)).map(p => `${p.id}: ${p.description}`).join('\n')
        instruction = 'SOP 接单：先确认本次要交付什么，再选择匹配流程。项目名称、工具支持格式、接口示例不定义本次交付物。\n'
          + `本次交付物判断（提示，不是用户新要求）：${JSON.stringify(taskScope)}\n`
          + '允许 read/grep/glob 等只读发现。引用了任务文件时读完整后 intake；完整粘贴文本就是任务输入，不要求再创建文件供读取。\n'
          + '工具接入/配置/代码改动使用工程流程；文稿、图片、音频、视频审核不是出片任务。不要为这些任务启动口播、样片或 MP4 验收，也不要让用户换项目名来绕过误分类。\n'
          + '需要项目方法时调用 intake（project_id、requirements、source_paths），再 sop_list/sop_inspect 查适用版本；同一项目可有不同种类的工作。已确认方法只在其适用任务内复用，不覆盖本次用户目标。\n'
          + (taskScope.producesVideo ? '本次确实要求视频成片：先读后选，保留独立 Run 归属与真实媒体验收。文化方法与发布平台分开；不把已有文稿当作必须重写的步骤。\n' : '')
          + '明确匹配可直接 route；不确定时 inspect/recommend 后按交付物选择，缺少影响结果的目标/输入才追问。不要让用户选择内部 SOP 名称。无专用流程使用 task-intake，不冒充领域专家。复合任务说明当前流程覆盖范围，不能声称一条流程覆盖所有交付物。\n'
          + `规则候选（不是命令或概率）：${JSON.stringify(decision.candidates)}\n当前适用目录：\n${summaries}`
      }
      return finish({ ...downstream, messages: [...downstream.messages, notice(instruction)] })
    } catch (error) {
      if (signal?.aborted) throw error
      if (reviewOperation) {
        onError(`[dsh-playbook] ${reviewOperation} not registered: ${error?.message ?? error}`)
        const state = engine.status(id)
        return { ...downstream, messages: [...downstream.messages, notice(
          `用户评审未登记成功：${error?.message ?? error}。run=${state.run?.id ?? 'none'}; state=${state.run?.state ?? 'none'}; revision=${state.run?.revision ?? 0}。`
          + '这是评审状态写入或目标冲突，不是用户没有授权。不得改称 UI 专用动作或建议清空/取消/新建。保留当前任务并报告实际错误。'
        )] }
      }
      onError(`[dsh-playbook] automatic routing unavailable: ${error?.message ?? error}`)
      return { ...downstream, messages: [...downstream.messages, notice(`自动 SOP 未启动：${error?.message ?? error}。不得声称流程正在执行；先告知用户这个限制。`)] }
    }
  })
  // Only plugin-owned, exact registered control calls are exempt from intake.
  // Other plugin guards and the Host's permissions still run normally.
  ctx.tools.guard(exec => allowsControl(exec) ? undefined : exec.agent?.id ? router.guard(String(exec.agent.id), exec.name) : undefined)
}

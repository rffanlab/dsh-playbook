import { createHash } from 'node:crypto'
import { analyzeTask } from './task-scope.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const continuation = text => /^(?:请)?(?:继续(?:原来(?:的)?|当前|这个|之前(?:的)?)?(?:任务|工作|执行|处理)?|接着(?:做|执行)|continue(?: (?:the |this |current )?(?:task|work))?|resume)[。！!\s]*$/i.test(text.trim())
const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
const json = value => JSON.parse(JSON.stringify(value))

/** Per-intake control, never an active-run quality/permission override.
 * Native ask_user_question results are the ONLY tool results treated as a user
 * clarification. Model notes, tool output prose and suggested option descriptions
 * cannot rewrite the captured request. No private Agent API is used.
 */
export function createIntakeProgress(engine, router, { createMessage } = {}) {
  const questions = new Map(), incidents = new Map()
  function pending(id) { return !engine.status(id).run && !!router.session(id).pendingTask }
  function onHumanInput(id) { incidents.delete(String(id)) }
  function observeCall(exec) {
    const id = String(exec.agent?.id ?? '')
    if (exec.name !== 'ask_user_question' || !id || !exec.token || !pending(id)) return
    const qs = exec.arguments?.questions
    if (!Array.isArray(qs) || qs.length > 16 || !qs.every(q => q && typeof q.id === 'string' && typeof q.question === 'string')) return
    questions.set(exec.token, { id, agent:exec.agent, callId:exec.callId,
      taskDigest:digest(router.session(id).pendingTask), questions:structuredClone(qs) })
  }
  function observeResult(exec, result) {
    const entry = questions.get(exec.token)
    questions.delete(exec.token)
    if (!entry || exec.name !== 'ask_user_question' || entry.agent !== exec.agent || entry.callId !== exec.callId ||
        result?.isError !== false || exec.signal?.aborted || !pending(entry.id) ||
        digest(router.session(entry.id).pendingTask) !== entry.taskDigest) return false
    const answers = result.value?.answers
    if (!Array.isArray(answers) || !answers.length || answers.length > entry.questions.length) return false
    const used = new Set(), texts = []
    for (const answer of answers) {
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false
      const q = entry.questions.find(q => q.id === answer.id)
      if (!q || used.has(q.id) || !Array.isArray(answer.selected) || answer.selected.some(label => typeof label !== 'string' || !Array.isArray(q.options) || !q.options.some(o => o && o.label === label)) ||
          (answer.custom !== undefined && typeof answer.custom !== 'string')) return false
      used.add(q.id)
      // Only an actual deliverable clarification updates method selection. Voice
      // preferences, yes/no approvals and unselected option descriptions don't.
      if (!/交付|产物|成片|类型|要做什么|deliverable|output|produce|audio|video|document/i.test(q.question+' '+(q.header??''))) continue
      const text = (answer.custom?.trim() || answer.selected.join('；')).trim()
      if (!text || text.length > 4000) continue
      let effective = text
      if (['unknown','information'].includes(analyzeTask(text).kind)) {
        // Explicit noun-only option labels are outputs, not arbitrary question prose.
        if (!/^(?:视频|完整(?:的)?(?:视频|成片)|成片|短视频|mp4\b|音频|配音|口播稿|文案|字幕|图片|封面|video\b|audio\b|document\b|image\b)/i.test(text)) continue
        effective = '制作'+text
      }
      if (['unknown','information'].includes(analyzeTask(effective).kind)) continue
      texts.push(effective)
    }
    if (!texts.length) return false
    const text = texts.join('；'), original = router.session(entry.id).pendingTask
    if (original.length + text.length + 40 > 24000) return false // Never truncate the original contract to fit an answer.
    router.clarify(entry.id, text)
    router.projects?.clarify(entry.id, {source:'host-ask-user-result',callId:String(exec.callId),text})
    onHumanInput(entry.id)
    if (createMessage && typeof exec.agent.inject === 'function') {
      // The authoritative tool result stays immutable; this logged context is
      // consumed at the next step of the already-running Agent. It does not wake a new turn.
      try { exec.agent.inject(createMessage({source:{kind:'plugin',plugin:'dsh-playbook'},content:[{type:'text',text:'真实用户澄清已接回启动前选流：'+JSON.stringify(analyzeTask(router.session(entry.id).pendingTask))+'. 保留原任务约束，按适用方法继续，不必重复确认交付物。'}]})) }
      catch (error) { console.warn('[dsh-playbook] clarification context unavailable: '+(error?.message ?? error)) }
    }
    return true
  }
  function restoreForContinuation(agent, text) {
    const id=String(agent?.id ?? '')
    if (!id || !continuation(text) || engine.status(id).run || router.session(id).pendingTask || typeof agent.session?.snapshotEvents !== 'function') return false
    const events=agent.session.snapshotEvents().slice(-10000)
    const original=events.filter(e=>e.type==='user/message' && e.data?.source?.kind==='user')
      .map(e=>({text:textOf(e.data),seq:e.seq})).filter(row=>row.text && row.text.length<=24000 && !row.text.startsWith('/') && !continuation(row.text)).at(-1)
    if (!original) return false
    router.remember(id,original.text)
    router.projects?.capture(id,original.text)
    return true
  }
  function rejection(exec, output) {
    const id=String(exec.agent?.id ?? '')
    if (!id || !pending(id) || output?.error?.code!=='SOP_TASK_MISMATCH') return output
    const key=digest(router.session(id).pendingTask+'\n'+output.error.code)
    let row=incidents.get(id)
    if (!row || row.key!==key) row={key,failures:0,firstCallId:String(exec.callId),lastCallId:null}
    row.failures++;row.lastCallId=String(exec.callId);row.taskScope=output.taskScope
    incidents.set(id,row)
    if (row.failures<3) {
      return {...output,intakeProgress:{failures:row.failures,limit:3},
        message:output.message+' Do not repeatedly submit the same mismatch. Use the captured request and any actual user answer; correct selection once. No Run exists yet, so editing files or cancelling a Run cannot repair classification.'}
    }
    // This is a successfully returned diagnostic tool result, not a failed Gate.
    // Native terminal marker stops repeated tool-use without creating/resetting a
    // run, cancelling user input, or widening any tool/sandbox permission.
    const nativeStop=typeof exec.concludeTurn==='function'
    const result={...output,nextAction:'report_intake_stall',intakeProgress:{...row,limit:3,nativeTurnStop:nativeStop},
      message:'SOP 启动前选流发生重复冲突，'+(nativeStop?'本次自动空转已停止':'应停止本次空转，但宿主未提供强制停轮接口')+'；尚未创建 Run，也未开始制作。原任务和用户澄清保留。不要再重复 route/搜索插件、清状态、取消或降低验收。需要修正的是选流判断，不是补用户授权。'}
    if (nativeStop) exec.concludeTurn()
    else if (typeof exec.deferContext==='function' && createMessage) exec.deferContext(createMessage({source:{kind:'plugin',plugin:'dsh-playbook'},content:[{type:'text',text:result.message+' 宿主未提供 concludeTurn；请如实报告此错误并结束本轮，不再调用工具。'}]}))
    return result
  }
  function view(id) { const r=incidents.get(String(id));return r ? json(r) : null }
  return {observeCall,observeResult,restoreForContinuation,onHumanInput,rejection,view,clear:()=>{questions.clear();incidents.clear()}}
}

export function guardIntakeLoops(definition, engine, progress) {
  if (!progress) return definition
  return {...definition,async execute(args,exec) {
    const out=await definition.execute(args,exec)
    const result=progress.rejection(exec,out)
    if (['status','intake_status'].includes(args.action)) return json({...result,intakeProgress:progress.view(String(exec.agent?.id))})
    return json(result)
  }}
}

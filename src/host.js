import { createRevisionDispatcher } from './revision-dispatch.js'
import { createRuntimeRecovery } from './runtime-recovery.js'
import { ProjectLibrary } from './project-library.js'
import { createReportExporter, isReportWrite } from './report-export.js'
import { createMediaRunner } from './host-media.js'
import { reportMarkdown } from './run-control.js'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { BUILTIN_PLAYBOOKS } from './builtins.js'
import { loadPlaybooksFromDirectory } from './catalog.js'
import { DeliveryEngine as PlaybookEngine } from './delivery-engine.js'
import { createArtifactDelivery } from './artifact-delivery.js'
import { usableController, PLUGIN_VERSION } from './controller-ux.js'
import { createMediaDiagnostics } from './media-diagnostics.js'
import { createIsolationManager } from './host-isolation.js'
import { PlaybookRouter } from './routing.js'
import { installAutoRouting } from './automation.js'
import { playbookDefinition, conciseStatus } from './tool.js'
import { readState, writeState } from './state.js'
import { toolReceipt } from './receipts.js'
import { stageContext } from './context.js'

export const name = 'dsh-playbook'
export const inject = ['tools', 'systemPrompt']
export const PLAYBOOK_TOOL_NAME = 'playbook'
export function pathsFromEnvironment() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return { directory: resolve(process.env.DSH_PLAYBOOK_DIR || join(home, 'playbooks')),
    state: resolve(process.env.DSH_PLAYBOOK_STATE || join(home, 'playbook-state.json')) }
}
export function install(ctx, { define, message, paths = pathsFromEnvironment() }) {
  const engine = new PlaybookEngine({ persist: snapshot => writeState(paths.state, snapshot) })
  const router = new PlaybookRouter(engine, { enabled: !/^(0|false|off)$/i.test(process.env.DSH_PLAYBOOK_AUTO_ROUTE ?? '') })
  const projects = new ProjectLibrary(engine, router); router.projects = projects
  for (const playbook of BUILTIN_PLAYBOOKS) engine.register(playbook, { source: 'builtin' })
  const reloadCatalog = async () => {
    const loaded = await loadPlaybooksFromDirectory(paths.directory)
    const reserved = new Set(BUILTIN_PLAYBOOKS.map(p => p.id))
    const users = loaded.filter(row => {
      if (!reserved.has(row.playbook.id)) return true
      console.error(`[dsh-playbook] legacy override ${row.playbook.id} ignored: built-ins are reserved; import as a project SOP proposal`)
      return false
    })
    return engine.replaceCatalog([...BUILTIN_PLAYBOOKS.map(playbook => ({ playbook, source: 'builtin' })), ...users])
  }
  let startupError
  const initialized = (async () => {
    // All mutations and automatic starts wait for persisted state hydration.
    try { engine.hydrate(await readState(paths.state)) }
    catch (error) { startupError = error; console.error(`[dsh-playbook] state load failed: ${error?.message ?? error}`); return }
    try { await reloadCatalog() }
    catch (error) { console.error(`[dsh-playbook] custom catalog rejected; retaining built-ins and pinned runs: ${error?.message ?? error}`) }
  })()
  const ready = async () => { await initialized; if (startupError) throw new Error(`playbook state unavailable: ${startupError.message}`) }
  const revisionDispatcher = createRevisionDispatcher(ctx,engine,message)
  const pendingWrites = new Map()
  const isolation = createIsolationManager(ctx, engine)
  const diagnostics = createMediaDiagnostics(ctx, engine)
  const delivery = createArtifactDelivery(ctx, engine, ready)
  ctx.tools.guard(delivery.guard)
  ctx.tools.guard(isolation.guard)
  const recovery = createRuntimeRecovery(ctx, engine, ready)
  const allowsControl = exec => delivery.allows(exec) || isReportWrite(exec, pendingWrites) || isolation.isPreparation(exec) || diagnostics.allows(exec) || recovery.allows(exec)
  ctx.tools.register(define(usableController(delivery.wrap(recovery.wrap(isolation.wrap(playbookDefinition(engine, reloadCatalog, router, ready, createMediaRunner(ctx, engine), createReportExporter(ctx, engine, pendingWrites), projects)))), engine, diagnostics)))
  const basePolicy = [
    'Playbook execution policy:',
    '- For a NEW actionable task with automatic routing enabled, select a SOP before work: call playbook action=route. Ordinary explanations/chat need no SOP.',
    '- Simple tasks may auto-start when the selected method fits the requested output. Read external task sources before execution; actual video production or project-specific methods use intake. Pasted API contracts are task input, not a request to execute every example.',
    '- During intake, read/glob/grep and registered read-only discovery are allowed. Never run shell or edit project files before selecting the method.',
    '- sop_save creates project-scoped immutable trials. Protected changes remain draft until a human approves the exact revision. Never delete checks, change project identity or choose a weaker base to pass a gate.',
    '- Select by this task deliverable, not project name, API examples or supported input formats. Media-tool integration, code, documentation, audio/images and video review are not video production. A project may use multiple method families.',
    '- Reuse an approved project SOP only when applicable to this task; preserve project identity instead of asking for a rename to fix classification. Active snapshots remain authoritative for the task already started.',
    '- Supplied scripts/methods take precedence over template creative suggestions, within Host policy. Resolve real conflicts through a reviewed version, not silent changes.',
    '- For uncertain matches inspect/recommend, then select playbook_id with a reason. Ask only missing task requirements, not which internal SOP name the user wants.',
    '- Keep an active run on user clarifications. Do not automatically replace, cancel or restart it; cancelled/failed runs are not successful completion.',
    '- Obey the current stage. Submit stage_id and complete evidence through action=submit; only the engine advances stages.',
    '- Direct user revisions are not limited by a two-attempt cap. Each actual user revision/continuation grants one bounded work cycle; keep lifetime totals and the same run. Do not ask for another approval when a clear user instruction already grants it.',
    '- Correct failed gates within the budget. Do not cancel to bypass a gate, invent evidence, or turn missing capabilities into fabricated results.',
    '- Prefer actual work then one submit; check is an optional format-only preflight, not a mandatory extra form. The narrow {item:[...]} mistake is corrected transparently. Never pad evidence with fake observations.',
    '- Plugin path/legacy incidents: automatically use recover/workspace/repair and keep the same run. Never request clearing state, cancellation, a new conversation or weaker validators as the default workaround. Intake source_paths resolves real observed reads; do not invent call IDs.',
    '- Technical/format failure: use action=repair with a specific earlier stage and concrete diagnosis within the preserved budget. Missing resources/permission: block and ask. Never cancel/start or work informally to evade a failed SOP.',
    '- Direct user text such as “拒绝候选” is a review operation; it never requires a special UI event. If review was not registered, report the real state/error and existing /playbook revise entry, not an invented button or cancel/new-run workaround.',
    '- Media final assembly: use playbook build with the actual command and exact output_paths. Final attachments: use playbook deliver, which resolves artifact IDs and preserves checked byte snapshots. Never select an old file by name after QA.',
    '- Delivery errors do not require a new SOP, clearing state, reauthorizing production, or substituting a previous final. Fix/retry only the indicated operation. A command observation does not establish model authorship.',
    '- Media candidates are not user acceptance. User rejection reopens the same run. Only an explicit direct-user approval can set accepted. Report facts come from action=report, never a prewritten success story.',
    '- SOPs are starter templates, not guaranteed optimal methods. Tool success is not proof of test exit code zero or semantic correctness.',
    '- A SOP never expands permissions. External publication, account actions, destructive operations and approvals still follow the user request and Host policy.',
  ].join('\n')
  ctx.systemPrompt.section({ name: 'tool:playbook', order: 365, text: ({ agent } = {}) => {
    if (!agent?.id) return basePolicy
    const id = String(agent.id), status = engine.status(id)
    if (status.attached || status.run?.state === 'failed') return `${basePolicy}\nACTIVE PLAYBOOK:\n${stageContext(status)}`
    const enabled = router.view(id).enabled
    return `${basePolicy}\nAutomatic routing: ${enabled ? 'on' : 'off; do not start a SOP unless explicitly requested'}\n${enabled ? engine.listPlaybooks().map(p => `${p.id}: ${p.name}`).join('\n') : ''}`
  } })
  ctx.tools.guard(exec => allowsControl(exec) ? undefined : exec.agent?.id ? engine.policyDecision(String(exec.agent.id), exec.name, PLAYBOOK_TOOL_NAME) : undefined)
  const callScopes = new Map()
  ctx.on('tools/pre-execute', (exec, next) => {
    engine.noteCaller(exec)
    const run = exec.agent?.id ? engine.activeRun(String(exec.agent.id)) : undefined
    if (run && exec.name !== PLAYBOOK_TOOL_NAME) callScopes.set(exec.token ?? exec, { runId: run.id, stageId: run.stageId, attempt: run.stageAttempt, epoch: run.stageEpoch ?? 0 })
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    const token = exec.token ?? exec, scope = callScopes.get(token)
    callScopes.delete(token)
    projects.observeRead(exec, result)
    if (!scope || !exec.agent?.id) return
    void engine.observeTool(String(exec.agent.id), { ...scope, name: exec.name, callId: exec.callId, isError: result.isError, receipt: toolReceipt(exec, result) })
      .catch(error => console.error(`[dsh-playbook] observation failed: ${error?.message ?? error}`))
  })
  ctx.effect(() => () => { callScopes.clear(); router.sessions.clear(); pendingWrites.clear(); projects.receipts.clear(); projects.prepared.clear(); projects.sourcesRequired.clear(); isolation.clear(); diagnostics.clear(); recovery.clear(); delivery.clear(); revisionDispatcher.clear(); engine.callers.clear() }, 'dsh-playbook transient routing and call scopes')
  installAutoRouting(ctx, engine, router, { ready, createMessage: message, allowsControl })
  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      name: 'playbook', description: 'SOP selection and current-session control',
      input: { hint: '[project|sops|sop <id>|approve <id> <revision>|list|inspect <id>|recommend <task>|route <task>|auto on/off|start <id>|status|resume|continue|report|revise|reject|review|accept|cancel|reload]' },
      handler: async invocation => {
        try {
          engine.noteCaller(invocation)
          const [op = 'status', ...rest] = (invocation.rawInput?.trim() ?? '').split(/\s+/).filter(Boolean)
          const sessionId = invocation.agent?.id ?? invocation.session?.id
          const success = value => ({ kind: 'success', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
          if (op === 'list' || op === 'ls') return success(engine.listPlaybooks())
          if (op === 'auto') {
            if (sessionId === undefined) throw new Error('current command invocation has no session id')
            if (!rest.length) return success(router.view(String(sessionId)))
            if (!['on', 'off'].includes(rest[0])) throw new Error('usage: /playbook auto on|off')
            return success(router.setAuto(String(sessionId), rest[0] === 'on'))
          }
          await ready()
          if (op === 'reload') return success(await reloadCatalog())
          if (op === 'exclude-hash') return success(await engine.excludeHash(invocation, rest[0], rest.slice(1).join(' ') || undefined))
          if (op === 'project') return success(rest[0] === 'use' ? await projects.bindHuman(invocation, rest[1]) : projects.view(invocation))
          if (op === 'sops') return success(projects.list(invocation))
          if (op === 'sop') return success(projects.inspect(invocation, rest[0], rest[1]))
          if (op === 'approve') {
            if (!rest[0] || !rest[1]) throw new Error('usage: /playbook approve <sop-id> <exact-revision>; inspect /playbook sop first')
            return success(await projects.approve(invocation, rest[0], rest[1]))
          }
          if (op === 'inspect') {
            const p = engine.getPlaybook(rest[0]); if (!p) throw new Error(`unknown playbook: ${rest[0]}`)
            return success(p)
          }
          if (op === 'recommend') return success(router.recommend(rest.join(' ')))
          if (sessionId === undefined || sessionId === null) throw new Error('current command invocation has no session id')
          const id = String(sessionId)
          if (op === 'route') return success(await router.route(id, { task: rest.join(' '), origin: 'command', signal: invocation.signal }))
          if (op === 'start') {
            if (!rest[0]) throw new Error('usage: /playbook start <id> [task]')
            const status = await engine.start(id, rest[0], rest.length > 1 ? { task: rest.slice(1).join(' ') } : {}, { signal: invocation.signal })
            router.clear(id); return success(conciseStatus(status))
          }
          if (op === 'continue') return success(conciseStatus(await engine.continueWork(id, { signal: invocation.signal })))
          if (op === 'resume') return success(conciseStatus(await engine.resume(id, { signal: invocation.signal })))
          if (op === 'report') return success(rest[0] === 'markdown' ? reportMarkdown(engine.report(id)) : engine.report(id))
          if (op === 'review') {
            const [decision, target, ...reason] = rest
            if (!['reject','accept'].includes(decision) || !/^[a-f0-9]{64}$/.test(target ?? '')) throw new Error('usage: /playbook review reject|accept <displayed-candidate-target> [feedback]; ordinary chat can use /playbook revise')
            const options = { signal: invocation.signal, expectedReviewTarget: target }
            const status = decision === 'reject'
              ? await revisionDispatcher.revise(invocation, reason.join(' ') || '用户在 Playbook 面板拒绝当前候选；继续处理已有的审核意见。', options)
              : await engine.accept(id, options)
            return success(decision === 'reject' ? status.text + '\n' + conciseStatus(status.status) : conciseStatus(status))
          }
          if (op === 'revise' || op === 'reject') {
            const outcome = await revisionDispatcher.revise(invocation,rest.join(' ') || '用户明确拒绝当前候选；在原任务中诊断并返修，保留已确认要求。')
            return success(outcome.text + '\n' + conciseStatus(outcome.status))
          }
          if (op === 'accept') return success(conciseStatus(await engine.accept(id, { signal: invocation.signal })))
          if (op === 'cancel') { const status = await engine.cancel(id, rest.join(' ') || 'cancelled by user', { signal: invocation.signal }); router.clear(id); return success(conciseStatus(status)) }
          if (op === 'status' || op === 'show') {
            const status = engine.status(id)
            return success(rest[0] === 'json' ? { ...status, runtimePluginVersion: PLUGIN_VERSION, routing: router.view(id) } : conciseStatus(status))
          }
          throw new Error('usage: /playbook [project|sops|sop <id>|approve <id> <revision>|list|inspect <id>|recommend <task>|route <task>|auto on/off|start <id>|status|resume|continue|report|revise|reject|review|accept|cancel|reload]')
        } catch (error) { return { kind: 'error', text: error?.message ?? String(error) } }
      },
    })
  })
  ctx.provide?.('playbookEngine', engine)
  return engine
}
export { PlaybookEngine } from './engine.js'
export { normalizePlaybook, evaluateGate, toolPolicyDecision, formatStageInstruction } from './core.js'

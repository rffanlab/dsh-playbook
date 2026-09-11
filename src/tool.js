/** SDK-neutral tool definition; the Host wraps this with DSH defineTool. */
const object = { type: 'object', additionalProperties: true }
const json = value => JSON.parse(JSON.stringify(value)) // Omit absent optional stage fields at the canonical JSON boundary.
function sessionId(exec) {
  if (exec?.agent?.id === undefined || exec?.agent?.id === null) throw new Error('playbook action requires an agent/session context')
  return String(exec.agent.id)
}
function inputObject(value) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('input/evidence must be an object')
  return value
}
export function conciseStatus(status) {
  if (!status?.run) return 'No playbook run is attached to this session.'
  if (!status.active) return `${status.run.playbookId} is ${status.run.state}.`
  return `${status.run.playbookId} → ${status.run.stageId} (attempt ${status.run.stageAttempt}).\n${status.instruction}`
}
export function playbookDefinition(engine, reloadCatalog, router, ready = async () => {}) {
  async function handle(args, exec) {
    switch (args.action) {
      case 'list': return { ok: true, playbooks: engine.listPlaybooks() }
      case 'inspect': {
        const p = engine.getPlaybook(args.playbook_id)
        if (!p) throw new Error(`unknown playbook: ${args.playbook_id}`)
        return { ok: true, playbook: p }
      }
      case 'recommend': return { ok: true, decision: router.recommend(args.task || router.session(sessionId(exec)).pendingTask) }
      case 'route': return router.route(sessionId(exec), { task: args.task, playbookId: args.playbook_id, note: args.note ?? '', signal: exec.signal })
      case 'reload': return { ok: true, playbooks: await reloadCatalog() }
      case 'start': {
        if (!args.playbook_id) throw new Error('playbook_id is required for start')
        const status = await engine.start(sessionId(exec), args.playbook_id, inputObject(args.input), { signal: exec.signal })
        router.clear(sessionId(exec))
        return { ok: true, status, message: conciseStatus(status) }
      }
      case 'status': {
        const id = sessionId(exec), status = engine.status(id)
        return { ok: true, status, routing: router.view(id), message: conciseStatus(status) }
      }
      case 'submit': {
        if (!args.stage_id) throw new Error('stage_id is required for submit; use status to inspect the current stage')
        const status = await engine.submit(sessionId(exec), { stageId: args.stage_id, evidence: inputObject(args.evidence), note: args.note ?? '', signal: exec.signal })
        return { ok: true, status, gate: status.lastGate, message: conciseStatus(status) }
      }
      case 'cancel': {
        const id = sessionId(exec), status = await engine.cancel(id, args.note ?? 'cancelled by model/user')
        router.clear(id)
        return { ok: true, status, message: conciseStatus(status) }
      }
      default: throw new Error(`unsupported action: ${String(args.action)}`)
    }
  }
  return {
    name: 'playbook',
    description: 'Choose and execute a task SOP. For a new work request use route (automatic selection/start); recommend is read-only and inspect shows the complete SOP. Ambiguous tasks: select a suitable playbook_id with note explaining the fit, or ask only for missing task requirements. Never ask the user to memorize SOP names. Active runs are never replaced by route. Submit evidence for the current stage; do not advance in prose. Cancel only when the user requests stopping, never to bypass a gate.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'inspect', 'recommend', 'route', 'start', 'status', 'submit', 'reload', 'cancel'] },
      task: { type: 'string', description: 'Concise user task for recommend/route; the current captured user request is used when available.' },
      playbook_id: { type: 'string', description: 'Required for start/inspect; optional semantic selection for route.' },
      stage_id: { type: 'string', description: 'Required for submit: expected current stage id.' },
      input: { ...object, description: 'Task inputs for manual start.' },
      evidence: { ...object, description: 'Actual structured evidence matching every current gate constraint.' },
      note: { type: 'string', description: 'Explain a semantic SOP selection, submit observation or user-requested cancellation.' },
    },
    output: { schema: object, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      await ready()
      exec.signal?.throwIfAborted()
      return json(await handle(args, exec))
    },
  }
}

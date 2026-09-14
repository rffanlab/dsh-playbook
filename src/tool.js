import { repairEvidenceShape, gateDiagnostics } from './core.js'
import { reportMarkdown } from './run-control.js'
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
  if (status.blocker) return `${status.run.playbookId} blocked: ${status.blocker.reason}\n用户处理后 /playbook resume；放弃任务用 /playbook cancel。`
  if (status.run.state === 'awaiting_review') return `${status.run.playbookId}: candidate_ready / awaiting_review, revision ${status.run.revision}. Only explicit user acceptance can mark accepted.`
  if (!status.active) return `${status.run.playbookId} is ${status.run.state}.`
  return `${status.run.playbookId} → ${status.run.stageId} (attempt ${status.run.stageAttempt}).\n${status.instruction}`
}
export function playbookDefinition(engine, reloadCatalog, router, ready = async () => {}, runChecks, exportReport, projects) {
  async function handle(args, exec) {
    switch (args.action) {
      case 'list': return { ok: true, playbooks: engine.listPlaybooks(), projectSops: projects?.list(exec) ?? [] }
      case 'intake_status': return { ok: true, intake: projects?.view(exec) ?? null }
      case 'intake': { if (!projects) throw new Error('Project library unavailable'); return projects.intake(exec, args) }
      case 'sop_list': return { ok: true, sops: projects?.list(exec) ?? [] }
      case 'sop_inspect': { if (!projects) throw new Error('Project library unavailable'); return { ok: true, sop: projects.inspect(exec, args.sop_id, args.sop_revision) } }
      case 'sop_validate': { if (!projects) throw new Error('Project library unavailable'); return projects.validate(exec, args) }
      case 'sop_save': { if (!projects) throw new Error('Project library unavailable'); return projects.save(exec, args) }
      case 'inspect': {
        const p = engine.getPlaybook(args.playbook_id)
        if (!p) throw new Error(`unknown playbook: ${args.playbook_id}`)
        return { ok: true, playbook: p }
      }
      case 'recommend': return { ok: true, decision: router.recommend(args.task || router.session(sessionId(exec)).pendingTask) }
      case 'route': return router.route(sessionId(exec), { task: args.task, playbookId: args.playbook_id, note: args.note ?? '', signal: exec.signal, exec, sopId: args.sop_id, revision: args.sop_revision })
      case 'reload': return { ok: true, playbooks: await reloadCatalog() }
      case 'start': {
        const id = sessionId(exec)
        if (engine.status(id).run?.state === 'awaiting_review') throw new Error('Candidate awaits user review; use explicit user revision or acceptance, not a new model-started SOP')
        if (engine.status(id).run && !engine.attachedRun(id) && !router.session(id).pendingTask) throw new Error('A fresh user task or /playbook start is required before restarting a terminal run')
        if (!args.playbook_id) throw new Error('playbook_id is required for start')
        const authorized = projects?.authorize(exec, { playbookId: args.playbook_id }) ?? {}
        const { project, contract, sop, ...manualInput } = inputObject(args.input)
        const status = await engine.start(sessionId(exec), args.playbook_id, { ...manualInput, ...authorized.input }, { signal: exec.signal, definition: authorized.definition })
        router.clear(sessionId(exec))
        return { ok: true, status, message: conciseStatus(status) }
      }
      case 'status': {
        const id = sessionId(exec), status = engine.status(id)
        return { ok: true, status, routing: router.view(id), message: conciseStatus(status) }
      }
      case 'export_report': { if (!exportReport) throw new Error('Report export unavailable'); return exportReport(exec) }
      case 'report': { const report = engine.report(sessionId(exec)); return { ok: true, report, ...(args.format === 'markdown' ? { markdown: reportMarkdown(report) } : {}) } }
      case 'repair': {
        const status = await engine.repair(sessionId(exec), args.stage_id, args.note, { signal: exec.signal })
        return { ok: true, status, message: conciseStatus(status) }
      }
      case 'check': {
        if (!args.stage_id) throw new Error('stage_id is required for check')
        return { ok: true, gate: await engine.check(sessionId(exec), { stageId: args.stage_id, evidence: inputObject(args.evidence), signal: exec.signal }) }
      }
      case 'block': {
        const status = await engine.block(sessionId(exec), args.note, { signal: exec.signal })
        return { ok: true, status, message: conciseStatus(status) }
      }
      case 'submit': {
        if (!args.stage_id) throw new Error('stage_id is required for submit; use status to inspect the current stage')
        const id = sessionId(exec)
        await engine.queue
        const before = engine.status(id), stage = engine.currentStage(id)
        if (!before.active || !stage || stage.id !== args.stage_id) throw new Error('submit requires the active current stage; inspect status or use controlled repair')
        const shaped = repairEvidenceShape(stage, inputObject(args.evidence))
        const formats = gateDiagnostics(stage, shaped.evidence, before.observations).issues.filter(item => item.kind === 'format')
        const expected = { runId: before.run.id, epoch: before.run.stageEpoch, revision: before.run.revision }
        const runtimeChecks = !formats.length && stage.gate.validators?.length ? await runChecks?.(stage.gate.validators, shaped.evidence, exec) : undefined
        const status = await engine.submit(id, { stageId: args.stage_id, evidence: inputObject(args.evidence), note: args.note ?? '', signal: exec.signal, runtimeChecks, expected })
        const { input, evidence, machineEvidence, previousCandidate, ...progress } = status
        return { ok: true, status: progress, validation: runtimeChecks?.map(({bindings, segmentAudio, ...summary}) => summary), gate: status.lastGate, gatePassed: status.lastGate?.passed === true,
          nextAction: status.blocker ? 'report_blocker' : status.lastGate?.repairOnly ? 'repair_evidence' : status.active ? 'execute_current_stage' : status.run.state === 'awaiting_review' ? 'deliver_candidate_await_review' : 'report_outcome',
          message: conciseStatus(status) } 
      }
      case 'cancel': throw new Error('Model cancellation is disabled to prevent bypassing gates. Report blockers via action=block; the user can /playbook cancel.')
      default: throw new Error(`unsupported action: ${String(args.action)}`)
    }
  }
  return {
    name: 'playbook',
    description: 'Read referenced task documents before selecting a SOP. Use intake_status to see real read call IDs, then intake to identify the project, task requirements and sources. Project SOPs use sop_list/inspect/validate/save; new versions are immutable trials, protected changes become non-executable drafts until human approval. Never rename/rewrite SOPs to evade a failing gate. Topics/platforms are task inputs, not separate workflows. Choose and execute a task SOP. For a new work request use route (automatic selection/start); recommend is read-only and inspect shows the complete SOP. Ambiguous tasks: select a suitable playbook_id with note explaining the fit, or ask only for missing task requirements. Never ask the user to memorize SOP names. Active runs are never replaced by route. Do actual work before submitting evidence. Use check for a read-only preflight and repair format errors, not fabricated values. A failed SOP still governs work: use bounded repair with a target stage and diagnosis; never work outside it. The exact {item:[...]} array mistake is corrected and recorded losslessly. Video submit runs independent Host media checks; self-reported release_ready cannot replace them. Missing inputs/tools: block with a reason. A blocked or terminal run is not completion. report exposes an audit trace. cancel/resume are human commands, not model escape hatches.',
    parameters: {
      action: { type: 'string', required: true, enum: ['intake_status', 'intake', 'sop_list', 'sop_inspect', 'sop_validate', 'sop_save', 'list', 'inspect', 'recommend', 'route', 'start', 'status', 'check', 'submit', 'block', 'repair', 'report', 'export_report', 'reload', 'cancel'] },
      project_id: { type: 'string', description: 'Business project ID under Host session cwd (e.g. taoist-culture or bilibili-ai); chosen by Agent during intake, never a filesystem path.' },
      source_call_ids: { type: 'array', items: { type: 'string' }, description: 'Actual read-tool call IDs covering task documents; see intake_status.' },
      requirements: { type: 'array', items: { type: 'string' }, description: 'This task requirements extracted from the original user request/read documents. Persisted with the run, not mutable while running.' },
      sop_id: { type: 'string', description: 'Project-local SOP ID for creation/inspection or routing a saved version.' },
      sop_revision: { type: 'string', description: 'Exact immutable saved revision; default is approved version or latest trial.' },
      base_id: { type: 'string', description: 'Installed base contract from inspect. A video SOP must inherit an appropriate video base.' },
      rules: { type: 'array', items: { type: 'string' }, description: 'Stable project requirements, not episode topic/output paths. Removing confirmed rules requires human approval.' },
      stage_notes: { ...object, description: 'Map of existing stage ID to additional instructions (string array). Inherits base gates unchanged.' },
      definition: { ...object, description: 'Optional complete proposed SOP definition. Removing/rewriting protected clauses creates a draft requiring review.' },
      name: { type: 'string' },
      description: { type: 'string' },
      task: { type: 'string', description: 'Concise user task for recommend/route; the current captured user request is used when available.' },
      playbook_id: { type: 'string', description: 'Required for start/inspect; optional semantic selection for route.' },
      stage_id: { type: 'string', description: 'Required for submit: expected current stage id.' },
      input: { ...object, description: 'Task inputs for manual start.' },
      evidence: { ...object, description: 'Actual structured evidence matching every current gate constraint.' },
      format: { type: 'string', enum: ['json', 'markdown'], description: 'System report format; counts and timings come from engine events.' },
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

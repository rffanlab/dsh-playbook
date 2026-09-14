import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { inside } from './run-isolation.js'
import { validatorCommand } from './host-media.js'

/** Directory preparation goes through the existing bash policy, never raw Host fs. */
export function createIsolationManager(ctx, engine) {
  const pending = new Map(), preparations = new Map()
  function isPreparation(exec) {
    const entry = pending.get(exec.callId)
    return !!entry && exec.name === 'bash' && exec.parent === entry.parent && exec.agent === entry.agent &&
      exec.arguments?.command === entry.command && exec.arguments?.workdir === entry.workdir
  }
  async function prepare(exec) {
    engine.noteCaller(exec)
    await engine.queue
    const id = String(exec.agent?.id ?? ''), status = engine.status(id), own = status.isolation
    if (!own) throw new Error('No run-owned media workspace. Old unisolated runs cannot be relabelled; start a deliberate new run.')
    if (own.prepared) return { ok: true, status, workspace: own.realRoot }
    if (!exec.token || !exec.agent || typeof ctx.tools.execute !== 'function') throw new Error('Host execution context unavailable; no direct mkdir fallback')
    if (!status.active) throw new Error('Only an active run can prepare a workspace')
    if (preparations.has(own.runId)) return preparations.get(own.runId)
    const job = (async () => {
      const command = validatorCommand('prepare', '', own), callId = `${exec.callId}:run-workspace:${randomUUID()}`
      pending.set(callId, { command, workdir: own.workspace, parent: exec.token, agent: exec.agent })
      try {
        const result = await ctx.tools.execute({ callId, rootCallId: exec.rootCallId ?? exec.callId,
          parent: exec.token, name: 'bash', agent: exec.agent, signal: exec.signal,
          arguments: { command, workdir: own.workspace, description: 'Create a fresh run-owned artifact workspace', timeoutMs: 30000 } })
        for (const message of result.additionalContexts ?? []) exec.deferContext?.(message)
        exec.signal?.throwIfAborted()
        const value = result.value
        if (result.isError !== false || value?.kind !== 'foreground' || value.exitCode !== 0 || value.signal !== null ||
            value.aborted !== false || value.timedOut !== false || value.stdout?.truncated !== false ||
            value.sandbox?.denied || value.sandbox?.runnerFailed) throw new Error('Workspace preparation denied/failed. Keep original Host permissions; do not create or adopt an old directory as a workaround.')
        const receipt = JSON.parse(value.stdout.text)
        if (receipt.status !== 'pass') throw new Error((receipt.failures ?? ['workspace preparation failed']).join('; '))
        const next = await engine.markPrepared(id, own.runId, receipt)
        return { ok: true, status: next, workspace: next.isolation.realRoot,
          manifest: join(next.isolation.realRoot, 'production.json') }
      } finally { pending.delete(callId) }
    })()
    preparations.set(own.runId, job)
    try { return await job } finally { preparations.delete(own.runId) }
  }
  function guard(exec) {
    if (isPreparation(exec)) return undefined
    const id = String(exec.agent?.id ?? ''), run = engine.runs.get(id), own = run?.isolation
    if (!own || ['cancelled','completed','accepted'].includes(run.state)) return undefined
    if (['playbook','run_code','ask_user_question','AskUserQuestion'].includes(exec.name)) return undefined
    const roots = [own.root, own.realRoot].filter(Boolean), args = exec.arguments ?? {}
    const path = value => typeof value === 'string' && value.trim() ? resolve(own.workspace, value) : null
    const ours = value => roots.some(root => inside(root, value))
    if (['write','edit'].includes(exec.name)) {
      if (!own.prepared) return 'WORKSPACE_NOT_PREPARED: use playbook action=workspace first'
      if (typeof args.file_path === 'string' && basename(args.file_path) === '.dsh-run.json') return 'RUN_MARKER_PROTECTED: ownership is assigned by the Host, not by the model'
      if (!ours(path(args.file_path))) return 'RUN_OUTPUT_PATH: write/edit media task outputs only under this run artifact root, not the shared project or another run'
    }
    if (exec.name === 'bash') {
      if (!own.prepared) return 'WORKSPACE_NOT_PREPARED: use playbook action=workspace first'
      if (!ours(path(args.workdir))) return 'RUN_WORKDIR_REQUIRED: supply bash workdir inside status.isolation.root; cwd is not changed globally'
    }
    if (['read','read_image','grep','glob'].includes(exec.name)) {
      const target = path(args.file_path ?? args.path)
      const managed = join(own.workspace, '.dsh-runs')
      if (target && inside(managed, target) && !ours(target)) return 'CROSS_RUN_READ: another run artifact directory is not a public tool/template'
      if (target && engine.knownOutputs(run.id).some(file => file.path && resolve(file.path) === target))
        return 'CROSS_RUN_READ: this is a recorded prior final artifact'
      // Broad searches of the whole project would traverse sibling run outputs.
      if (['grep','glob'].includes(exec.name) && (!target || inside(target, managed)))
        return 'RUN_SEARCH_SCOPE: search the current run or a specific public tools/source directory, not all sibling runs'
    }
    return undefined
  }
  function wrap(definition) {
    return { ...definition,
      description: definition.description + ' Media runs allocate a fresh artifact root. workspace prepares/inspects it. Always use its absolute output paths and explicit bash workdir; never reuse an earlier run final/evidence.',
      parameters: { ...definition.parameters, action: { ...definition.parameters.action,
        enum: [...definition.parameters.action.enum, 'workspace'] } },
      async execute(args, exec) {
        engine.noteCaller(exec)
        if (args.action === 'workspace') {
          await definition.execute({ action: 'status' }, exec) // awaits Host hydration
          return JSON.parse(JSON.stringify(await prepare(exec)))
        }
        const output = await definition.execute(args, exec)
        if (['route','start'].includes(args.action) && output.status?.active && output.status.isolation && !output.status.isolation.prepared && exec.token) {
          const prepared = await prepare(exec)
          return JSON.parse(JSON.stringify({ ...output, status: prepared.status, workspace: prepared.workspace,
            message: `${output.message ?? ''}\n${prepared.status.instruction}` }))
        }
        return output
      } }
  }
  return { prepare, guard, wrap, isPreparation, clear: () => { pending.clear(); preparations.clear() } }
}

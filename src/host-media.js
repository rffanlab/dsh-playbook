import { manifestPath } from './artifact-paths.js'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const program = readFileSync(new URL('./media_worker.py', import.meta.url), 'utf8')
export const MEDIA_WORKER_SHA256 = createHash('sha256').update(program).digest('hex')
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
export function validatorCommand(kind, manifest, isolation, previousQa, legacyScope) {
  if (!['prepare', 'narration', 'pilot', 'video', 'handoff', 'diagnose'].includes(kind)) throw new Error('unsupported validator kind')
  if (kind !== 'prepare' && (typeof manifest !== 'string' || !manifest.trim() || manifest.length > 4096 || manifest.includes('\0'))) throw new Error('manifest requires a bounded path')
  if (previousQa && Buffer.byteLength(JSON.stringify(previousQa)) > 60000) previousQa = undefined // bound argv; fall back to full read-only validation
  const payload = Buffer.from(JSON.stringify({ kind, manifest, ...(kind === 'diagnose' ? {video: manifest} : {}), ...(isolation ? { isolation } : {}), ...(legacyScope ? { legacyScope } : {}), ...(previousQa ? {previousQa} : {}) }), 'utf8').toString('base64')
  return `python3 -I -c ${quote(program)} ${quote(payload)}`
}

/** All work passes through the same agent, guards, sandbox and cancellation tree. */
export function createMediaRunner(ctx, engine) {
  return async (rules, evidence, exec) => {
    if (!rules?.length) return []
    const results = []
    for (const rule of rules) {
      exec.signal?.throwIfAborted()
      const unavailable = reason => ({ kind: rule.kind, validatorVersion: '0.4.0', workerSha256: MEDIA_WORKER_SHA256,
        passed: false, status: 'unavailable', failures: [reason] })
      if (!exec.agent || !exec.token || typeof ctx.tools.execute !== 'function') {
        results.push(unavailable('Host tool execution context unavailable; no direct filesystem/shell fallback'))
        continue
      }
      let command
      let isolation, legacyScope, resolvedManifest
      try {
        engine?.noteCaller(exec)
        if (engine) {
          await engine.queue
          const status = engine.status(String(exec.agent.id))
          isolation = status.isolation
          legacyScope = status.legacyContinuation
          if (!isolation?.prepared && !legacyScope) throw new Error('No prepared artifact scope. Use playbook workspace/recover for this same-run plugin incident; do not clear state or create a weaker SOP.')
          if (isolation?.prepared) resolvedManifest = manifestPath(evidence[rule.pathKey], isolation)
        }
        const previousQa = rule.kind === 'handoff' && engine ? Object.values(engine.runs.get(String(exec.agent.id))?.machineEvidence ?? {}).flat().find(c => c.kind === 'video' && c.passed) : undefined
        command = validatorCommand(rule.kind, resolvedManifest?.path ?? evidence[rule.pathKey], isolation, previousQa, legacyScope)
      }
      catch (error) {
        const failed = unavailable(error.message)
        if (/^(MANIFEST_PATH_REQUIRED|RUN_PATH_TRAVERSAL|CROSS_RUN_PATH):/.test(error.message)) failed.status = 'fail'
        results.push(failed); continue
      }
      const callId = `${exec.callId}:playbook-validator:${randomUUID()}`
      const output = await ctx.tools.execute({ callId, rootCallId: exec.rootCallId ?? exec.callId,
        parent: exec.token, name: 'bash', agent: exec.agent, signal: exec.signal,
        arguments: { command, ...(isolation ? { workdir: isolation.realRoot } : legacyScope ? { workdir: legacyScope.workspace } : {}), description: `Validate ${rule.kind} artifact content and hashes`, timeoutMs: 120000 } })
      for (const context of output.additionalContexts ?? []) exec.deferContext?.(context)
      exec.signal?.throwIfAborted()
      const v = output.value
      if (output.isError !== false || v?.kind !== 'foreground' || v.exitCode !== 0 || v.signal !== null ||
          v.aborted !== false || v.timedOut !== false || v.stdout?.truncated !== false ||
          v.sandbox?.denied || v.sandbox?.runnerFailed) {
        results.push(unavailable('Host validation command denied, failed, timed out or returned an unsupported result. Inspect its real tool outcome.'))
        continue
      }
      try {
        const parsed = JSON.parse(v.stdout.text)
        if (parsed.validatorVersion !== '0.4.0' || typeof parsed.passed !== 'boolean') throw new Error('invalid validator response')
        results.push({ ...parsed, kind: rule.kind, workerSha256: MEDIA_WORKER_SHA256, callId, pathResolution: resolvedManifest })
      } catch { results.push(unavailable('Validator output was not bounded machine JSON; printed success text is not accepted')) }
    }
    return results
  }
}

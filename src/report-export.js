import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { reportMarkdown } from './run-control.js'

/** Author-generated report bytes only; the agent cannot choose content or overwrite a path. */
export function createReportExporter(ctx, engine, pendingWrites) {
  return async exec => {
    await engine.queue
    const id = String(exec.agent?.id ?? ''), report = engine.report(id)
    const videoPath = report.candidates?.at(-1)?.artifacts?.video?.binding?.path
    if (!videoPath || !exec.token || !exec.agent) throw new Error('Export needs a validated candidate and a live Host context; action=report is still available')
    const content = reportMarkdown(report) + (report.isolation ? '\n## Artifact isolation / 产物归属\n\n```json\n' + JSON.stringify({ isolation: report.isolation, artifactLineage: report.artifactLineage, provenanceLimit: report.provenanceLimit }, null, 2) + '\n```\n' : ''), suffix = randomUUID()
    const path = join(dirname(videoPath), `execution-report.system.r${report.run.revision}.${suffix.slice(0, 8)}.md`)
    const callId = `${exec.callId}:playbook-report:${suffix}`
    const args = { file_path: path, content }
    pendingWrites.set(callId, { parent: exec.token, agent: exec.agent, args })
    try {
      const result = await ctx.tools.execute({ callId, parent: exec.token, rootCallId: exec.rootCallId ?? exec.callId,
        agent: exec.agent, signal: exec.signal, name: 'write', arguments: args })
      for (const context of result.additionalContexts ?? []) exec.deferContext?.(context)
      exec.signal?.throwIfAborted()
      if (result.isError !== false || typeof result.value?.path !== 'string' || result.value.after !== content) throw new Error('Host denied/failed report export; no direct-write fallback')
      const sha256 = createHash('sha256').update(content).digest('hex')
      return { ok: true, path: result.value.path, sha256, runId: report.run.id, revision: report.run.revision,
        message: 'System-generated facts, not an A-grade or user acceptance. File is not cryptographically signed.' }
    } finally { pendingWrites.delete(callId) }
  }
}
export function isReportWrite(exec, pendingWrites) {
  const entry = pendingWrites.get(exec.callId)
  return !!entry && exec.parent === entry.parent && exec.agent === entry.agent && exec.name === 'write' &&
    exec.arguments?.file_path === entry.args.file_path && exec.arguments?.content === entry.args.content
}

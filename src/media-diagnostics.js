import { randomUUID } from 'node:crypto'
import { validatorCommand } from './host-media.js'

/** A fixed read-only measurement, not arbitrary bash, approval or a stage transition. */
export function createMediaDiagnostics(ctx, engine) {
  const pending = new Map()
  function allows(exec) {
    const p = pending.get(exec.callId)
    return !!p && exec.name === 'bash' && exec.agent === p.agent && exec.parent === p.parent &&
      exec.arguments?.command === p.command && exec.arguments?.workdir === p.workdir
  }
  async function diagnose(exec, { full = false } = {}) {
    exec.signal?.throwIfAborted(); await engine.queue
    const run = engine.runs.get(String(exec.agent?.id)), own = run?.isolation
    const checks = Object.values(run?.machineEvidence ?? {}).flat()
    const check = [...checks].reverse().find(c => c.video?.binding?.path)
    const video = run?.candidates?.at(-1)?.artifacts?.video?.binding?.path ?? check?.video?.binding?.path
    if (!run || !video || !exec.token || !exec.agent || typeof ctx.tools.execute !== 'function')
      throw new Error('Diagnostics needs a recorded candidate/checked media path and live Host context. It cannot inspect arbitrary caller-supplied paths.')
    if (own && !own.prepared) throw new Error('Allocated workspace is not prepared')
    // Legacy runs may inspect their recorded candidate, never acquire new ownership or pass new gates.
    const workspace = own?.realRoot ?? exec.agent.session?.header?.cwd
    if (typeof workspace !== 'string' || !workspace.startsWith('/')) throw new Error('No Host workspace for read-only diagnostics')
    const command = validatorCommand('diagnose', video, own)
    const callId = `${exec.callId}:media-diagnostics:${randomUUID()}`
    const record = {agent:exec.agent,parent:exec.token,command,workdir:workspace}
    pending.set(callId,record)
    try {
      const out = await ctx.tools.execute({callId,rootCallId:exec.rootCallId??exec.callId,parent:exec.token,
        name:'bash',agent:exec.agent,signal:exec.signal,
        arguments:{command,workdir:workspace,description:'Measure existing candidate audio and video read-only',timeoutMs:120000}})
      for (const c of out.additionalContexts ?? []) exec.deferContext?.(c)
      exec.signal?.throwIfAborted()
      const v=out.value
      if (out.isError!==false || v?.kind!=='foreground' || v.exitCode!==0 || v.signal!==null ||
          v.aborted!==false || v.timedOut!==false || v.stdout?.truncated!==false || v.sandbox?.denied || v.sandbox?.runnerFailed)
        throw new Error('Read-only diagnostics denied or unavailable in the Host; do not widen permissions or retry raw shell')
      const measured=JSON.parse(v.stdout.text)
      if (measured.validatorVersion!=='0.4.0' || typeof measured.passed!=='boolean') throw new Error('Unsupported diagnostics response')
      const output=full?measured:{status:measured.status,failures:measured.failures,
        path:measured.video?.binding?.path,sha256:measured.video?.binding?.sha256,
        durationSeconds:measured.video?.durationSeconds,audio:measured.video?.audio,
        semanticVerification:false,speechRecognition:false}
      return {ok:true,readOnly:true,notAGate:true,runId:run.id,callId,measurements:output,
        message:'Actual media measurements only. No stage, revision, acceptance or repair budget was changed. These checks cannot establish a speech loop or exact spoken words without suitable audio analysis.'}
    } finally {pending.delete(callId)}
  }
  return {diagnose,allows,clear:()=>pending.clear()}
}

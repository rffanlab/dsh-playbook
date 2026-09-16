import { readFileSync } from 'node:fs'
import { mediaWarnings } from './media-checks.js'
/** Model-facing ergonomics. Full durable state stays in the engine and explicit reports. */
export const PLUGIN_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const copy = value => JSON.parse(JSON.stringify(value))
const stamped = value => copy({ ...value, runtimePluginVersion: PLUGIN_VERSION })
const clip = (value, size = 600) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return text.length > size ? text.slice(0, size) + ' [truncated; detail=full for original]' : text
}
export function normalizeAction(input) {
  const args = { ...input }, corrections = []
  const aliases = args.action === 'repair'
    ? { stage_id: ['target_stage_id','target_stage','target'], note: ['diagnosis','reason'] }
    : args.action === 'block' ? { note: ['reason','diagnosis'] } : {}
  for (const [canonical, names] of Object.entries(aliases)) {
    const found = [canonical, ...names].filter(k => args[k] !== undefined)
    if (new Set(found.map(k => args[k])).size > 1) throw new Error(`Conflicting ${canonical} aliases: ${found.join(', ')}; send one value`)
    if (found.length && args[canonical] === undefined) {
      args[canonical] = args[found[0]]; corrections.push({ from: found[0], to: canonical })
    }
    for (const name of names) delete args[name]
  }
  return { args, corrections }
}
export function compactStatus(s) {
  if (!s?.run) return s
  const manifests = Object.entries(s.evidence ?? {}).filter(([,e]) => e?.production_manifest)
  return {
    active: s.active, attached: s.attached, run: s.run, blocker: s.blocker, isolation: s.isolation, legacyContinuation:s.legacyContinuation, runtimeRecovery:s.runtimeRecovery,
    stage: s.stage ? {id:s.stage.id,title:s.stage.title,mode:s.stage.mode,objective:s.stage.objective,gate:s.stage.gate,tools:s.stage.tools,retry:s.stage.retry,next:s.stage.next} : null,
    instruction: s.runtimeRecovery ? s.runtimeRecovery.message + '\n' + (s.stage?.instructions?.join('\n') ?? '') : s.stage?.instructions?.join('\n') ?? s.instruction, lastGate: s.lastGate, recovery: s.recovery, activity: s.activity,
    currentManifest: manifests.at(-1)?.[1].production_manifest ?? null,
    input: s.input ? {project:s.input.project,sop:s.input.sop} : undefined,
    acceptedEvidenceKeys: Object.keys(s.evidence ?? {}),
    machineChecks: Object.entries(s.machineEvidence ?? {}).flatMap(([stage, checks]) => checks.map(c => ({stage,kind:c.kind,passed:c.passed,warnings:c.warnings}))),
    observations: Object.fromEntries(Object.entries(s.observations ?? {}).map(([tool,row]) => [tool, {
      calls: row.calls, successes: row.successes, failures: row.failures, lastCallId: row.lastCallId,
      receipts: (row.receipts ?? []).slice(-4),
    }])),
    reviewControl: s.reviewControl, workBudget: s.workBudget,
    revisionFeedback: s.revisionFeedback ? clip(s.revisionFeedback, 1200) : null,
    detail: 'compact; use detail=full only to read prior evidence or full feedback',
  }
}
function compactValidation(rows) {
  return rows?.map(c => ({ kind:c.kind, status:c.status, passed:c.passed, failures:c.failures,
    warnings:c.warnings, pathResolution:c.pathResolution, coverage:c.coverage, cache:c.cache, callId:c.callId,
    video: c.video ? {path:c.video.binding?.path,sha256:c.video.binding?.sha256,durationSeconds:c.video.durationSeconds,
      audio:c.video.audio} : undefined,
    timing:c.timing, semanticVerification:c.semanticVerification, speechRecognition:c.speechRecognition }))
}
export function usableController(definition, engine, { diagnose } = {}) {
  return { ...definition,
    description: definition.description + ' Prefer compact status; detail=full is optional. repair uses stage_id + note (target_stage_id/diagnosis aliases accepted). diagnose measures existing media read-only even while awaiting review; it cannot accept/revise a candidate or grant shell access. Technical failures return the exact dependency to fix, not permission to redo everything.',
    parameters: { ...definition.parameters,
      action: { ...definition.parameters.action, enum: [...definition.parameters.action.enum, 'diagnose'] },
      detail: { type:'string',enum:['compact','full'],description:'Default compact; full only when prior evidence/raw validation is necessary.' },
      target_stage_id: { type:'string',description:'Alias of stage_id for repair.' },
      target_stage: { type:'string',description:'Alias of stage_id for repair.' },
      target: { type:'string',description:'Alias of stage_id for repair.' },
      diagnosis: { type:'string',description:'Alias of note for repair/block. Give the actual problem, not a budget reset.' },
      reason: { type:'string',description:'Alias of note for repair/block.' },
    },
    async execute(raw, exec) {
      const { args, corrections } = normalizeAction(raw)
      const id = exec.agent?.id == null ? null : String(exec.agent.id)
      if (args.action === 'diagnose') {
        await definition.execute({action:'status'}, exec) // normal hydration/caller identity
        if (!diagnose) throw new Error('Read-only media diagnostics unavailable in this Host; no raw-shell fallback')
        return stamped(await diagnose(exec, {full: args.detail === 'full'}))
      }
      if (['repair','block'].includes(args.action) && (typeof args.note !== 'string' || args.note.trim().length < 8)) {
        return {ok:false,error:{code:'MISSING_DIAGNOSIS',message:'Use note or diagnosis with the concrete fault; neither was provided with enough detail.'},
          expected:{action:args.action,stage_id:engine.status(id)?.run?.stageId,note:'<actual fault and smallest correction>'}}
      }
      if (args.action === 'submit' && id) {
        const status = engine.status(id)
        if (!args.stage_id || args.stage_id !== status.run?.stageId) return copy({ok:false,error:{code:'STAGE_MISMATCH',message:'Submit only the current stage. Use repair to revisit an earlier stage; never repeat a failed future submission.'},
          current_stage_id:status.run?.stageId,current_state:status.run?.state,required_evidence:status.stage?.gate?.evidence,
          recovery:status.lastGate?.recovery,expected:{action:'submit',stage_id:status.run?.stageId,evidence:'<actual evidence matching the listed fields>'}})
      }
      let out
      try { out = await definition.execute(args, exec) }
      catch (error) {
        if (error.code === 'AUTOMATIC_WORK_BUDGET_EXHAUSTED') return stamped({ok:false,
          error:{code:error.code,message:error.message},status:compactStatus(engine.status(id)),
          nextAction:'report_bounded_work_progress',
          message:'本次用户指令下的自动尝试额度耗尽，不是用户返修次数用完。保留原任务、累计历史和验收标准；说明已完成工作和真实阻碍，明确用户续做指令可在原任务开启下一轮，不要求清空或新建。'})
        if (error.code === 'USER_REVIEW_REQUIRED') return stamped({ok:false,
          error:{code:error.code,message:error.message},status:compactStatus(engine.status(id)),
          nextAction:'await_direct_user_review',
          message:'候选尚未登记用户退回。聊天文字可触发评审，不必点击 UI；不要用 recover/取消/清空替代评审。若用户已明确退回仍未登记，报告运行版本、状态和实际错误。'})
        if (error.code !== 'SOURCE_READ_REFS') throw error
        return {ok:false,error:{code:error.code,message:error.message},availableReads:error.availableReads,
          nextAction:'retry_intake_with_observed_source_paths',expected:{action:'intake',project_id:args.project_id,requirements:args.requirements,source_paths:['<choose a task-source path from availableReads>']},
          message:'Use only actual current-session source paths/receipts. This is an Agent input correction, not a user cleanup task; no run was started or cleared.'}
      }
      const advisories = mediaWarnings(out.validation, engine.runs.get(id)?.previousCandidate)
      if (advisories.length) out.advisories = advisories
      if (args.detail === 'full') return stamped({...out,...(corrections.length?{argumentCorrections:corrections}:{})})
      const result = {...out}
      if (result.status) result.status = compactStatus(result.status)
      if (result.validation) result.validation = compactValidation(result.validation)
      if (result.message?.includes('\n')) result.message = result.message.split('\n')[0] // stage is already in status
      // An explicit failed probe result must not be rewritten into a retry loop.
      if (result.ok !== false && result.status?.lastGate?.recovery && !result.status.lastGate.recovery.continuedByUser) result.nextAction = result.status.lastGate.recovery.exhausted ? 'report_recovery_limit' : 'fix_indicated_dependency'
      if (result.ok !== false && result.status?.runtimeRecovery) result.nextAction = 'recover'
      if (result.recovered) result.nextAction = 'execute_current_stage'
      if (result.report) {
        const r=result.report
        result.report={run:r.run,summary:r.summary,recovery:r.lastGate?.recovery,blocker:r.blocker,
          candidates:(r.candidates??[]).map(c=>({revision:c.revision,at:c.at,video:c.artifacts?.video?.binding})),
          archivedRuns:r.archivedRuns,warning:r.warning,detail:'compact; detail=full or export_report preserves complete event history'}
        if (result.markdown) result.markdown='# Playbook system summary\n\n```json\n'+JSON.stringify(result.report,null,2)+'\n```\n'
      }
      if (corrections.length) result.argumentCorrections=corrections
      return stamped(result)
    },
  }
}

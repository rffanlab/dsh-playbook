/** Schema and pure gate checks for Host-generated media results (not model claims). */
export const MEDIA_KINDS = ['narration', 'pilot', 'video', 'handoff']
export function normalizeValidators(values = []) {
  if (!Array.isArray(values) || values.length > 4) throw new Error('gate.validators must contain at most four rules')
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('validator must be an object')
    for (const k of Object.keys(value)) if (!['kind', 'pathKey'].includes(k)) throw new Error(`unsupported validator field: ${k}`)
    if (!MEDIA_KINDS.includes(value.kind) || !/^[a-z][a-z0-9_]{0,63}$/.test(value.pathKey ?? '')) throw new Error('validator requires a supported kind and evidence pathKey')
    return { kind: value.kind, pathKey: value.pathKey }
  })
}
export function mediaIssues(stage, checks, run) {
  const issues = [], add = message => issues.push({ kind: 'verification', path: 'validators', message })
  for (const rule of stage.gate.validators ?? []) {
    const check = checks?.find(row => row.kind === rule.kind)
    if (!check || check.validatorVersion !== '0.4.0') { add(`${rule.kind}: missing Host validator result; a model assertion is not verification`); continue }
    if (check.passed !== true || check.status !== 'pass') {
      for (const failure of check.failures ?? ['Validation did not pass']) add(`${rule.kind}: ${failure}`)
      if (!check.failures?.length) add(`${rule.kind}: validation unavailable or failed`)
      continue
    }
    if (!check.bindings || !Object.keys(check.bindings).length || !check.narration?.scriptSha256) {
      add(`${rule.kind}: incomplete machine bindings`); continue
    }
    const accepted = run.machineEvidence ?? {}
    const script = Object.values(accepted).flat().find(item => item.kind === 'narration')
    if (rule.kind !== 'narration' && !script) add('Canonical narration has not passed its script gate')
    if (script && rule.kind !== 'narration' &&
        (check.narration.scriptSha256 !== script.narration.scriptSha256 || check.narration.segmentSha256 !== script.narration.segmentSha256)) {
      add('NARRATION_STALE: canonical script or exact segment texts changed; repair back to script, then repeat downstream work')
    }
    if (rule.kind === 'video' || rule.kind === 'handoff') {
      const old = run.previousCandidate?.video
      if (old?.binding?.sha256 && check.video?.binding?.sha256 !== old.binding.sha256 &&
          check.cover?.sha256 && check.cover.sha256 === run.previousCandidate?.cover?.sha256) {
        add('COVER_STALE: video changed but cover bytes equal the rejected version; regenerate/review the cover, remove stale duration claims')
      }
    }
    if (rule.kind === 'handoff') {
      const qa = Object.values(accepted).flat().find(item => item.kind === 'video')
      if (!qa || JSON.stringify(sortedBindings(qa.bindings)) !== JSON.stringify(sortedBindings(check.bindings))) {
        add('QA_STALE: artifacts differ from the accepted technical QA snapshot; return to qa before handoff')
      }
    }
  }
  return issues
}
function sortedBindings(bindings = {}) {
  return Object.keys(bindings).sort().map(path => [path, bindings[path].sha256, bindings[path].bytes])
}

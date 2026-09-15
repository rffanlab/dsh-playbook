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
    if (rule.kind === 'handoff') {
      const qa = Object.values(accepted).flat().find(item => item.kind === 'video')
      if (!qa || !sameMediaSnapshot(qa, check)) {
        add('QA_STALE: artifacts differ from the accepted technical QA snapshot; return to qa before handoff')
      }
    }
  }
  return issues
}
function sortedBindings(bindings = {}) {
  return Object.keys(bindings).sort().map(path => [path, bindings[path].sha256, bindings[path].bytes])
}

export function sameMediaSnapshot(qa, check) {
  const skipManifest = qa.manifestSignature && check.manifestSignature
  if (skipManifest && qa.manifestSignature !== check.manifestSignature) return false
  const bindings = row => Object.fromEntries(Object.entries(row.bindings ?? {}).filter(([path]) => !skipManifest || path !== row.manifestPath))
  return JSON.stringify(sortedBindings(bindings(qa))) === JSON.stringify(sortedBindings(bindings(check)))
}
export function mediaWarnings(checks, previous) {
  return (checks ?? []).flatMap(check => previous?.video?.binding?.sha256 &&
      check.video?.binding?.sha256 !== previous.video.binding.sha256 && check.cover?.sha256 &&
      check.cover.sha256 === previous.cover?.sha256
    ? ['COVER_REVIEW: unchanged cover may be reused when its title and claims still fit; check any duration text. Do not change a meaningless pixel to satisfy a hash rule.'] : [])
}

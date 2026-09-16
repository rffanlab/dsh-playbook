import { normalizeValidators } from './media-checks.js'
import { normalizeRouting } from './routing.js'
import { resultFailures } from './receipts.js'
import { isDeepStrictEqual } from 'node:util'

export const PLAYBOOK_SCHEMA_VERSION = 1
export const STAGE_MODES = new Set(['strict', 'guided', 'free'])
export const RUN_STATES = new Set(['active', 'blocked', 'awaiting_review', 'accepted', 'completed', 'failed', 'cancelled'])

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/

function fail(message) {
  throw new Error(message)
}

function clone(value) {
  return structuredClone(value)
}

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
  return value.trim()
}

function asStringArray(value, label) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const out = value.map((item, index) => asNonEmptyString(item, `${label}[${index}]`))
  return [...new Set(out)]
}

function normalizeEvidenceRule(rule, index, stageId) {
  if (typeof rule === 'string') {
    return { key: asNonEmptyString(rule, `stage ${stageId} gate evidence[${index}]`), type: 'any' }
  }
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    fail(`stage ${stageId} gate evidence[${index}] must be a string or object`)
  }
  for (const key of Object.keys(rule)) if (!['key', 'type', 'minLength', 'minItems', 'equals'].includes(key)) fail(`unsupported evidence rule field: ${key}`)
  const type = rule.type ?? 'any'
  if (!['any', 'string', 'number', 'boolean', 'array', 'object'].includes(type)) {
    fail(`stage ${stageId} gate evidence[${index}] has unsupported type ${String(type)}`)
  }
  const out = {
    key: asNonEmptyString(rule.key, `stage ${stageId} gate evidence[${index}].key`),
    type,
  }
  if (rule.minLength !== undefined) {
    if (!Number.isSafeInteger(rule.minLength) || rule.minLength < 0) fail(`stage ${stageId} gate evidence[${index}].minLength must be a non-negative integer`)
    out.minLength = rule.minLength
  }
  if (rule.minItems !== undefined) {
    if (!Number.isSafeInteger(rule.minItems) || rule.minItems < 0) fail(`stage ${stageId} gate evidence[${index}].minItems must be a non-negative integer`)
    out.minItems = rule.minItems
  }
  if (Object.hasOwn(rule, 'equals')) out.equals = clone(rule.equals)
  if (out.minLength !== undefined && type !== 'string') fail('minLength requires type string')
  if (out.minItems !== undefined && type !== 'array') fail('minItems requires type array')
  return out
}

function normalizeObservedToolRule(rule, index, stageId) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    fail(`stage ${stageId} gate observedTools[${index}] must be an object`)
  }
  const out = { name: asNonEmptyString(rule.name, `stage ${stageId} gate observedTools[${index}].name`) }
  for (const key of ['minCalls', 'minSuccesses', 'minFailures']) {
    const value = rule[key]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) fail(`stage ${stageId} gate observedTools[${index}].${key} must be a non-negative integer`)
    out[key] = value
  }
  if (out.minCalls === undefined && out.minSuccesses === undefined && out.minFailures === undefined) out.minCalls = 1
  return out
}

function normalizeGate(gate, stageId) {
  if (gate === undefined) return { evidence: [], observedTools: [] }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) fail(`stage ${stageId} gate must be an object`)
  for (const key of Object.keys(gate)) if (!['evidence', 'require', 'observedTools', 'toolResults', 'validators'].includes(key)) fail(`stage ${stageId}: unsupported gate field ${key}`)
  const validators = normalizeValidators(gate.validators)
  const toolResults = gate.toolResults ?? []
  if (!Array.isArray(toolResults)) fail('gate.toolResults must be an array')
  for (const rule of toolResults) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) fail('toolResults rule must be an object')
    for (const key of Object.keys(rule)) if (!['name', 'callIdKey', 'commandKey', 'command'].includes(key)) fail(`unsupported toolResults field ${key}`)
    if (rule.command !== undefined) asNonEmptyString(rule.command, 'toolResults.command')
    for (const key of ['name', 'callIdKey', 'commandKey']) asNonEmptyString(rule[key], `toolResults.${key}`)
  }
  const evidence = gate.evidence ?? gate.require ?? []
  const observedTools = gate.observedTools ?? []
  if (!Array.isArray(evidence)) fail(`stage ${stageId} gate evidence must be an array`)
  if (!Array.isArray(observedTools)) fail(`stage ${stageId} gate observedTools must be an array`)
  for (const rule of validators) if (!evidence.some(item => item?.key === rule.pathKey && item.type === 'string')) fail(`validator requires string evidence ${rule.pathKey}`)
  for (const rule of toolResults) for (const key of [rule.callIdKey, rule.commandKey]) {
    if (!evidence.some(item => item?.key === key && item.type === 'string')) fail(`toolResults requires string evidence rule for ${key}`)
  }
  return {
    validators,
    toolResults: clone(toolResults),
    evidence: evidence.map((rule, index) => normalizeEvidenceRule(rule, index, stageId)),
    observedTools: observedTools.map((rule, index) => normalizeObservedToolRule(rule, index, stageId)),
  }
}

function normalizeRetry(retry, stageId) {
  if (retry === undefined) return { maxAttempts: 1, onExhausted: 'fail' }
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) fail(`stage ${stageId} retry must be an object`)
  const maxAttempts = retry.maxAttempts ?? 1
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) fail(`stage ${stageId} retry.maxAttempts must be a positive integer`)
  const onExhausted = retry.onExhausted ?? 'fail'
  if (typeof onExhausted !== 'string' || (!['fail', 'explore'].includes(onExhausted) && !onExhausted.startsWith('branch:'))) {
    fail(`stage ${stageId} retry.onExhausted must be fail, explore, or branch:<stage-id>`)
  }
  return { maxAttempts, onExhausted }
}

function normalizeTools(tools, stageId) {
  if (tools === undefined) return { allow: undefined, deny: undefined }
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) fail(`stage ${stageId} tools must be an object`)
  const allow = asStringArray(tools.allow, `stage ${stageId} tools.allow`)
  const deny = asStringArray(tools.deny, `stage ${stageId} tools.deny`)
  const overlap = (allow ?? []).filter(name => (deny ?? []).includes(name))
  if (overlap.length) fail(`stage ${stageId} tools allow/deny overlap: ${overlap.join(', ')}`)
  return { allow, deny }
}

function normalizeStage(stage, index) {
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) fail(`stages[${index}] must be an object`)
  const id = asNonEmptyString(stage.id, `stages[${index}].id`)
  if (!ID_RE.test(id)) fail(`stage id ${id} must match ${ID_RE}`)
  const mode = stage.mode ?? 'guided'
  if (!STAGE_MODES.has(mode)) fail(`stage ${id} mode must be strict, guided, or free`)
  const objective = asNonEmptyString(stage.objective, `stage ${id} objective`)
  const instructions = asStringArray(stage.instructions, `stage ${id} instructions`) ?? []
  const next = stage.next === null ? null : stage.next === undefined ? undefined : asNonEmptyString(stage.next, `stage ${id} next`)
  const onFailure = stage.onFailure === null ? null : stage.onFailure === undefined ? undefined : asNonEmptyString(stage.onFailure, `stage ${id} onFailure`)
  return {
    id,
    title: stage.title === undefined ? id : asNonEmptyString(stage.title, `stage ${id} title`),
    mode,
    objective,
    instructions,
    tools: normalizeTools(stage.tools, id),
    gate: normalizeGate(stage.gate, id),
    retry: normalizeRetry(stage.retry, id),
    next,
    onFailure,
  }
}

export function normalizePlaybook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('playbook must be an object')
  const id = asNonEmptyString(input.id, 'playbook.id')
  if (!ID_RE.test(id)) fail(`playbook id ${id} must match ${ID_RE}`)
  const rawVersion = input.version ?? '1.0.0'
  if (typeof rawVersion !== 'string' && typeof rawVersion !== 'number') fail('playbook.version must be a string or number')
  if (!Array.isArray(input.stages) || input.stages.length === 0) fail('playbook.stages must be a non-empty array')
  const stages = input.stages.map(normalizeStage)
  const ids = new Set()
  for (const stage of stages) {
    if (ids.has(stage.id)) fail(`duplicate stage id: ${stage.id}`)
    ids.add(stage.id)
  }
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]
    if (stage.next === undefined) stage.next = stages[index + 1]?.id ?? null
    for (const [label, target] of [['next', stage.next], ['onFailure', stage.onFailure]]) {
      if (target !== undefined && target !== null && !ids.has(target)) fail(`stage ${stage.id} ${label} references unknown stage: ${target}`)
    }
    if (stage.retry.onExhausted.startsWith('branch:')) {
      const target = stage.retry.onExhausted.slice('branch:'.length)
      if (!ids.has(target)) fail(`stage ${stage.id} retry.onExhausted references unknown stage: ${target}`)
    }
  }
  const initialStage = input.initialStage ?? stages[0].id
  if (!ids.has(initialStage)) fail(`initialStage references unknown stage: ${initialStage}`)
  const delivery = normalizeDelivery(input.delivery, ids)
  return {
    ...(delivery ? { delivery } : {}),
    schemaVersion: PLAYBOOK_SCHEMA_VERSION,
    id,
    version: String(rawVersion),
    name: input.name === undefined ? id : asNonEmptyString(input.name, 'playbook.name'),
    description: input.description === undefined ? '' : String(input.description),
    goal: input.goal === undefined ? '' : String(input.goal),
    routing: normalizeRouting(input.routing),
    initialStage,
    stages,
  }
}

export function stageById(playbook, stageId) {
  return playbook.stages.find(stage => stage.id === stageId)
}

/** Empty placeholders are not evidence. false/zero remain meaningful values. */
function meaningful(value, depth = 0) {
  if (depth > 16 || value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0 && value.every(item => meaningful(item, depth + 1))
  if (typeof value === 'object') return Object.values(value).some(item => meaningful(item, depth + 1))
  return false
}
function typeMatches(value, type) {
  if (type === 'any') return meaningful(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'number') return Number.isFinite(value)
  return typeof value === type
}

/** Separate format repair from failed work/verification, without mutating a run. */
export function gateDiagnostics(stage, evidence = {}, observations = {}) {
  const issues = []
  const safe = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {}
  const issue = (kind, path, message) => issues.push({ kind, path, message })
  for (const rule of stage.gate.evidence) {
    const path = `evidence.${rule.key}`
    const value = Object.hasOwn(safe, rule.key) ? safe[rule.key] : undefined
    if (!typeMatches(value, rule.type)) { issue('format', path, `${path} must be ${rule.type}; received ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}. Expected shape: ${rule.type === 'array' ? '["actual observation"] (not {item:[...]})' : rule.type}`); continue }
    if (rule.type === 'string' && !value.trim()) issue('format', path, `${path} cannot be whitespace`)
    if (rule.minLength !== undefined && value.trim().length < rule.minLength) issue('format', path, `${path} length after trimming must be >= ${rule.minLength}`)
    if (rule.minItems !== undefined && value.length < rule.minItems) issue('format', path, `${path} items must be >= ${rule.minItems}`)
    if (Array.isArray(value) && value.some(item => !meaningful(item))) issue('format', path, `${path} contains empty placeholders (null, blank text or empty records)`)
    if (rule.type === 'object' && !meaningful(value)) issue('format', path, `${path} cannot be an empty record`)
    if (Object.hasOwn(rule, 'equals') && !isDeepStrictEqual(value, rule.equals)) issue('criterion', path, `${path} must equal ${JSON.stringify(rule.equals)}`)
  }
  for (const rule of stage.gate.observedTools) {
    const row = observations[rule.name] ?? { calls: 0, successes: 0, failures: 0 }
    for (const [minimum, count] of [['minCalls', 'calls'], ['minSuccesses', 'successes'], ['minFailures', 'failures']]) {
      if (rule[minimum] !== undefined && (row[count] ?? 0) < rule[minimum]) issue('observation', rule.name, `tool ${rule.name} ${count} ${row[count] ?? 0}/${rule[minimum]}`)
    }
  }
  for (const failure of resultFailures(stage.gate.toolResults, safe, observations)) issue('verification', 'toolResults', failure)
  return { passed: issues.length === 0, failures: issues.map(item => item.message), issues }
}

export function evaluateGate(stage, evidence = {}, observations = {}) {
  const { passed, failures } = gateDiagnostics(stage, evidence, observations)
  return { passed, failures }
}

export function toolPolicyDecision(stage, toolName, controllerToolName = 'playbook') {
  if (!stage || toolName === controllerToolName) return undefined
  const deny = stage.tools?.deny ?? []
  if (deny.includes(toolName)) return `Playbook stage "${stage.id}" denies tool "${toolName}".`
  if (toolName === 'run_code') return undefined // PTC transport; nested tools still pass this guard.
  if (stage.mode === 'strict' && Array.isArray(stage.tools?.allow) && !stage.tools.allow.includes(toolName)) {
    return `Playbook stage "${stage.id}" is strict; tool "${toolName}" is outside its allowlist.`
  }
  return undefined
}

export function publicStage(stage) {
  return {
    id: stage.id,
    title: stage.title,
    mode: stage.mode,
    objective: stage.objective,
    instructions: clone(stage.instructions),
    tools: clone(stage.tools),
    gate: clone(stage.gate),
    retry: clone(stage.retry),
    next: stage.next,
    onFailure: stage.onFailure,
  }
}

export function formatStageInstruction(stage, attempt = 1) {
  const lines = [
    `Stage: ${stage.id} (${stage.mode})`,
    `Objective: ${stage.objective}`,
    `Attempt: ${attempt}/${stage.retry.maxAttempts}`,
  ]
  if (stage.instructions.length) lines.push('Instructions:', ...stage.instructions.map(item => `- ${item}`))
  if (stage.gate.evidence.length) lines.push('Required evidence:', ...stage.gate.evidence.map(rule => `- ${rule.key}: ${JSON.stringify(rule)}`))
  if (stage.gate.validators?.length) lines.push('Independent Host checks run on submit: ' + stage.gate.validators.map(v => `${v.kind} from evidence.${v.pathKey}`).join(', '))
  if (stage.gate.toolResults?.length) lines.push('Required host command receipts (inspect status for call IDs):', ...stage.gate.toolResults.map(rule => `- ${rule.name}: evidence.${rule.callIdKey} + exact evidence.${rule.commandKey}; foreground exit 0 only`))
  if (stage.gate.observedTools.length) lines.push('Observed-tool requirements:', ...stage.gate.observedTools.map(rule => `- ${rule.name}: calls>=${rule.minCalls ?? 0}, successes>=${rule.minSuccesses ?? 0}, failures>=${rule.minFailures ?? 0}`))
  if (stage.mode === 'strict' && stage.tools.allow) lines.push(`Strict tool allowlist: ${stage.tools.allow.join(', ') || '(none)'}`)
  if (stage.tools.deny?.length) lines.push(`Denied tools: ${stage.tools.deny.join(', ')}`)
  lines.push('Do the actual work first. Evidence is a report of work, not a substitute for artifacts. Use action=check for a non-mutating preflight. Missing capabilities: action=block with a specific reason, never invent a pass.')
  lines.push('Do not claim this stage is complete in prose. Submit structured evidence through the playbook tool; only a passed gate advances the run.')
  return lines.join('\n')
}

/** Optional candidate/revision contract; old pinned workflows remain unchanged. */
function normalizeDelivery(value, ids) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('delivery must be an object')
  for (const key of Object.keys(value)) if (!['review', 'revisionStage', 'repairStages', 'maxRevisions', 'maxSelfRepairs'].includes(key)) fail(`unsupported delivery field: ${key}`)
  if (value.review !== true || !ids.has(value.revisionStage)) fail('delivery requires review=true and a valid revisionStage')
  const repairStages = asStringArray(value.repairStages, 'delivery.repairStages') ?? []
  if (!repairStages.length || repairStages.some(id => !ids.has(id))) fail('delivery repairStages must reference real stages')
  // Deprecated human cap is compatibility metadata only; null means no cap.
  const maxRevisions = value.maxRevisions ?? null, maxSelfRepairs = value.maxSelfRepairs ?? 3
  if (maxRevisions !== null && (!Number.isSafeInteger(maxRevisions) || maxRevisions < 1)) fail('legacy delivery.maxRevisions must be null or a positive integer')
  if (!Number.isSafeInteger(maxSelfRepairs) || maxSelfRepairs < 1 || maxSelfRepairs > 5) fail('delivery.maxSelfRepairs must be an integer 1..5')
  return { review: true, revisionStage: value.revisionStage, repairStages, maxRevisions, maxSelfRepairs }
}

/** Only unwrap the exact, lossless {item: Array} mistake seen in the experiment. */
export function repairEvidenceShape(stage, evidence) {
  const fixed = structuredClone(evidence), corrections = []
  for (const rule of stage.gate.evidence) {
    const v = fixed[rule.key]
    if (rule.type === 'array' && v && !Array.isArray(v) && typeof v === 'object' &&
        Object.keys(v).length === 1 && Object.hasOwn(v, 'item') && Array.isArray(v.item)) {
      fixed[rule.key] = v.item
      corrections.push({ path: `evidence.${rule.key}`, from: '{item: array}', to: 'array', lossless: true })
    }
  }
  return { evidence: fixed, corrections }
}

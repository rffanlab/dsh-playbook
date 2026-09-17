import { createHash } from 'node:crypto'
import { isAbsolute, normalize, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { normalizePlaybook } from './core.js'

const clone = value => structuredClone(value)
const idPattern = /^[a-z][a-z0-9_-]{0,47}$/
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
import { analyzeTask, selectionMismatch, recommendationFits } from './task-scope.js'
import { VIDEO_BASES, isVideoTask, mentionsSource } from './intake-policy.js'
export { VIDEO_BASES, INTAKE_READ_TOOLS, isVideoTask, mentionsSource, projectHint } from './intake-policy.js'
function string(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be nonblank and <= ${max} characters`)
  return value.trim()
}
function id(value, label) { if (!idPattern.test(value ?? '')) throw new Error(`${label} must match ${idPattern}`); return value }
function strings(value, label, required = true) {
  if (!Array.isArray(value) || value.length > 40 || (required && !value.length)) throw new Error(`${label} must be an array of ${required ? '1' : '0'}..40 strings`)
  return [...new Set(value.map(item => string(item, label))) ]
}
// maxRevisions is deprecated compatibility metadata, not a quality/automatic-work rule.
function deliveryContract(value) {
  if (!value) return value
  const { maxRevisions, ...contract } = value
  return contract
}
function own(object, key) { return Object.hasOwn(object ?? {}, key) ? object[key] : undefined }

/** Conservative static comparison. Text rewrites need review; semantic equivalence is not guessed. */
export function protectedChanges(base, proposed, baseRules = [], nextRules = []) {
  const changes = []
  if (base.initialStage !== proposed.initialStage) changes.push('initialStage changed')
  if (!isDeepStrictEqual(deliveryContract(base.delivery), deliveryContract(proposed.delivery))) changes.push('delivery/revision policy changed')
  for (const s of base.stages) {
    const n = proposed.stages.find(row => row.id === s.id)
    if (!n) { changes.push(`removed stage: ${s.id}`); continue }
    for (const key of ['mode', 'next', 'onFailure', 'retry', 'tools', 'objective']) {
      if (!isDeepStrictEqual(s[key], n[key])) changes.push(`${s.id}.${key} changed`)
    }
    for (const instruction of s.instructions) if (!n.instructions.includes(instruction)) changes.push(`${s.id}: removed/rewritten instruction: ${instruction.slice(0, 180)}`)
    for (const field of ['evidence', 'observedTools', 'toolResults', 'validators']) {
      for (const rule of s.gate[field] ?? []) if (!(n.gate[field] ?? []).some(x => isDeepStrictEqual(x, rule))) changes.push(`${s.id}.gate.${field}: removed/changed ${JSON.stringify(rule)}`)
    }
  }
  for (const rule of baseRules) if (!nextRules.includes(rule)) changes.push(`removed project requirement: ${rule}`)
  return [...new Set(changes)]
}
function validateGraph(p) {
  if (p.stages.length > 40) throw new Error('SOP exceeds 40 stages')
  const reached = new Set(), stack = [p.initialStage]
  while (stack.length) {
    const target = stack.pop()
    const s = p.stages.find(row => row.id === target)
    if (!s || reached.has(s.id)) continue
    reached.add(s.id)
    for (const to of [s.next, s.onFailure, s.retry.onExhausted.startsWith('branch:') ? s.retry.onExhausted.slice(7) : null]) if (to) stack.push(to)
  }
  if (!p.stages.some(s => reached.has(s.id) && s.next === null)) throw new Error('No reachable terminal stage')
  for (const s of p.stages) if (!s.gate.evidence.length && !(s.gate.validators?.length) && !(s.gate.toolResults?.length)) throw new Error(`Stage ${s.id} has no acceptance criteria`)
}

/** Plugin-owned state, scoped by Host cwd AND a business project ID. No model-supplied cwd. */
export class ProjectLibrary {
  constructor(engine, router) {
    this.engine = engine; this.router = router
    this.receipts = new Map(); this.prepared = new Map(); this.sourcesRequired = new Set()
  }
  scope(exec, projectId) {
    const sessionId = String(exec.agent?.id ?? exec.session?.id ?? '')
    const cwd = exec.agent?.session?.header?.cwd ?? exec.session?.header?.cwd
    if (!sessionId || typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Project SOPs require a Host-provided absolute session cwd; no process.cwd fallback')
    const workspace = normalize(cwd)
    const binding = own(this.engine.sopLibrary.bindings, sessionId)
    const selected = projectId ?? (binding?.workspace === workspace ? binding.projectId : null)
    id(selected, 'project_id')
    return { sessionId, workspace, projectId: selected, key: hash([workspace, selected]) }
  }
  capture(id, text, { attachment = false } = {}) {
    this.prepared.delete(String(id)); this.receipts.delete(String(id))
    if (mentionsSource(text) || attachment) this.sourcesRequired.add(String(id)); else this.sourcesRequired.delete(String(id))
  }
  observeRead(exec, result) {
    if (exec.name !== 'read' || result?.isError !== false || !exec.agent?.id) return
    const v = result.value
    if (typeof v?.path !== 'string' || !Array.isArray(v.lines) || !Number.isSafeInteger(v.totalLines) || !Number.isSafeInteger(v.offset)) return
    if (v.lines.some((line, i) => typeof line.text !== 'string' || line.number !== v.offset + i)) return
    const text = v.lines.map(line => line.text).join('\n')
    if (text.length > 150000 || v.lines.length > 5000) return
    const sid = String(exec.agent.id)
    if (!this.receipts.has(sid)) this.receipts.set(sid, new Map())
    const reads = this.receipts.get(sid)
    reads.set(String(exec.callId), { callId: String(exec.callId), path: v.path, start: v.offset,
      end: v.lines.at(-1)?.number ?? 0, totalLines: v.totalLines, text, sha256: hash(text),
      warning: 'Hash is of the returned read window, not a filesystem snapshot or proof of understanding.' })
    while (reads.size > 64) reads.delete(reads.keys().next().value)
  }
  sourceRows(sid, refs) {
    if (!Array.isArray(refs) || refs.length > 64) throw new Error('source_call_ids must be an array of <=64 observed read IDs')
    const rows = refs.map(ref => {
      const r = this.receipts.get(sid)?.get(ref)
      if (!r) { const e = new Error(`No observed read receipt ${ref}. Choose an actual current read path; do not invent or replay stale IDs.`); e.code='SOURCE_READ_REFS'; e.availableReads=this.readOptions(sid); throw e }
      return clone(r)
    })
    for (const path of new Set(rows.map(r => r.path))) {
      const windows = rows.filter(r => r.path === path).sort((a,b) => a.start-b.start)
      let end = 0
      for (const row of windows) { if (row.totalLines !== windows[0].totalLines || row.start > end + 1) throw new Error(`Incomplete read coverage: ${path}; continue reading the missing range`); end = Math.max(end, row.end) }
      if (end < windows[0].totalLines || !end) throw new Error(`Incomplete or empty document: ${path}`)
    }
    return rows
  }
  readOptions(sid) {
    return [...(this.receipts.get(sid)?.values() ?? [])].map(({callId,path,start,end,totalLines}) => ({callId,path,start,end,totalLines}))
  }
  refsForPaths(sid, paths, workspace) {
    if (!Array.isArray(paths) || paths.length > 16) throw new Error('source_paths must contain at most 16 actual read paths')
    const reads = [...(this.receipts.get(sid)?.values() ?? [])], refs=[]
    for (const p of paths) {
      string(p,'source_paths[]',4096)
      const absolute = resolve(workspace,p), found = reads.filter(r => resolve(workspace,r.path) === absolute)
      if (!found.length) { const e = new Error(`No current read for source path ${p}; read it first.`); e.code='SOURCE_READ_REFS'; e.availableReads=this.readOptions(sid); throw e }
      refs.push(...found.map(r=>r.callId))
    }
    return [...new Set(refs)]
  }
  async intake(exec, args) {
    const scope = this.scope(exec, args.project_id)
    const bound = own(this.engine.sopLibrary.bindings, scope.sessionId)
    if (bound?.workspace === scope.workspace && bound.projectId !== scope.projectId) throw new Error('This session is bound to project ' + bound.projectId + '; only an explicit user /playbook project use may switch it')
    if (this.engine.attachedRun(scope.sessionId) || this.engine.status(scope.sessionId).run?.state === 'failed') throw new Error('Cannot rebind/rewrite an active, failed or pending-review task; use repair or an explicit user new-task decision')
    const raw = string(this.router.session(scope.sessionId).pendingTask || args.task, 'original task', 24000)
    const refs = args.source_paths ? this.refsForPaths(scope.sessionId,args.source_paths,scope.workspace) : args.source_call_ids ?? []
    if (args.source_paths && args.source_call_ids?.length) throw new Error('Provide either source_paths or source_call_ids, not conflicting reference modes')
    const rows = this.sourceRows(scope.sessionId, refs)
    if ((this.sourcesRequired.has(scope.sessionId) || mentionsSource(raw)) && !rows.length) throw new Error('Referenced task sources must be read before intake; pass observed source_call_ids, not a claim that they were read')
    const requirements = strings(args.requirements, 'requirements')
    const taskScope = analyzeTask(raw, rows.map(r => r.text))
    const hint = taskScope.suggestedBase
    const existingProjects = Object.values(this.engine.sopLibrary.projects).filter(p => p.workspace === scope.workspace && Object.values(p.approved ?? {}).some(rev => VIDEO_BASES.has(hint) && VIDEO_BASES.has(p.records[rev]?.baseId) && (hint === 'taoist-culture-video') === (p.records[rev]?.baseId === 'taoist-culture-video')))
    if (bound?.source !== 'human' && existingProjects.length === 1 && existingProjects[0].projectId !== scope.projectId) throw new Error('A confirmed method already exists in project ' + existingProjects[0].projectId + '; reuse that project_id or ask for an explicit new-project decision, not a renamed scope')
    const prepared = { ...scope, task: raw, requirements, hint, taskScope, sourceTaskTexts: rows.map(r => r.text), sources: rows.map(({text,...meta}) => meta),
      sourceExcerpts: rows.map(row => row.text.slice(0,1200)), contractDigest: hash({ raw, requirements, sources: rows.map(r => r.sha256) }) }
    await this.engine.serialize(async () => {
      exec.signal?.throwIfAborted()
      this.engine.sopLibrary.bindings[scope.sessionId] = { workspace: scope.workspace, projectId: scope.projectId, source: bound?.source ?? 'agent' }
      await this.engine.save()
    })
    this.prepared.set(scope.sessionId, prepared)
    return { ok: true, project: { id: scope.projectId, workspace: scope.workspace }, contractDigest: prepared.contractDigest,
      suggestedBase: hint, taskScope, requirements, sources: prepared.sources, projectSops: this.list(exec),
      next: 'Choose by this task deliverable, not project name or media words in API examples. Reuse a compatible project SOP; if none applies, select a matching installed workflow or task-intake. No project rename, SOP rewrite or user unlock is needed to correct a pre-start classification.' }
  }
  taskScope(prepared, raw = '') {
    // Recompute before execution. A stale pre-start hint is never a protected
    // contract; active run snapshots are still immutable and cannot use this.
    return analyzeTask(prepared?.task || raw, prepared?.sourceTaskTexts ?? [])
  }
  assertApplicable(scope, baseId, definition) {
    const message = selectionMismatch(scope, baseId, definition)
    if (!message) return
    const error = new Error(message)
    error.code = 'SOP_TASK_MISMATCH'; error.taskScope = scope
    error.selectedBase = baseId; error.suggestedBase = scope.suggestedBase
    throw error
  }
  state(scope, create = false) {
    let p = own(this.engine.sopLibrary.projects, scope.key)
    if (!p && create) this.engine.sopLibrary.projects[scope.key] = p = { workspace: scope.workspace, projectId: scope.projectId, records: {}, approved: {}, history: [] }
    return p
  }
  list(exec) {
    let scope
    try { scope = this.scope(exec) } catch { return [] }
    const state = this.state(scope)
    return Object.values(state?.records ?? {}).map(r => ({ logicalId:r.logicalId, revision:r.revision, status:r.status, baseId:r.baseId, name:r.definition.name, stages:r.definition.stages.length, changes:r.changes.length, matchesCurrentTask:recommendationFits(this.prepared.has(scope.sessionId)?this.taskScope(this.prepared.get(scope.sessionId)):null,r.baseId), currentDefault:own(state?.approved,r.logicalId)===r.revision }))
  }
  inspect(exec, logicalId, revision) {
    const scope = this.scope(exec), state = this.state(scope)
    const candidates = Object.values(state?.records ?? {}).filter(r => r.logicalId === logicalId)
    const digest = revision || own(state?.approved, logicalId) || candidates.at(-1)?.revision
    const row = own(state?.records, digest)
    if (!row || row.logicalId !== logicalId) throw new Error('Unknown project SOP/revision in this workspace and project')
    if (hash(row.definition) !== row.definitionDigest) throw new Error('Stored SOP digest mismatch; refuse corrupted definition')
    return clone(row)
  }
  prepare(exec, args) {
    const scope = this.scope(exec), intake = this.prepared.get(scope.sessionId)
    if (!intake || intake.key !== scope.key) throw new Error('Read the task and call intake before authoring a SOP')
    const logicalId = id(args.sop_id, 'sop_id'), rules = strings(args.rules ?? [], 'rules', false)
    const state = this.state(scope), approvedDigest = own(state?.approved, logicalId)
    const approved = approvedDigest ? own(state.records, approvedDigest) : undefined
    const base = this.engine.getPlaybook(args.base_id ?? approved?.baseId)
    if (!base) throw new Error('base_id must name an installed built-in/legacy SOP; inspect it before deriving')
    this.assertApplicable(this.taskScope(intake), base.id, base)
    let raw = clone(args.definition ?? base)
    for (const key of Object.keys(raw)) if (!['schemaVersion','id','version','name','description','goal','routing','delivery','initialStage','stages'].includes(key)) throw new Error(`Unsupported SOP field: ${key}`)
    for (const stage of raw.stages ?? []) for (const key of Object.keys(stage)) if (!['id','title','mode','objective','instructions','tools','gate','retry','next','onFailure'].includes(key)) throw new Error(`Unsupported stage field: ${key}`)
    if (JSON.stringify(raw).length > 140000) throw new Error('SOP definition exceeds 140000 characters')
    if (args.stage_notes !== undefined) {
      if (!args.stage_notes || typeof args.stage_notes !== 'object' || Array.isArray(args.stage_notes)) throw new Error('stage_notes must be an object keyed by stage ID')
      for (const [sid, notes] of Object.entries(args.stage_notes)) {
        const stage = raw.stages?.find(s => s.id === sid); if (!stage) throw new Error(`Unknown stage ${sid}`)
        stage.instructions = [...(stage.instructions ?? []), ...strings(notes, `stage_notes.${sid}`)]
      }
    }
    raw.name = args.name ?? logicalId; raw.description = args.description ?? raw.description
    raw.id = logicalId; raw.version = 'draft'
    const definition = normalizePlaybook(raw); validateGraph(definition)
    const changes = [...protectedChanges(base, definition), ...(approved ? protectedChanges(approved.definition, definition, approved.rules, rules) : [])]
    if (approved && base.id !== approved.baseId) changes.push('approved base changed')
    const revision = hash({ definition, rules, parent: approvedDigest ?? null, baseId: base.id })
    definition.version = revision.slice(0, 12)
    return { scope, intake, definition, logicalId, revision, rules, changes: [...new Set(changes)], baseId: base.id, parentRevision: approvedDigest ?? null }
  }
  validate(exec, args) {
    const p = this.prepare(exec, args)
    return { ok: true, revision: p.revision, changes: p.changes, requiresApproval: !!p.changes.length,
      candidateStatus: p.changes.length ? 'draft' : 'trial', warning: 'Static structure checks do not prove that added prose is non-contradictory or expert-validated.' }
  }
  async save(exec, args) {
    return this.engine.serialize(async () => {
      exec.signal?.throwIfAborted()
      const p = this.prepare(exec, args), state = this.state(p.scope, true)
      const method = d => { const c = clone(d); delete c.version; return c }
      const existing = own(state.records, p.revision) ?? Object.values(state.records).find(r => r.logicalId === p.logicalId && r.baseId === p.baseId && isDeepStrictEqual(r.rules, p.rules) && isDeepStrictEqual(method(r.definition), method(p.definition)))
      if (existing) return { ok: true, reused: true, sop: this.inspect(exec, p.logicalId, existing.revision) }
      if (Object.keys(state.records).length >= 100) throw new Error('Project has 100 immutable versions; archive manually before adding more')
      const record = { logicalId: p.logicalId, revision: p.revision, definitionDigest: hash(p.definition), baseId: p.baseId,
        parentRevision: p.parentRevision, status: p.changes.length ? 'draft' : 'trial', rules: p.rules, changes: p.changes,
        definition: p.definition, sources: p.intake.sources, createdAt: new Date(this.engine.clock()).toISOString(),
        origin: p.intake.sources.length ? 'agent-extracted-from-read-source' : 'agent-authored-from-user-request' }
      state.records[p.revision] = record
      state.history.push({ type: 'sop_saved', revision: p.revision, status: record.status, at: record.createdAt })
      await this.engine.save()
      return { ok: true, sop_id: p.logicalId, revision: p.revision, status: record.status, changes: record.changes,
        next: record.status === 'draft' ? 'Protected rules changed; human approval of this exact revision is required. Do not weaken/relabel it as another SOP to execute.' : 'Trial saved for this project. It may be routed explicitly; successful task acceptance does not automatically approve it as a default.' }
    })
  }
  async approve(exec, logicalId, revision) {
    return this.engine.serialize(async () => {
      exec.signal?.throwIfAborted()
      string(revision, 'exact revision', 64)
      const scope = this.scope(exec), record = this.inspect(exec, logicalId, revision), state = this.state(scope)
      if (record.parentRevision !== (own(state.approved, logicalId) ?? null) && record.status !== 'approved') throw new Error('Approved parent changed since proposal; review a fresh proposal before approving')
      state.records[revision].status = 'approved'; state.approved[logicalId] = revision
      state.history.push({ type: 'human_sop_approved', logicalId, revision, changes: record.changes, at: new Date(this.engine.clock()).toISOString() })
      await this.engine.save()
      return { ok: true, sop_id: logicalId, revision, status: 'approved', scope: scope.projectId, activeRunsUnchanged: true }
    })
  }
  authorize(exec, selection) {
    const sid = String(exec.agent?.id), prepared = this.prepared.get(sid)
    const raw = this.router.session(sid).pendingTask || ''
    const required = isVideoTask(raw) || mentionsSource(raw) || VIDEO_BASES.has(selection.playbookId) || !!selection.sopId || this.sourcesRequired.has(sid)
    if (required && !prepared) throw new Error('Read-first selection: call intake with project_id, requirements and real source read IDs before selecting this task SOP')
    if (!prepared) {
      const taskScope = analyzeTask(raw || selection.task || '')
      this.assertApplicable(taskScope, selection.playbookId, this.engine.getPlaybook(selection.playbookId))
      return {input:{contract:{taskScope}}}
    }
    const scope = this.scope(exec)
    if (scope.key !== prepared.key) throw new Error('Project binding changed; redo intake')
    let definition, record
    if (selection.sopId) {
      record = this.inspect(exec, selection.sopId, selection.revision)
      if (record.status === 'draft') throw new Error('Draft changes protected requirements and is not executable until explicitly human-approved')
      const approved = Object.values(this.state(scope)?.approved ?? {}).map(rev => this.state(scope).records[rev])
      // Do not let a differently named trial replace an approved method for the same base.
      if (record.status !== 'approved' && approved.some(r => r.baseId === record.baseId || (VIDEO_BASES.has(r.baseId) && VIDEO_BASES.has(record.baseId)))) throw new Error('An approved project SOP exists for this base. A replacement trial needs explicit approval before execution')
      const latestApproved = own(this.state(scope)?.approved, record.logicalId)
      if (record.status === 'approved' && latestApproved !== record.revision) throw new Error('An older approved version cannot replace the current project default automatically')
      definition = clone(record.definition)
      if (record.status !== 'approved') {
        const base = this.engine.getPlaybook(record.baseId)
        if (!base || protectedChanges(base, definition).length) throw new Error('Base contract changed since this trial was saved; derive/review a new version')
      }
    } else {
      definition = this.engine.getPlaybook(selection.playbookId)
      if (!definition) throw new Error(`Unknown SOP ${selection.playbookId}`)
      const approved = Object.values(this.state(scope)?.approved ?? {}).map(rev => this.state(scope).records[rev])
      if (approved.some(r => r.baseId === definition.id || (VIDEO_BASES.has(r.baseId) && VIDEO_BASES.has(definition.id)))) throw new Error('Use the approved project SOP for this base, not a generic fallback; explicit human start remains available')
    }
    const baseId = record?.baseId ?? definition.id
    const taskScope = this.taskScope(prepared)
    this.assertApplicable(taskScope, baseId, definition)
    return { definition, input: { task: prepared.task, project: { id: scope.projectId, workspace: scope.workspace },
      contract: { digest: prepared.contractDigest, requirements: prepared.requirements, sources: prepared.sources, taskScope },
      sop: record ? { id: record.logicalId, revision: record.revision, status: record.status, baseId: record.baseId, rules: record.rules } : { id: definition.id, status: 'builtin', version: definition.version } } }
  }
  async bindHuman(exec, projectId) {
    const scope = this.scope(exec, projectId)
    return this.engine.serialize(async () => {
      exec.signal?.throwIfAborted()
      if (this.engine.attachedRun(scope.sessionId) || this.engine.status(scope.sessionId).run?.state === 'failed') throw new Error('Finish/cancel the current run before switching project')
      this.engine.sopLibrary.bindings[scope.sessionId] = { workspace: scope.workspace, projectId: scope.projectId, source: 'human' }
      await this.engine.save(); this.prepared.delete(scope.sessionId)
      return { ok:true, project:scope.projectId, workspace:scope.workspace, requiresFreshIntake:true }
    })
  }
  clear(id) { this.prepared.delete(String(id)); this.sourcesRequired.delete(String(id)) }
  view(exec) {
    const sid = String(exec.agent?.id ?? exec.session?.id ?? '')
    const reads = [...(this.receipts.get(sid)?.values() ?? [])].map(({text,...r}) => r)
    const cwd = exec.agent?.session?.header?.cwd ?? exec.session?.header?.cwd
    const availableProjects = typeof cwd === 'string' && isAbsolute(cwd) ? Object.values(this.engine.sopLibrary.projects).filter(p=>p.workspace===normalize(cwd)).map(p=>({projectId:p.projectId, approvedSops:Object.keys(p.approved), baseIds:[...new Set(Object.values(p.records).map(r=>r.baseId))]})) : []
    const prepared = this.prepared.get(sid)
    return { binding: clone(own(this.engine.sopLibrary.bindings,sid) ?? null), prepared: prepared ? {projectId:prepared.projectId, contractDigest:prepared.contractDigest, requirements:prepared.requirements, hint:this.taskScope(prepared).suggestedBase, taskScope:this.taskScope(prepared), sources:prepared.sources} : null, availableProjects, observedReads: reads, sops: this.list(exec) }
  }
}

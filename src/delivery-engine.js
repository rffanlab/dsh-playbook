import { createHash } from 'node:crypto'
import { WorkflowEngine } from './workflow-ux.js'
import { hasMediaContract, inside } from './run-isolation.js'
import { normalize } from 'node:path'

const clone = value => structuredClone(value)
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function candidateKey(run) {
  const c = run?.candidates?.at(-1)
  if (!c?.artifacts?.video?.binding || c.revision !== (run.revision ?? 0)) return null
  return digest([run.id, c.revision, c.at, c.artifacts])
}
export function candidateArtifacts(run) {
  const c = run?.candidates?.at(-1), key = candidateKey(run)
  if (!key) return []
  const video = c.artifacts.video.binding, cover = c.artifacts.cover
  return Object.values(c.artifacts.bindings ?? {}).map(file => ({
    ...clone(file), artifactId: 'artifact-' + digest([run.id, key, file.path, file.sha256]),
    runId: run.id, candidateKey: key, revision: c.revision,
    role: file.path === video.path ? 'video' : file.path === cover?.path ? 'cover' : 'checked-input',
    verifiedAt: c.at, verifiedInStage: Object.entries(run.machineEvidence ?? {}).findLast(([,checks]) => checks.some(check => check.passed && check.bindings?.[file.path]?.sha256 === file.sha256))?.[0] ?? null,
    producer: (run.productionWitnesses ?? []).findLast(w => w.outputs.some(out => out.path === file.path && out.sha256 === file.sha256))?.id ?? null,
  }))
}

/** Delivery state is separate from creative QC, user acceptance, and task classification. */
export class DeliveryEngine extends WorkflowEngine {
  async save() {
    // Only NEW media runs opt into production witnessing; pinned legacy runs are not relabelled.
    for (const [id, ticket] of this.starting) {
      const run = this.runs.get(id)
      if (run && run.id !== ticket.oldId && hasMediaContract(this.playbookForRun(run)))
        run.deliveryPolicy ??= { version: 1, videoProductionWitnessRequired: true }
    }
    const ledger = this.sopLibrary.deliveredVideoDigests ??= {}
    for (const run of this.allRuns()) {
      const c = run.candidates?.at(-1), video = c?.artifacts?.video?.binding
      if (video?.sha256 && /^[a-f0-9]{64}$/.test(video.sha256)) {
        ledger[video.sha256] ??= { runId: run.id, sessionId: run.sessionId, path: video.path, firstRecordedAt: c.at ?? run.updatedAt }
      }
    }
    await super.save()
  }
  knownOutputs(excludeRun) {
    return [...super.knownOutputs(excludeRun), ...Object.entries(this.sopLibrary.deliveredVideoDigests ?? {})
      .filter(([,row]) => row.runId !== excludeRun).map(([sha256,row]) => ({...row,sha256}))]
  }
  exclusions(run) {
    const workspace = run?.isolation?.workspace ?? run?.legacyContinuation?.workspace
    if (!workspace) return []
    const key = createHash('sha256').update(normalize(workspace)).digest('hex')
    return this.sopLibrary.outputExclusions?.[key] ?? []
  }
  async submit(id, options = {}) {
    const run = this.runs.get(String(id))
    if (run?.deliveryPolicy?.videoProductionWitnessRequired && options.runtimeChecks?.length) {
      options = {...options, runtimeChecks: options.runtimeChecks.map(value => {
        if (!['video','handoff'].includes(value.kind) || value.status !== 'pass') return value
        const file = value.video?.binding
        const proof = (run.productionWitnesses ?? []).findLast(w => w.runId === run.id && w.outputs.some(o => o.path === file?.path && o.sha256 === file?.sha256))
        return proof ? {...value, productionWitnessId:proof.id} : {...value, passed:false, status:'fail',
          failures:[...(value.failures ?? []),'PRODUCTION_NOT_WITNESSED: final video bytes have no observed production command in this run. Use playbook build for the real final assembly command; do not relabel an existing file or run a no-op. No user cleanup or new SOP is required.']}
      })}
    }
    return super.submit(id, options)
  }
  async recordProduction(id, expected, receipt) {
    return this.serialize(async () => {
      const run = this.runs.get(String(id))
      this.assertDeliveryRun(run, expected, ['active'])
      if (!receipt.outputs?.length || receipt.runId !== run.id || receipt.outcome !== 'exit-zero') throw new Error('INVALID_PRODUCTION_WITNESS')
      for (const file of receipt.outputs) {
        if (!inside(run.isolation?.realRoot, file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) throw new Error('INVALID_PRODUCTION_OUTPUT')
        if (this.knownOutputs(run.id).some(o => o.sha256 === file.sha256) || this.exclusions(run).some(o => o.sha256 === file.sha256))
          throw new Error('CROSS_RUN_DUPLICATE: this command produced bytes matching a known previous final; do not hide reuse by renaming or re-encoding')
      }
      ;(run.productionWitnesses ??= []).push(clone(receipt))
      run.history.push({type:'production_observed',at:receipt.observedAt,stageId:receipt.stageId,revision:receipt.revision,witnessId:receipt.id,callId:receipt.callId,commandSha256:receipt.commandSha256,outputs:clone(receipt.outputs)})
      await this.save()
    })
  }
  assertDeliveryRun(run, expected, states) {
    if (!run || !states.includes(run.state) || run.id !== expected.runId || (run.revision ?? 0) !== expected.revision || (run.stageEpoch ?? 0) !== expected.epoch)
      throw new Error('DELIVERY_TARGET_CHANGED: original run/stage/revision changed; no result can be claimed for the new task')
  }
  async recordDelivery(id, expected, receipt) {
    return this.serialize(async () => {
      const run = this.runs.get(String(id))
      this.assertDeliveryRun(run,expected,['awaiting_review','accepted','completed'])
      if (candidateKey(run) !== expected.candidateKey) throw new Error('DELIVERY_TARGET_CHANGED')
      const records = run.deliveries ??= []
      const index = records.findIndex(r => r.id === receipt.id)
      if (index < 0) records.push(clone(receipt)); else records[index] = clone(receipt)
      run.history.push({type:receipt.state === 'presented' ? 'artifact_delivery_presented' : 'artifact_delivery_prepared', at:receipt.presentedAt ?? receipt.preparedAt,deliveryId:receipt.id,candidateKey:receipt.candidateKey,revision:receipt.revision})
      await this.save()
    })
  }
  status(id) {
    const s = super.status(id), run = this.runs.get(String(id))
    if (!run || !hasMediaContract(this.playbookForRun(run))) return s
    s.artifactDelivery = { policy:clone(run.deliveryPolicy ?? {version:0,videoProductionWitnessRequired:false}),
      nextAction: ['awaiting_review','accepted','completed'].includes(run.state) ? 'deliver' : 'execute_current_stage',
      artifacts:candidateArtifacts(run).filter(a => a.role !== 'checked-input'),
      latest:(run.deliveries ?? []).filter(d => d.candidateKey === candidateKey(run)).at(-1) ?? null,
      message:'Final delivery uses the current verified candidate, never a filename search. deliver selects and seals exact bytes automatically. Source inspection is not model authorship proof.' }
    return s
  }
  report(id) {
    const out = super.report(id), run = this.runs.get(String(id))
    if (!run) return out
    return {...out, artifactRegistry:candidateArtifacts(run), productionWitnesses:clone(run.productionWitnesses ?? []), deliveries:clone(run.deliveries ?? []),
      deliveryLimit:'Witnesses associate actual command execution with changed output bytes, not semantic authorship or proof that shell code did not copy unknown external data. Snapshots are private fixed copies, not an OS security boundary.'}
  }
}

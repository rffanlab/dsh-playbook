import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isAbsolute, resolve, join } from 'node:path'
import { hasMediaContract, inside } from './run-isolation.js'
import { manifestPath } from './artifact-paths.js'
import { candidateArtifacts, candidateKey } from './delivery-engine.js'

const media = readFileSync(new URL('./media_worker.py',import.meta.url),'utf8')
const split = "if __name__ == '__main__':"
if (media.split(split).length !== 2) throw new Error('Unexpected media worker entrypoint')
const program = media.split(split)[0] + '\n' + readFileSync(new URL('./delivery_worker.py',import.meta.url),'utf8')
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
export function deliveryCommand(request) {
  const encoded = Buffer.from(JSON.stringify(request),'utf8').toString('base64')
  if (encoded.length >= 120000) throw new Error('DELIVERY_METADATA_TOO_LARGE: use a compact candidate/receipt, not full conversation evidence')
  return `python3 -I -c ${quote(program)} ${quote(encoded)}`
}
const json = value => JSON.parse(JSON.stringify(value))
const sha = value => createHash('sha256').update(value).digest('hex')
const expectedOf = run => ({runId:run.id,revision:run.revision??0,epoch:run.stageEpoch??0,candidateKey:candidateKey(run)})
const currentMedia = (engine,exec) => {
  const run=engine.runs.get(String(exec.agent?.id))
  return run && hasMediaContract(engine.playbookForRun(run)) ? run : null
}
function canonicalResult(result, callId) {
  const v=result.value
  if (result.isError!==false || v?.kind!=='foreground' || v.exitCode!==0 || v.signal!==null || v.aborted!==false || v.timedOut!==false || v.stdout?.truncated!==false || v.sandbox?.denied || v.sandbox?.runnerFailed) {
    const error=new Error('DELIVERY_HOST_FAILURE: fixed file operation failed; no old-file fallback or permission widening')
    error.hostFailure={callId,code:result.error?.info?.code??'UNVERIFIED_COMMAND',message:result.error?.message??`kind=${v?.kind}, exitCode=${v?.exitCode}`}
    throw error
  }
  const out=JSON.parse(v.stdout.text)
  if (out.protocol!==1 || out.passed!==true) throw new Error(out.error??'INVALID_DELIVERY_RECEIPT')
  return out
}

/** Only registered fixed IO receives a controller exemption; production commands never do. */
export function createArtifactDelivery(ctx,engine,ready=async()=>{}) {
  const pending=new Map(), jobs=new Map()
  function allows(exec) {
    const p=pending.get(exec.callId)
    if (p?.expected) {
      const run=engine.runs.get(String(exec.agent?.id))
      try {engine.assertDeliveryRun(run,p.expected,['awaiting_review','accepted','completed']);if(candidateKey(run)!==p.expected.candidateKey)return false} catch{return false}
    }
    return !!p && exec.agent===p.agent && exec.parent===p.parent && exec.rootCallId===p.rootCallId && exec.name===p.name && isDeepStrictEqual(exec.arguments,p.arguments)
  }
  async function dispatch(exec,name,args,{fixed=false,expected}={}) {
    if (!exec.agent || !exec.token || typeof ctx.tools.execute!=='function') throw new Error('DELIVERY_HOST_CONTEXT_REQUIRED: no raw filesystem or shell fallback')
    const input={callId:`${exec.callId}:artifact-${name}:${randomUUID()}`,rootCallId:exec.rootCallId??exec.callId,parent:exec.token,
      name,agent:exec.agent,signal:exec.signal,arguments:args}
    if(fixed) pending.set(input.callId,{...input,...(expected?{expected}:{})})
    try {
      const out=await ctx.tools.execute(input)
      for(const message of out.additionalContexts??[]) exec.deferContext?.(message)
      exec.signal?.throwIfAborted()
      return {out,callId:input.callId}
    } finally {pending.delete(input.callId)}
  }
  function scope(run) {
    if(run.isolation?.prepared) return {runId:run.id,isolation:run.isolation,workdir:run.isolation.realRoot}
    if(run.legacyContinuation) return {runId:run.id,legacyScope:run.legacyContinuation,workdir:run.legacyContinuation.workspace}
    throw new Error('DELIVERY_SCOPE_UNAVAILABLE: no recorded run-owned scope; do not guess/adopt another final. Use the existing same-run recovery where eligible.')
  }
  async function fixed(exec,run,request) {
    const {workdir,...ownership}=scope(run)
    const {out,callId}=await dispatch(exec,'bash',{command:deliveryCommand({...ownership,...request}),workdir,description:`Playbook artifact ${request.mode}: exact files only`,timeoutMs:120000},{fixed:true})
    return {receipt:canonicalResult(out,callId),callId}
  }
  async function build(exec,args) {
    await ready();await engine.queue;engine.noteCaller(exec)
    const run=currentMedia(engine,exec)
    if(!run || run.state!=='active' || !run.isolation?.prepared) throw new Error('Build requires the current active, prepared media run; do not reset the workflow')
    if(typeof args.command!=='string' || !args.command.trim() || args.command.length>32000) throw new Error('build requires the actual final assembly command')
    if(!Array.isArray(args.output_paths)||args.output_paths.length<1||args.output_paths.length>8) throw new Error('build requires 1..8 exact output_paths in this run')
    const paths=[...new Set(args.output_paths.map(path=>manifestPath(path,run.isolation).path))]
    if(paths.some(p=>inside(join(run.isolation.realRoot,'.deliveries'),p))) throw new Error('DELIVERED_SNAPSHOT_PROTECTED')
    const expected=expectedOf(run)
    const before=(await fixed(exec,run,{mode:'probe',paths,allowMissing:true})).receipt.outputs
    const startedAt = new Date(engine.clock()).toISOString()
    engine.assertDeliveryRun(engine.runs.get(String(exec.agent.id)),expected,['active'])
    const timeoutMs=args.timeout_ms??120000
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000) throw new Error('timeout_ms must be between 1000 and 600000')
    // Not fixed: original stage/tool/Host permissions apply to this entire user-work command.
    const {out,callId}=await dispatch(exec,'bash',{command:args.command,workdir:run.isolation.realRoot,description:'Execute current-run final assembly with before/after output observation',timeoutMs})
    const v=out.value
    if(out.isError!==false||v?.kind!=='foreground'||v.exitCode!==0||v.signal!==null||v.aborted!==false||v.timedOut!==false||v.sandbox?.denied||v.sandbox?.runnerFailed) return {
      ok:false,nextAction:'inspect_production_failure',hostFailure:{callId,code:out.error?.info?.code??'PRODUCTION_UNVERIFIED',message:out.error?.message??`kind=${v?.kind}; exitCode=${v?.exitCode}. A background acknowledgement is not completion.`},
      message:'No production witness registered. Do not substitute an old output. Generated assets may be retained; fix only the actual assembly error.'}
    engine.assertDeliveryRun(engine.runs.get(String(exec.agent.id)),expected,['active'])
    const after=(await fixed(exec,run,{mode:'probe',paths,allowMissing:false})).receipt.outputs
    const changed=after.filter((row,i)=>!before[i].exists||before[i].sha256!==row.sha256)
    const witnessed = row => (run.productionWitnesses??[]).some(w=>w.outputs.some(o=>o.path===row.path&&o.sha256===row.sha256))
    if(after.some((row,i)=>before[i].exists&&before[i].sha256===row.sha256&&!witnessed(row))) return {
      ok:false,nextAction:'execute_real_production',error:{code:'NO_NEW_PRODUCTION',message:'At least one declared output is unchanged and has no earlier same-run witness. Changing a dummy file cannot claim an old final.'}}
    if(!changed.length) {
      const already=after.every(row=>(run.productionWitnesses??[]).some(w=>w.outputs.some(o=>o.path===row.path&&o.sha256===row.sha256)))
      if(already) return {ok:true,reusedSameRunWitness:true,outputs:after,message:'Unchanged bytes retain their earlier same-run production witness; no regeneration required.'}
      return {ok:false,nextAction:'execute_real_production',error:{code:'NO_NEW_PRODUCTION',message:'Command exited zero but did not create/change declared bytes. A later echo/true cannot claim an existing final as newly generated.'}}
    }
    const witness={id:'build-'+randomUUID(),...expected,stageId:run.stageId,callId,commandSha256:sha(args.command),outcome:'exit-zero',
      startedAt,observedAt:new Date(engine.clock()).toISOString(),before,outputs:changed,hostSelectedModel:engine.callers.get(String(exec.agent.id))?.modelRoute??null,
      creationAttested:false,observation:'Declared output bytes observed before and after this real command. Not an assertion of semantic authorship.'}
    await engine.recordProduction(String(exec.agent.id),expected,witness)
    return {ok:true,witnessId:witness.id,callId,outputs:after,message:'Actual assembly and output hashes registered. Submit ordinary QA; this witness does not replace media or content checks.'}
  }
  async function deliver(exec,args={}) {
    await ready();await engine.queue;engine.noteCaller(exec)
    const run=currentMedia(engine,exec), key=candidateKey(run)
    if(!run||!key||!['awaiting_review','accepted','completed'].includes(run.state)) throw new Error('NO_VERIFIED_CANDIDATE: finish this run QC or use normal controlled repair; never search for an older final')
    const lock=run.id+':'+key
    if(jobs.has(lock)) return jobs.get(lock)
    const job=(async()=>{
      const expected=expectedOf(run), artifacts=candidateArtifacts(run)
      const checks=Object.values(run.machineEvidence??{}).flat()
      const check=checks.findLast(c=>c.kind==='handoff'&&c.passed)||checks.findLast(c=>c.kind==='video'&&c.passed)
      if(!check?.manifestPath||!check.bindings?.[check.manifestPath]) throw new Error('DELIVERY_BINDING_MISSING: recheck the existing candidate at QA to obtain its actual manifest binding; do not redo unrelated assets')
      const video=run.candidates.at(-1).artifacts.video.binding
      if(check.video?.binding?.sha256!==video.sha256) throw new Error('DELIVERY_TARGET_CHANGED: candidate and current QA disagree')
      if(engine.knownOutputs(run.id).some(f=>f.sha256===video.sha256)||engine.exclusions(run).some(f=>f.sha256===video.sha256)) throw new Error('CROSS_RUN_DUPLICATE: candidate bytes match known prior output; not an independent delivery')
      if(run.deliveryPolicy?.videoProductionWitnessRequired&&!artifacts.find(a=>a.role==='video')?.producer) throw new Error('PRODUCTION_NOT_WITNESSED: final assembly must be observed before candidate delivery')
      let record=(run.deliveries??[]).findLast(d=>d.candidateKey===key&&d.state==='prepared')
      if(!record) {
        // Only compact system facts go into argv. No arbitrary model prose/paths become authority.
        const report=engine.report(String(exec.agent.id))
        const systemReport='# Playbook system delivery report\n\n```json\n'+JSON.stringify({run:report.run,summary:report.summary,
          productionWitnesses:(report.productionWitnesses??[]).filter(w=>artifacts.some(a=>a.producer===w.id)),artifactRegistry:artifacts,warning:report.deliveryLimit},null,2)+'\n```\n'
        const extraPaths=(args.extra_paths??[]).map(p=>run.isolation?manifestPath(p,run.isolation).path:p)
        const requested={mode:'bundle',deliveryId:randomUUID(),candidateKey:key,revision:run.revision??0,
          manifestPath:check.manifestPath,bindings:check.bindings,video,
          artifactIds:Object.fromEntries(artifacts.map(a=>[a.path,a.artifactId])),extraPaths,systemReport,
          excludedVideoDigests:[...new Set([...engine.knownOutputs(run.id),...engine.exclusions(run)].map(r=>r.sha256))]}
        const {receipt,callId}=await fixed(exec,run,requested)
        if(receipt.runId!==run.id||receipt.candidateKey!==key||!Array.isArray(receipt.files)||receipt.files.length>8) throw new Error('INVALID_DELIVERY_RECEIPT')
        const root=run.isolation?.realRoot??scope(run).workdir
        for(const f of receipt.files) if(!inside(root,f.path)||!f.path.includes(`/.deliveries/${requested.deliveryId}/`)||!/^[a-f0-9]{64}$/.test(f.sha256??'')) throw new Error('INVALID_SNAPSHOT_PATH')
        record={id:requested.deliveryId,runId:run.id,revision:run.revision??0,candidateKey:key,state:'prepared',files:receipt.files,
          preparedAt:new Date(engine.clock()).toISOString(),snapshotCallId:callId,creationAttested:false}
        await engine.recordDelivery(String(exec.agent.id),expected,record)
      }
      await fixed(exec,run,{mode:'verify',files:record.files})
      engine.assertDeliveryRun(engine.runs.get(String(exec.agent.id)),expected,['awaiting_review','accepted','completed'])
      if(candidateKey(engine.runs.get(String(exec.agent.id)))!==key) throw new Error('DELIVERY_TARGET_CHANGED')
      const files=record.files.map(f=>({path:f.path,description:`${f.role} · ${f.artifactId} · sha256 ${f.sha256}`}))
      const {out,callId}=await dispatch(exec,'present',{files},{fixed:true,expected})
      if(out.isError!==false||!isDeepStrictEqual(out.value?.files,files)) return {ok:false,nextAction:'retry_verified_delivery',deliveryId:record.id,
        hostFailure:{callId,code:out.error?.info?.code??'PRESENT_UNVERIFIED',message:out.error?.message??'Host present response does not match requested snapshot files'},message:'Snapshot retained. No old-file fallback. Retry deliver after the actual Host issue is resolved, not production.'}
      const measured=await fixed(exec,run,{mode:'verify',files:record.files})
      record={...record,state:'presented',presentedAt:new Date(engine.clock()).toISOString(),presentCallId:callId,verifiedAfterPresentCallId:measured.callId}
      await engine.recordDelivery(String(exec.agent.id),expected,record)
      return {ok:true,delivered:true,runId:run.id,candidateKey:key,deliveryId:record.id,files:record.files,
        message:'Delivered fixed snapshots of this exact candidate, not mutable shared source paths. Candidate is not automatically user-accepted; no model-authorship claim.'}
    })()
    jobs.set(lock,job)
    try{return await job}finally{jobs.delete(lock)}
  }
  function guard(exec) {
    if(allows(exec)) return undefined
    const run=currentMedia(engine,exec)
    if(!run) return undefined // Code/docs/audio-only workflows are NOT subject to this media policy.
    if(['write','edit'].includes(exec.name)) {
      const path=exec.arguments?.file_path
      if(typeof path==='string' && path.split(/[\\/]/).includes('.deliveries')) return 'DELIVERED_SNAPSHOT_PROTECTED: edit the working source and revalidate; never overwrite a delivered copy'
    }
    if(!['present','present_file','present_files'].includes(exec.name)) return undefined
    const files=exec.arguments?.files
    if(!Array.isArray(files)||!files.length) return 'DELIVERY_SCHEMA_UNSUPPORTED: use playbook deliver for final output; no path guessing'
    const root=run.isolation?.realRoot
    const candidatePaths=new Set(candidateArtifacts(run).map(a=>a.path))
    for(const row of files) {
      if(typeof row.path!=='string'||!isAbsolute(row.path)||!root||!inside(root,resolve(row.path))) return 'DELIVERY_WRONG_RUN: requested file is not under this run root. Use playbook deliver; it selects exact registered artifacts automatically.'
      if(candidatePaths.has(resolve(row.path))||/\.(mp4|mkv|webm|mov|avi)$/i.test(row.path)) return 'USE_VERIFIED_DELIVERY: use playbook(action="deliver") for the current verified candidate; do not present a working/old final path. No user approval, cancellation or new Run is needed.'
      if(row.path.split(/[\\/]/).includes('.deliveries')) return 'USE_VERIFIED_DELIVERY: replay the registered delivery with playbook deliver, not a path-only reference'
    }
    return undefined // Current-root non-video previews/reports remain available without final-QC claims.
  }
  function wrap(definition) {
    return {...definition,timeoutMs:600000,
      description:definition.description+' For media final assembly use build(command,output_paths); declared outputs are measured before/after the real existing bash pipeline. After handoff use deliver; it automatically selects verified artifact IDs and fixed file copies. Never find/guess final.mp4. These actions do not require a user to approve a new SOP.',
      parameters:{...definition.parameters,action:{...definition.parameters.action,enum:[...definition.parameters.action.enum,'build','deliver','artifacts']},
        command:{type:'string',description:'build: actual foreground final assembly command; no-op/old-file fallback is not production.'},
        output_paths:{type:'array',items:{type:'string'},description:'build: 1..8 actual output paths under current run root, not a search pattern.'},
        timeout_ms:{type:'integer',description:'build command timeout, 1000..600000 milliseconds; original Host limits remain.'},
        extra_paths:{type:'array',items:{type:'string'},description:'deliver: optional one current-run auxiliary report; never a substitute video.'}},
      async execute(args,exec) {
        await ready()
        if(args.action==='build') return json(await build(exec,args))
        if(args.action==='deliver') return json(await deliver(exec,args))
        if(args.action==='artifacts') return json({ok:true,artifacts:candidateArtifacts(currentMedia(engine,exec)),delivery:engine.status(String(exec.agent?.id)).artifactDelivery})
        const result = await definition.execute(args,exec)
        // Normal final submission includes delivery; a presentation error must not
        // undo QC or send the Agent back through content production.
        if (args.action === 'submit' && result.gatePassed === true &&
            currentMedia(engine,exec) && candidateKey(currentMedia(engine,exec)) &&
            ['awaiting_review','completed'].includes(engine.status(String(exec.agent.id)).run?.state)) {
          try {
            const delivered = await deliver(exec,{})
            return json({...result,delivery:delivered,nextAction:delivered.ok?'report_delivered_candidate':'retry_verified_delivery'})
          } catch(error) {
            if (exec.signal?.aborted) throw error
            return json({...result,delivery:{ok:false,error:{message:error.message},...(error.hostFailure?{hostFailure:error.hostFailure}:{})},
              nextAction:'retry_verified_delivery',message:'QC state retained. Final attachment preparation failed: '+error.message+'. Use deliver to retry only delivery; do not regenerate or substitute old files.'})
          }
        }
        return result
      }}
  }
  return {build,deliver,guard,wrap,allows,clear:()=>{pending.clear();jobs.clear()}}
}

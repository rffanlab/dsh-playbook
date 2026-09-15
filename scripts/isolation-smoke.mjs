/** Simulated Host dispatch with REAL Python commands; no model or deployed DSH profile. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { install } from '../src/host.js'
const exec = promisify(execFile), workspace = await mkdtemp(join(tmpdir(),'dsh-owned-root-'))
const handlers = new Map(), guards = [], definitions = new Map(), commands = new Map()
let count=0
const ctx = {
  tools: { register: d=>definitions.set(d.name,d), guard:f=>guards.push(f), execute:async input=>{
    const call={...input,token:Symbol(),rootCallId:input.rootCallId??input.callId,deferContext:()=>{}}
    await handlers.get('tools/pre-execute')?.(call,async()=>({kind:'allow'}))
    const denial=guards.map(g=>g(call)).find(Boolean)
    let result
    if(denial) result={isError:true,message:denial}
    else if(input.name==='bash') {
      try {
        const output=await exec('bash',['-c',input.arguments.command],{cwd:input.arguments.workdir??workspace,timeout:30000,maxBuffer:2**20,signal:input.signal})
        result={isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{text:output.stdout,truncated:false},stderr:{text:output.stderr,truncated:false}}}
      }catch(error){result={isError:true,message:error.message}}
    } else result={isError:false,value:await definitions.get(input.name).execute(input.arguments,call)}
    handlers.get('tools/result')?.(call,result)
    return result
  }},
  systemPrompt:{section:()=>{}},commands:{register:c=>commands.set(c.name,c)},
  on:(event,f)=>handlers.set(event,f),effect:()=>{},inject:(_deps,f)=>f(ctx),provide:()=>{}
}
const engine=install(ctx,{define:d=>d,message:p=>({id:'notice',...p}),paths:{directory:join(workspace,'catalog'),state:join(workspace,'state.json')}})
const agent=id=>({id,session:{header:{cwd:workspace}},options:{provider:'fixture',model:'no-model-executed'}})
const signal=new AbortController().signal,a=agent('a'),b=agent('b')
const call=async(agent,args)=>{
  const r=await ctx.tools.execute({name:'playbook',callId:`call-${++count}`,agent,signal,arguments:args})
  assert.equal(r.isError,false,r.message);return r.value
}
try {
  await call(a,{action:'list'}) // wait for state hydration
  engine.register({id:'owned-media-fixture',stages:[{id:'script',objective:'Read an actual local script',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'narration',pathKey:'production_manifest'}]},retry:{maxAttempts:2},next:null}]})
  for(const item of [a,b]){
    const c=await commands.get('playbook').handler({agent:item,signal,rawInput:'start owned-media-fixture'})
    assert.equal(c.kind,'success',c.text)
    await call(item,{action:'workspace'})
  }
  const rootA=engine.status('a').isolation.realRoot,rootB=engine.status('b').isolation.realRoot
  assert.notEqual(rootA,rootB);assert.equal(a.session.header.cwd,workspace)
  assert.ok((await stat(join(rootA,'final'))).isDirectory())
  await writeFile(join(rootA,'brief/narration.txt'),'Real complete script.')
  await writeFile(join(rootA,'production.json'),JSON.stringify({schemaVersion:1,script:'brief/narration.txt',segments:[{id:'s',text:'Real complete script.'}]}))
  const passed=await call(a,{action:'submit',stage_id:'script',evidence:{production_manifest:join(rootA,'production.json')}})
  assert.equal(passed.gatePassed,true,JSON.stringify(passed))
  const rejected=await call(b,{action:'submit',stage_id:'script',evidence:{production_manifest:join(rootA,'production.json')}})
  assert.equal(rejected.gatePassed,false)
  assert.match(rejected.gate.failures.join(' '),/CROSS_RUN_PATH/)
  console.log('Real Python bootstrap + current-root validator + cross-run rejection passed through simulated Host dispatch. No deployed DSH/model claim.')

  // Rehydrate the precise *shape* of a v0.7.0 path-base incident. Reopening is
  // conditional on real file validation; no manual cancel or budget deletion.
  const held=engine.runs.get('b'), oldId=held.id, oldHistory=structuredClone(held.history)
  await writeFile(join(rootB,'brief/narration.txt'),'Actual narration retained in the current run.')
  await writeFile(join(rootB,'production.json'),JSON.stringify({schemaVersion:1,script:'brief/narration.txt',segments:[{id:'s',text:'Actual narration retained in the current run.'}]}))
  const relativeManifest=`.dsh-runs/${held.isolation.key}/production.json`
  held.state='failed';held.blocker=null;held.finishedAt=new Date().toISOString();held.lastGate={stageId:'script',passed:false,
    failures:[`narration: Missing artifact: ${relativeManifest}`],recovery:{code:'manifest',exhausted:true}}
  held.recoveryCounts={'0:script:manifest':3}
  // The user continuation must pass through pre-step before recovery, not just
  // a direct recovery call: this was the missing integration path in 0.7.1.
  const continuation={id:'continue-current-v3',source:{kind:'user'},content:[{type:'text',text:'继续生成 v3，保留文稿与素材。'}]}
  const resumedStep=await handlers.get('agent/pre-step')({agent:b,signal,messages:[continuation]},async()=>({kind:'enter',messages:[continuation]}))
  assert.match(resumedStep.messages.at(-1).content[0].text,/不是一次新接单/)
  assert.equal((await call(b,{action:'status'})).routing.pending,false)
  const recovered=await call(b,{action:'recover'})
  assert.equal(recovered.recovered,true,JSON.stringify(recovered));assert.equal(engine.runs.get('b').id,oldId)
  assert.deepEqual(engine.runs.get('b').history.slice(0,oldHistory.length),oldHistory)
  assert.equal(engine.runs.get('b').recoveryCounts['0:script:manifest'],3)
  assert.equal((await call(b,{action:'submit',stage_id:'script',evidence:{production_manifest:relativeManifest}})).gatePassed,true)

  // A pre-isolation user revision is continued in its recorded scope, not
  // discarded and not relabelled as a fresh independent-model experiment.
  const {mkdir,readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto')
  const legacyDir=join(workspace,'retained-episode'),legacyManifest=join(legacyDir,'production.json')
  await mkdir(legacyDir);await writeFile(join(legacyDir,'script.txt'),'Retained full spoken input.')
  await writeFile(legacyManifest,JSON.stringify({schemaVersion:1,script:'script.txt',segments:[{id:'s',text:'Retained full spoken input.'}]}))
  const hash=createHash('sha256').update(await readFile(legacyManifest)).digest('hex')
  const legacyBook=structuredClone(engine.getPlaybook('owned-media-fixture'));legacyBook.version='0.4.0'
  const reason='Independent media check unavailable: No prepared run-owned artifact root; legacy runs require a fresh task, not adoption of old outputs'
  const old={id:'legacy-run',sessionId:'legacy',playbookId:legacyBook.id,playbookVersion:'0.4.0',playbookSnapshot:legacyBook,
    state:'blocked',blocker:{kind:'prerequisite',reason},stageId:'script',stageEpoch:3,stageAttempt:1,revision:1,selfRepairs:0,
    startedAt:'2026-01-01T00:00:00Z',input:{task:'Fix ending, preserve approved speech.'},evidence:{},observations:{},machineEvidence:{},
    candidates:[{artifacts:{bindings:{[legacyManifest]:{path:legacyManifest,sha256:hash}}}}],
    history:[{type:'run_started'},{type:'human_review_rejected'}],revisions:[{reason:'Fix the ending.'}],
    lastGate:{stageId:'script',passed:false,failures:[reason]}}
  engine.runs.set('legacy',old);const l=agent('legacy')
  const continued=await call(l,{action:'workspace'})
  assert.equal(continued.status.active,true,JSON.stringify(continued));assert.equal(engine.runs.get('legacy').id,'legacy-run')
  assert.equal(engine.runs.get('legacy').isolation,undefined);assert.equal(continued.legacyContinuation.independentRun,false)
  assert.equal((await call(l,{action:'submit',stage_id:'script',evidence:{production_manifest:legacyManifest}})).gatePassed,true)
  assert.equal(createHash('sha256').update(await readFile(legacyManifest)).digest('hex'),hash)
  console.log('Real guarded Python recovery passed: existing failed run resumed; recorded legacy revision retained; no cancellation, no cleared counters, no bypassed Gate.')

} finally {await engine.queue;await rm(workspace,{recursive:true,force:true})}

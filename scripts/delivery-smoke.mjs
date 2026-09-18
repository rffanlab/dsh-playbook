/** Real FFmpeg generation -> real media QA -> guarded snapshot -> simulated native present.
 * No model, production credentials, browser, or live E5 is involved.
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { install } from '../src/host.js'
const exec=promisify(execFile),workspace=await mkdtemp(join(tmpdir(),'delivery-full-'))
const handlers=new Map(),guards=[],defs=new Map(),commands=new Map(),presented=[]
const ctx={tools:{register:d=>defs.set(d.name,d),guard:f=>guards.push(f),execute:async input=>{
 const call={...input,token:Symbol(),rootCallId:input.rootCallId??input.callId,deferContext:()=>{}}
 await handlers.get('tools/pre-execute')?.(call,async()=>({kind:'allow'}))
 const denied=guards.map(g=>g(call)).find(Boolean);let out
 if(denied)out={isError:true,error:{message:denied,info:{code:'DENIED'}}}
 else if(call.name==='bash'){
  try{const r=await exec('bash',['-c',call.arguments.command],{cwd:call.arguments.workdir??workspace,signal:call.signal,timeout:120000,maxBuffer:2**20});out={isError:false,value:{kind:'foreground',exitCode:0,signal:null,aborted:false,timedOut:false,stdout:{text:r.stdout,truncated:false}}}}
  catch(e){out={isError:true,error:{message:e.message,info:{code:String(e.code)}}}}
 }else if(call.name==='present'){presented.push(call.arguments.files);out={isError:false,value:{turn:1,files:call.arguments.files}}}
 else{try{out={isError:false,value:await defs.get(call.name).execute(call.arguments,call)}}catch(e){out={isError:true,error:{message:e.message}}}}
 handlers.get('tools/result')?.(call,out);return out
}},systemPrompt:{section:()=>{}},on:(n,f)=>handlers.set(n,f),commands:{register:c=>commands.set(c.name,c)},effect:()=>{},provide:()=>{},inject:(_n,f)=>f(ctx)}
const engine=install(ctx,{define:d=>d,message:p=>({id:'notice',...p}),paths:{directory:join(workspace,'catalog'),state:join(workspace,'state.json')}})
const agent={id:'s',session:{header:{cwd:workspace}},options:{model:'synthetic-no-model',provider:'fixture'}},signal=new AbortController().signal
let n=0
async function call(args){const r=await ctx.tools.execute({name:'playbook',agent,signal,callId:'p'+(++n),arguments:args});assert.equal(r.isError,false,JSON.stringify(r.error));assert.notEqual(r.value.ok,false,JSON.stringify(r.value));return r.value}
const hash=b=>createHash('sha256').update(b).digest('hex')
try{
 await call({action:'list'})
 engine.register({id:'delivery-smoke',stages:[
  {id:'script',objective:'Verify exact synthetic text',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'narration',pathKey:'production_manifest'}]}},
  {id:'produce',objective:'Produce real synthetic media',gate:{evidence:['output']}},
  {id:'qa',objective:'Verify actual audio/subtitles and deliver',gate:{evidence:[{key:'production_manifest',type:'string'}],validators:[{kind:'video',pathKey:'production_manifest'}]},next:null}],delivery:{review:true,revisionStage:'produce',repairStages:['produce','qa'],maxSelfRepairs:2}})
 const started=await commands.get('playbook').handler({agent,signal,rawInput:'start delivery-smoke'});assert.equal(started.kind,'success',started.text)
 await call({action:'workspace'})
 const root=engine.status('s').isolation.realRoot
 const manifest={schemaVersion:1,script:'brief/script.txt',segments:[{id:'s',text:'One synthetic segment.',audio:'artifacts/s.wav',start:0,end:2}],pilotVideo:'final/final.mp4',video:'final/final.mp4',cover:'final/cover.png',title:'final/title.md',subtitles:'final/captions.srt',durationSeconds:2,coverForVideoSha256:'pending'}
 await writeFile(join(root,'brief/script.txt'),'One synthetic segment.')
 await writeFile(join(root,'production.json'),JSON.stringify(manifest))
 assert.equal((await call({action:'submit',stage_id:'script',evidence:{production_manifest:join(root,'production.json')}})).gatePassed,true)
 const build=await call({action:'build',command:"ffmpeg -nostdin -v error -y -f lavfi -i sine=frequency=440:duration=2 artifacts/s.wav && ffmpeg -nostdin -v error -y -f lavfi -i testsrc2=s=160x90:r=8:d=2 -i artifacts/s.wav -c:v libx264 -threads 1 -c:a aac -t 2 final/final.mp4",output_paths:['final/final.mp4']})
 assert.ok(build.witnessId)
 await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=white:s=160x90','-frames:v','1','-threads','1',join(root,'final/cover.png')])
 await writeFile(join(root,'final/title.md'),'Synthetic technical fixture, not a quality benchmark.')
 await writeFile(join(root,'final/captions.srt'),'1\n00:00:00,000 --> 00:00:02,000\nOne synthetic segment.\n')
 manifest.coverForVideoSha256=hash(await readFile(join(root,'final/final.mp4')))
 await writeFile(join(root,'production.json'),JSON.stringify(manifest))
 await call({action:'submit',stage_id:'produce',evidence:{output:'Real FFmpeg fixture assembled under this run.'}})
 const delivered=await call({action:'submit',stage_id:'qa',evidence:{production_manifest:join(root,'production.json')}})
 assert.equal(delivered.gatePassed,true,JSON.stringify(delivered));assert.equal(delivered.delivery.delivered,true,JSON.stringify(delivered))
 assert.equal(presented.length,1);assert.equal(delivered.delivery.files.length,7)
 const video=delivered.delivery.files.find(f=>f.role==='video')
 assert.equal(hash(await readFile(video.path)),manifest.coverForVideoSha256)
 await writeFile(join(root,'final/final.mp4'),'old contents replaced working final')
 assert.equal(hash(await readFile(video.path)),manifest.coverForVideoSha256)
 const wrong=await ctx.tools.execute({name:'present',agent,signal,callId:'wrong',arguments:{files:[{path:join(workspace,'final.mp4')}]}})
 assert.equal(wrong.isError,true);assert.equal(presented.length,1)
 assert.equal(engine.status('s').run.state,'awaiting_review')
 console.log('PASS: actual FFmpeg build + real media/subtitle QA + automatic immutable-path snapshot + guarded present + post-source overwrite isolation. Same run, no manual file selection.')
 console.log('Host transport is simulated. No browser, E5, model authorship or production-quality claim.')
}finally{await engine.queue;await exec('chmod',['-R','u+w',workspace]);await rm(workspace,{recursive:true,force:true})}

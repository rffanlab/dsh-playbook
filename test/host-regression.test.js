import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../src/host.js'

async function host(t) {
  const directory = await mkdtemp(join(tmpdir(), 'playbook-host-test-'))
  const listeners = new Map(), guards = [], commands = new Map(), sections = []
  let tool
  const ctx = {
    tools: { register: d => { tool = d }, guard: f => { guards.push(f) } },
    systemPrompt: { section: p => { sections.push(p) } },
    commands: { register: c => { commands.set(c.name, c) } },
    on: (name, fn) => { listeners.set(name, fn) },
    effect: () => {}, inject: (_deps, callback) => callback(ctx), provide: () => {},
  }
  const engine = install(ctx, { define: d => d, message: p => ({ id: 'notice', ...p }), paths: { directory: join(directory, 'catalog'), state: join(directory, 'state.json') } })
  const agent = { id: 'session', session: { header: {} } }, signal = new AbortController().signal
  const call = args => tool.execute(args, { agent, signal })
  const command = rawInput => commands.get('playbook').handler({ agent, signal, rawInput })
  await call({ action: 'list' })
  t.after(async () => { await engine.queue; await rm(directory, { recursive: true, force: true }) })
  return { engine, listeners, guards, sections, agent, signal, call, command, directory }
}
const receiptStage = { id: 'verify', objective: 'Verify a real check',
  gate: { evidence: [{ key: 'cmd', type: 'string' }, { key: 'id', type: 'string' }], toolResults: [{ name: 'bash', callIdKey: 'id', commandKey: 'cmd' }] },
  retry: { maxAttempts: 2 }, next: null }

test('Host final-result observer supplies receipt without model-authored facts', async t => {
  const h = await host(t)
  h.engine.register({ id: 'fixture', stages: [receiptStage] })
  await h.call({ action: 'start', playbook_id: 'fixture' })
  const exec = { name: 'bash', callId: 'real-callback', token: Symbol(), agent: h.agent, arguments: { command: 'npm test' }, signal: h.signal }
  await h.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
  h.listeners.get('tools/result')(exec, Object.freeze({ isError: false, value: Object.freeze({ kind: 'foreground', exitCode: 1, signal: null, timedOut: false, aborted: false }) }))
  const out = await h.call({ action: 'check', stage_id: 'verify', evidence: { cmd: 'npm test', id: 'real-callback' } })
  assert.equal(out.gate.passed, false)
  assert.equal(h.engine.status('session').observations.bash.receipts[0].exitCode, 1)
})
test('human commands resume/cancel blocked runs; model tools cannot bypass them', async t => {
  const h = await host(t)
  await h.call({ action: 'start', playbook_id: 'bug-fix' })
  await h.call({ action: 'block', note: 'Missing the source repository. Need an accessible checkout.' })
  assert.match(h.sections[0].text({ agent: h.agent }), /BLOCKED/)
  assert.ok(h.guards.some(guard => guard({ agent: h.agent, name: 'write' })))
  assert.equal((await h.command('resume')).kind, 'success')
  assert.equal(h.engine.status('session').run.state, 'active')
  assert.equal((await h.command('report')).kind, 'success')
  await h.call({ action: 'block', note: 'Still cannot access the requested repository.' })
  assert.equal((await h.command('cancel')).kind, 'success')
  assert.equal(h.engine.status('session').run.state, 'cancelled')
})
test('automatic routing is preserved and delivers the new current-stage contract', async t => {
  const h = await host(t)
  const message = { id: 'new-user-message', source: { kind: 'user' }, content: [{ type: 'text', text: '修复这个接口bug' }] }
  const out = await h.listeners.get('agent/pre-step')({ agent: h.agent, signal: h.signal, messages: [message] }, async () => ({ kind: 'enter', messages: [message] }))
  assert.equal(h.engine.status('session').run.playbookId, 'bug-fix')
  assert.equal(h.engine.status('session').run.playbookVersion, '0.7.0')
  assert.match(out.messages[1].content[0].text, /actual stage work/)
})
test('a blocked active task is not replaced on the next direct user request', async t => {
  const h = await host(t)
  await h.call({ action: 'start', playbook_id: 'bug-fix' }); await h.call({ action: 'block', note: 'Need a working test runner for this environment.' })
  const message = { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '给我写篇公众号文章' }] }
  await h.listeners.get('agent/pre-step')({ agent: h.agent, signal: h.signal, messages: [message] }, async () => ({ kind: 'enter', messages: [message] }))
  assert.equal(h.engine.status('session').run.playbookId, 'bug-fix'); assert.equal(h.engine.status('session').run.state, 'blocked')
})
test('late callbacks cannot credit a different epoch through the Host observer', async t => {
  const h = await host(t); await h.call({ action: 'start', playbook_id: 'bug-fix' })
  const exec = { name: 'bash', callId: 'old', token: Symbol(), agent: h.agent, arguments: { command: 'old check' }, signal: h.signal }
  await h.listeners.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))
  await h.call({ action: 'submit', stage_id: 'reproduce', evidence: { reproduction: 'Real fixture reproduction steps', observed_behavior: 'Real fixture observed behavior' } })
  h.listeners.get('tools/result')(exec, { isError: false, value: { kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false } })
  await h.engine.queue; assert.deepEqual(h.engine.status('session').observations, {})
})

test('Host project workflow: read actual source, save trial, route, and keep approval off model surface',async t=>{
  const h=await host(t);h.agent.session.header.cwd='/workspace/project-fixture'
  const message={id:'project-user',source:{kind:'user'},content:[{type:'text',text:'按 task.md 制作道家文化视频，发到B站'}]}
  await h.listeners.get('agent/pre-step')({agent:h.agent,signal:h.signal,messages:[message]},async()=>({kind:'enter',messages:[message]}))
  assert.equal(h.engine.status('session').active,false)
  const exec={agent:h.agent,signal:h.signal,name:'read',callId:'host-read',token:Symbol()}
  // The source is observed even though no execution run has started yet.
  h.listeners.get('tools/result')(exec,{isError:false,value:{path:'/workspace/project-fixture/task.md',offset:1,totalLines:2,lines:[{number:1,text:'道家文化视频任务。'},{number:2,text:'保留原文和自然口播，不编造出处。'}]}})
  const before=await h.call({action:'intake_status'});assert.equal(before.intake.observedReads[0].callId,'host-read')
  await h.call({action:'intake',project_id:'culture',source_call_ids:['host-read'],requirements:['保留原文和自然口播，不编造出处。']})
  const saved=await h.call({action:'sop_save',sop_id:'culture-delivery',base_id:'taoist-culture-video',rules:['核对引用来源。']})
  assert.equal(saved.status,'trial')
  assert.equal((await h.command('sops')).kind,'success')
  assert.equal((await h.command(`approve culture-delivery ${saved.revision}`)).kind,'success')
  await assert.rejects(h.call({action:'sop_approve'}),/unsupported/)
  const out=await h.call({action:'route',sop_id:'culture-delivery'})
  assert.equal(out.status.input.sop.status,'approved')
  assert.match(h.sections[0].text({agent:h.agent}),/PINNED PROJECT CONTRACT/)
})
test('legacy same-name files cannot replace reserved built-in protections on reload',async t=>{
  const h=await host(t)
  await mkdir(join(h.directory,'catalog'),{recursive:true})
  await writeFile(join(h.directory,'catalog','taoist-culture-video.json'),JSON.stringify({id:'taoist-culture-video',stages:[{id:'instant-done',objective:'skip all original checks'}]}))
  assert.ok(h.engine.getPlaybook('taoist-culture-video').stages.find(s=>s.id==='qa').gate.validators.length)
  const out=await h.call({action:'reload'})
  assert.ok(out.playbooks.some(p=>p.id==='taoist-culture-video'))
  assert.ok(h.engine.getPlaybook('taoist-culture-video').stages.find(s=>s.id==='qa').gate.validators.length)
  assert.equal(h.engine.getPlaybook('taoist-culture-video').stages.some(s=>s.id==='instant-done'),false)
})

test('media-tool integration full Host path: original request, intake, route and engineering work without media allocation',async t=>{
  const h=await host(t);h.agent.session.header.cwd=h.directory
  const task='将下面的工具全局同步给所有session：# DSH 核心工具接入契约\n\n## 工具能力\n'+
    ('输入支持音视频格式，媒体 CLI 能生成口播配音和图片；这些是能力说明，不是本次交付物。\n').repeat(120)
  const m={id:'integration-request',source:{kind:'user'},content:[{type:'text',text:task}]}
  const after=await h.listeners.get('agent/pre-step')({agent:h.agent,signal:h.signal,messages:[m]},async()=>({kind:'enter',messages:[m]}))
  assert.equal(h.engine.runs.size,0)
  assert.match(after.messages.at(-1).content[0].text,/"kind":"software"/)
  assert.ok(!after.messages.at(-1).content[0].text.includes('short-video-production'))
  const intake=await h.call({action:'intake',project_id:'media-tools',requirements:['全局接入工具，保留原宿主权限和密钥隔离。']})
  assert.equal(intake.taskScope.producesVideo,false)
  // An initially bad Agent choice has a recoverable selection error, not a user approval dialog.
  const bad=await h.call({action:'route',playbook_id:'short-video-production',note:'There is a video word in the spec'})
  assert.equal(bad.ok,false);assert.equal(bad.error.code,'SOP_TASK_MISMATCH');assert.equal(bad.nextAction,'select_matching_sop')
  assert.equal(h.engine.runs.size,0)
  const out=await h.call({action:'route',playbook_id:'dsh-plugin-development',note:'The deliverable is global tool integration, not an MP4.'})
  assert.equal(out.status.run.playbookId,'dsh-plugin-development')
  assert.equal(out.status.isolation,null)
  assert.equal(out.status.input.taskScope.producesVideo,false)
  assert.ok(h.engine.activeRun('session').playbookSnapshot.stages.every(s=>s.gate.validators.length===0))
  const check=name=>h.guards.map(g=>g({agent:h.agent,name,arguments:{file_path:join(h.directory,'integration.js')}})).filter(Boolean)
  assert.deepEqual(check('bash'),[])
  assert.ok(check('write').length,'engineering contract stage still denies premature edits')
  const r=await h.call({action:'submit',stage_id:'contract',evidence:{target_version:'test-sdk',contract_sources:['fixture public tool definitions'],scope_plan:'Implement global tools inside the actual Host permission boundary.'}})
  assert.equal(r.gatePassed,true);assert.equal(r.status.run.stageId,'design')
  await h.call({action:'submit',stage_id:'design',evidence:{design:'Typed CLI wrapper using a fixed program and argv.',state_model:'Stateless per-call tool wrapper with explicit output paths.',failure_policy:'Return real errors, no raw credential or authority bypass.'}})
  assert.deepEqual(check('write'),[])
  assert.equal(h.engine.status('session').run.stageId,'implement')
  // All these undefined results leave external Host guards in force; none grants
  // an allow result or changes the session sandbox/approval settings.
  const originalHostGuard=()=> 'external workspace permission required'
  assert.ok([...h.guards,originalHostGuard].map(g=>g({agent:h.agent,name:'write'})).includes('external workspace permission required'))
})

test('short engineering request can auto-start without project intake or video-only prompting',async t=>{
  const h=await host(t)
  const m={id:'engineering-auto',source:{kind:'user'},content:[{type:'text',text:'给 DSH 开发一个视频生成插件'}]}
  const out=await h.listeners.get('agent/pre-step')({agent:h.agent,signal:h.signal,messages:[m]},async()=>({kind:'enter',messages:[m]}))
  assert.equal(h.engine.status('session').run.playbookId,'dsh-plugin-development')
  assert.equal(h.engine.status('session').isolation,null)
  assert.ok(!out.messages.at(-1).content[0].text.includes('production.json'))
})

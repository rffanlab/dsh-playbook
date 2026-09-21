import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_PLAYBOOKS } from '../src/builtins.js'
import { PlaybookEngine } from '../src/engine.js'
import { normalizeRouting, recommendPlaybook, PlaybookRouter } from '../src/routing.js'
const fixture = () => { const e = new PlaybookEngine(); for (const p of BUILTIN_PLAYBOOKS) e.register(p); return e }
const cases = [
  ['修复这个接口的分页bug', 'bug-fix'], ['Fix this code defect', 'bug-fix'],
  ['帮我增加一个分页查询接口', 'feature-development'], ['Implement an export feature', 'feature-development'],
  ['开发一个 Chrome 插件', 'plugin-development'], ['Build an editor extension', 'plugin-development'],
  ['给DSH开发一个图片管理插件', 'dsh-plugin-development'], ['Implement a DeepSeek Harness plugin', 'dsh-plugin-development'],
  ['审一下这个PR的代码', 'code-review'], ['Review this diff', 'code-review'],
  ['准备发布这个插件的新版本', 'release'], ['Prepare an npm release', 'release'],
  ['DeepSeek Harness 启动不了了，帮我修一下', 'incident-response'], ['Restore the production service after an outage', 'incident-response'],
  ['在Ubuntu上部署一个systemd服务', 'linux-service-deploy'], ['Deploy this service on Linux', 'linux-service-deploy'],
  ['在Ubuntu部署Qwen GGUF模型', 'model-deployment'], ['Serve a local model with vLLM', 'model-deployment'],
  ['帮我做一条道家文化短视频', 'taoist-culture-video'], ['Produce a short video about this experiment', 'short-video-production'],
  ['帮我做一期B站本地模型实测视频', 'bilibili-video-production'], ['Produce a Bilibili tutorial', 'bilibili-video-production'],
  ['帮我审一下这个视频', 'video-review'], ['Review the rendered video', 'video-review'],
  ['帮我写篇公众号介绍这个插件', 'wechat-article'], ['Write a WeChat article', 'wechat-article'],
  ['帮我创作一首原创歌曲', 'music-production'], ['Produce an original song', 'music-production'],
  ['整理这批歌曲的汽水上传包', 'music-release'], ['Prepare these tracks for music release', 'music-release'],
  ['帮我调研这些本地推理方案', 'research-report'], ['Research the market and competitors', 'research-report'],
  ['分析这几天的播放数据', 'data-analysis'], ['Analyze this CSV dataset', 'data-analysis'],
  ['把所有SOP补全', 'sop-authoring'], ['Design a playbook for our workflow', 'sop-authoring'],
]
for (const [task, expected] of cases) test(`route: ${task}`, () => {
  assert.equal(recommendPlaybook(task, fixture().listPlaybooks()).recommendedId, expected)
})
test('chat and usage questions do not start workflows', () => {
  for (const task of ['谢谢老哥', '你好', 'Playbook 怎么用？', '如何部署模型？', 'What is a plugin?', '怎么生成歌曲']) assert.equal(recommendPlaybook(task, fixture().listPlaybooks()).kind, 'conversation')
})
test('an article about plugin development routes by deliverable, not topic', () => {
  assert.equal(recommendPlaybook('帮我写一篇公众号文章，介绍如何开发DSH插件', fixture().listPlaybooks()).recommendedId, 'wechat-article')
})
test('quoted logs and negative clauses do not hijack routing', () => {
  assert.equal(recommendPlaybook('不要生成歌曲，帮我修复接口bug\n```\n帮我制作B站视频\n```', fixture().listPlaybooks()).recommendedId, 'bug-fix')
})
test('multiple work products require semantic selection rather than silent single-SOP coverage', () => {
  const d = recommendPlaybook('修复bug并写篇公众号', fixture().listPlaybooks())
  assert.equal(d.kind, 'ambiguous'); assert.equal(d.recommendedId, null)
})
test('router validates metadata and does not accept executable matchers', () => {
  for (const r of [{ regex: '.*' }, { groups: [[]] }, { priority: 999 }, { autoStart: 'yes' }]) assert.throws(() => normalizeRouting(r))
})
test('custom JSON routing survives normalization and participates in matching', () => {
  const e = fixture(); e.register({ id: 'invoice-check', routing: { groups: [['核对'], ['发票']], priority: 25 }, stages: [{ id: 'inspect', objective: 'Verify invoices' }] })
  assert.equal(recommendPlaybook('请核对这批发票', e.listPlaybooks()).recommendedId, 'invoice-check')
})
test('recommend is read-only; route starts once, pins selection and preserves active tasks', async () => {
  const e = fixture(), r = new PlaybookRouter(e)
  r.recommend('修复这个接口bug'); assert.equal(e.runs.size, 0)
  const [a,b] = await Promise.all([r.route('s',{task:'修复这个接口bug'}),r.route('s',{task:'修复这个接口bug'})])
  assert.ok(a.started); assert.ok(b.reused)
  await r.route('s', {task:'帮我生成一首歌曲'})
  assert.equal(e.status('s').run.playbookId,'bug-fix')
  assert.equal(e.status('s').input.routing.method,'rule')
})
test('passthrough tasks do not require a vaguely related SOP and later tasks do not inherit them', async () => {
  const e = fixture(), r = new PlaybookRouter(e)
  const first = r.remember('s', '请帮我整理这个任务')
  assert.equal(first.kind, 'passthrough')
  assert.equal(r.guard('s','bash'), undefined)
  const second = r.remember('s','帮我写一篇公众号文章，不需要视频')
  assert.equal(second.recommendedId, 'wechat-article')
  const out = await r.route('s',{playbookId:'wechat-article',note:'用户明确要求产出公众号文章'})
  assert.equal(out.status.run.playbookId,'wechat-article')
  assert.ok(!out.status.input.task.includes('请帮我整理这个任务'))
})
test('passthrough work is not gated; only real SOP selection can gate tools', () => {
  const r = new PlaybookRouter(fixture()); const d=r.remember('s','请帮我处理这个任务')
  assert.equal(d.kind,'passthrough'); assert.equal(r.guard('s','bash'),undefined); assert.equal(r.guard('s','playbook'),undefined)
  r.remember('t','修复bug并写篇公众号')
  assert.ok(r.guard('t','bash')); assert.equal(r.guard('t','run_code'),undefined); assert.equal(r.guard('t','ask_user_question'),undefined)
})
test('pre-aborted selection does not create a run', async () => {
  const e=fixture(), r=new PlaybookRouter(e)
  await assert.rejects(r.route('s',{task:'修复接口bug',signal:AbortSignal.abort()}))
  assert.equal(e.runs.size,0)
})
test('an explicit writing request is not downgraded to a usage question',()=>{
  assert.equal(recommendPlaybook('帮我写篇公众号文章解释SOP是什么',fixture().listPlaybooks()).recommendedId,'wechat-article')
})

test('plugin uninstall is passthrough despite partial plugin/model keyword candidates', async()=>{
  const e=fixture(),r=new PlaybookRouter(e),d=r.recommend('把model-mgr 这个插件删了吧。')
  assert.equal(d.kind,'passthrough');assert.equal(d.recommendedId,null);assert.ok(d.candidates.some(c=>c.id==='dsh-plugin-development'&&!c.complete))
  r.remember('s','把model-mgr 这个插件删了吧。')
  const out=await r.route('s',{playbookId:'task-intake',note:'No dedicated uninstall SOP; old behavior tried task-intake.'})
  assert.equal(out.passthrough,true);assert.equal(e.runs.size,0);assert.equal(r.guard('s','bash'),undefined)
})

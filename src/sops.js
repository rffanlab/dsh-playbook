/** Starter SOPs: executable delivery contracts, not claims of proven domain expertise. */
const text = key => ({ key, type: 'string', minLength: /_(path|version)$|^(audience|topic|final_title|verdict|model_identity)$/.test(key) ? 1 : 12 })
const items = key => ({ key, type: 'array', minItems: 1 })
const yes = key => ({ key, type: 'boolean', equals: true })
const COMMON = 'Only report work actually performed. Missing capabilities, inaccessible inputs or uncertain evidence must be reported, not fabricated. SOP selection grants no new permissions.'
function stage(id, title, instructions, evidence, { back, deny, mode = 'guided' } = {}) {
  return {
    id, title, mode, objective: title,
    instructions: [...instructions, COMMON],
    gate: { evidence },
    retry: { maxAttempts: 2, onExhausted: back ? `branch:${back}` : 'fail' },
    ...(deny ? { tools: { deny } } : {}),
  }
}
function book(id, name, description, groups, stages, extra = {}) {
  return { id, version: '0.2.0', name, description, goal: description,
    routing: { groups, priority: 10, examples: [], ...extra },
    stages: stages.map((s, i) => i === stages.length - 1 ? { ...s, next: null } : s) }
}
const BUILD = ['开发', '新增', '增加', '实现', '加一个', '添加', '做一个', '创建', 'build', 'implement', 'develop', 'create', 'add']
const DEPLOY = ['部署', '安装', '配置', '迁移', 'deploy', 'install', 'configure', 'migrate']
const REVIEW = ['审查', '审核', '评审', '审一下', '审一审', '检查', 'review', 'audit', 'check']
const WRITE = ['写', '生成', '制作', '做', '创作', 'write', 'generate', 'produce', 'create', 'make']
const READ_ONLY = ['write', 'edit'] // Tool-name constraint only; not an OS read-only sandbox.
const SOFTWARE_TEST = stage('verify', '验证原需求、边界与回归 / Verify behavior and regressions', [
  'Run the repository-appropriate targeted tests, then relevant regressions, lint/build or type checks. Record exact commands and exit codes.',
  'A tool call returning normally is NOT proof the test process exited zero. Inspect actual results. Do not mark unrun tests as passing.',
], [items('test_results'), text('acceptance_mapping'), yes('checks_passed')], { back: 'implement' })
const DELIVERY = stage('handoff', '交付产物与限制 / Deliver artifacts and limitations', [
  'List exact changed files or deliverable paths, executed checks, remaining limitations and how the user can reproduce verification.',
  'Do not push, publish, send, sign, purchase or upload just because this is the final stage. Perform external actions only within explicit user authorization and host policy.',
], [items('deliverables'), text('verification_summary'), text('limitations')])

export const SOP_PLAYBOOKS = [
  book('feature-development', '功能开发 / Feature development', '从需求到实现、测试与交付；不用于单纯解释代码或修复已知缺陷。',
    [BUILD, ['功能', '接口', 'api', '页面', '模块', '应用', 'feature', 'endpoint', 'application']], [
      stage('requirements', '确认需求与验收 / Define requirements and acceptance', ['Read the request and existing behavior; clarify only missing facts that change the implementation.', 'State scope, non-goals, inputs/outputs and observable acceptance cases before editing.'], [text('requirements'), items('acceptance_cases'), text('non_goals')], { deny: READ_ONLY }),
      stage('design', '检查现有架构并设计 / Inspect and design', ['Inspect the smallest relevant code path and current official API contracts.', 'Prefer existing conventions; state affected files, compatibility, data migration and security impacts.'], [items('inspected_paths'), text('design'), text('risks')], { deny: READ_ONLY }),
      stage('implement', '实现最小完整变更 / Implement a focused change', ['Implement the agreed scope, input validation and failure handling.', 'Add tests alongside the feature; do not mix unrelated refactors.'], [items('changed_files'), text('implementation_summary'), items('test_cases')]),
      SOFTWARE_TEST, DELIVERY,
    ], { priority: 0, examples: ['帮我增加一个分页查询接口', 'Implement an export feature'] }),

  book('plugin-development', '通用插件开发 / Plugin development', '为指定宿主开发插件；DSH 插件优先使用专用流程。',
    [BUILD, ['插件', '扩展', 'plugin', 'extension']], [
      stage('contract', '确认宿主与插件契约 / Verify host contract', ['Identify the host application, installed version, supported entry points and permission model.', 'Read official plugin documentation and a compatible working example, rather than guessing lifecycle APIs.'], [text('host_version'), items('contract_sources'), text('requirements')], { deny: READ_ONLY }),
      stage('design', '定义边界与生命周期 / Design lifecycle and boundaries', ['Specify entry/export names, install/uninstall, disposal, state migration and UI/backend separation.', 'List side effects and required capabilities; do not assume a missing backend exists.'], [text('design'), items('entry_points'), text('cleanup_plan')]),
      stage('implement', '实现插件与文档 / Implement plugin and docs', ['Implement against the verified contract and isolate host-specific calls.', 'Write Chinese-default documentation with an English counterpart and copyable install/rollback steps.'], [items('changed_files'), items('tests_added'), items('documentation_paths')]),
      SOFTWARE_TEST,
      stage('host-smoke', '在宿主中验证加载与卸载 / Host load/unload smoke test', ['Install the actual packed artifact in an isolated matching host profile.', 'Test startup, one real command/tool, disposal and reload. If the host is unavailable, stop and report the missing validation.'], [text('host_version'), items('smoke_results'), yes('host_smoke_passed')], { back: 'implement' }),
      DELIVERY,
    ], { priority: 15, examples: ['开发一个 Chrome 插件', 'Build an editor extension'] }),

  book('dsh-plugin-development', 'DSH 插件开发 / DSH plugin development', '针对 DeepSeek Harness 的插件开发与宿主集成验收。',
    [BUILD, ['dsh', 'deepseek harness', 'deepseek-harness'], ['插件', '扩展', 'plugin', 'extension']], [
      stage('contract', '核实 DSH 版本和接口 / Verify DSH version and contracts', ['Record the target installed Harness version; read its public tool, hook, scope and client-module contracts.', 'Inspect compatible plugins. Do not treat master-only APIs as proven compatible with an older deployment.'], [text('target_version'), items('contract_sources'), text('scope_plan')], { deny: READ_ONLY }),
      stage('design', '设计插件边界与状态 / Design scopes and state', ['Specify Cordis injection/effect disposal, session identity, cancellation, persistence and recovery.', 'For tools define canonical output schemas; for waterfalls preserve downstream decisions and never override a rejection.'], [text('design'), text('state_model'), text('failure_policy')]),
      stage('implement', '实现 DSH 插件 / Implement DSH integration', ['Implement Host and optional Client separately; do not import Host modules into the browser.', 'Preserve existing approvals and argument schemas. Add focused tests and Chinese-default plus English docs.'], [items('changed_files'), items('tests_added'), items('documentation_paths')]),
      stage('package-check', '检查打包与入口 / Check packed exports', ['Run tests, syntax/type checks and npm pack. Inspect the real tarball, not only the working directory.', 'If dsh.client exists, exports["./client"] must resolve to an included browser bundle. Verify dsh.bundle.patch, server entry, peer dependencies and client module id.'], [items('check_results'), items('packed_entry_paths'), yes('exports_verified')], { back: 'implement' }),
      stage('host-smoke', '隔离 Profile 启动与 Web 验收 / Isolated Profile and Web smoke', ['Use a disposable profile matching the installed DSH version, not the user production profile.', 'Verify Host startup, client-module composition, page load, registered command/tool, and plugin reload/disposal. Capture actual results; untested is not passed.'], [text('host_version'), items('smoke_results'), yes('host_started'), yes('client_checked')], { back: 'implement' }),
      DELIVERY,
    ], { priority: 35, examples: ['给 DSH 开发一个图片管理插件', 'Implement a DeepSeek Harness plugin'] }),

  book('code-review', '代码审查 / Code review', '以具体代码和测试证据定位问题，默认只审查不改代码。',
    [REVIEW, ['代码', '提交', '差异', 'pr', 'code', 'diff', 'pull request']], [
      stage('scope', '确定审查范围 / Establish review scope', ['Read the requested diff or files and repository conventions.', 'Identify intended behavior and risk areas; do not rewrite code during an audit.'], [items('reviewed_paths'), text('intended_behavior')], { deny: READ_ONLY }),
      stage('inspect', '逐项检查行为与风险 / Inspect behavior and risks', ['Trace correctness, inputs, error paths, compatibility, concurrency, security and tests.', 'Every finding needs a location, triggering condition, user impact and evidence; separate hypotheses from confirmed defects.'], [items('checks_performed'), { key: 'findings', type: 'array' }, text('coverage_gaps')], { deny: READ_ONLY }),
      stage('validate', '验证发现 / Validate findings', ['Reproduce feasible issues in an isolated environment or document a concrete causal code path.', 'Remove unsupported findings. A clean review must still enumerate checks and limitations.'], [{ key: 'validated_findings', type: 'array' }, text('verification_evidence'), text('limitations')], { deny: READ_ONLY }),
      stage('report', '按影响交付审查报告 / Deliver prioritized findings', ['Report severity, file/line, reasoning and smallest suggested fix, followed by open risks.', 'Do not report tests as run unless they were actually run; do not apply patches without authorization.'], [text('review_report'), text('test_status')], { deny: READ_ONLY }),
    ], { priority: 20, examples: ['审一下这个 PR 的代码', 'Review this diff'] }),

  book('release', '版本发布准备 / Release preparation', '准备可验证、可回滚的版本发布；不自动取得远端发布权限。',
    [['发布', '发版', 'release', 'ship'], ['版本', '软件', '插件', 'npm', 'version', 'package', 'software']], [
      stage('scope', '核实版本和变更 / Verify version and changes', ['Inspect the actual Git state, previous release, target version and authorized publication destination.', 'Separate unrelated local changes and confirm required compatibility/migration notes.'], [text('release_version'), items('included_changes'), text('publication_scope')]),
      stage('build', '构建与测试 / Build and test', ['Run the appropriate unit/integration checks and create the real release artifact.', 'Record checksum, dependency and entry-point checks, changelog and install instructions.'], [items('check_results'), items('artifact_paths'), text('checksum_manifest'), yes('checks_passed')]),
      stage('smoke', '隔离安装与回滚验证 / Install and rollback smoke', ['Install the artifact in a clean disposable environment and test the main user path.', 'Verify rollback using an actual prior artifact or clearly describe the untested part.'], [items('smoke_results'), text('rollback_plan'), yes('smoke_passed')], { back: 'build' }),
      stage('handoff', '交付发布包 / Deliver release package', ['Provide the artifact and release notes. Without explicit user authorization, stop before Git push, registry upload, tagging or deployment.', 'When publication is authorized, record the real remote result rather than merely claiming it occurred.'], [items('deliverables'), text('release_notes'), text('publication_status')]),
    ], { priority: 20, examples: ['准备发布这个插件的新版本', 'Prepare an npm release'] }),

  book('incident-response', '故障恢复 / Incident response', '服务中断先收集事实并恢复，再追查根因和预防复发。',
    [['排查', '修', '恢复', '故障', '启动不了', '启动失败', '宕机', 'troubleshoot', 'restore', 'outage', 'down'], ['服务', 'harness', 'dsh', '生产', 'systemd', 'server', 'service', 'production']], [
      stage('triage', '明确故障范围 / Triage scope', ['Read timestamped logs, service status, deployed versions and recent changes.', 'Identify affected users/services and preserve evidence; never print credentials.'], [text('incident_scope'), items('log_evidence'), text('recent_changes')], { deny: READ_ONLY }),
      stage('recovery-plan', '选择最小恢复措施 / Choose reversible recovery', ['Prioritize a reversible rollback or disabling only the proven faulty component.', 'State impact, data protection, authorization and rollback. Do not wipe state or upgrade every dependency speculatively.'], [text('recovery_plan'), text('rollback_plan'), text('data_protection')]),
      stage('recover', '实施授权范围内恢复 / Recover within authorized scope', ['Execute the smallest approved change and collect command results.', 'Check readiness and the real user path; a running process alone is not a health check.'], [items('actions_taken'), items('health_checks'), yes('service_recovered')]),
      stage('root-cause', '定位根因与回归 / Identify cause and prevention', ['Connect the fault to concrete logs/version/config differences.', 'Provide a narrow permanent fix and regression test or separately tracked follow-up; do not conceal uncertainty.'], [text('root_cause'), items('supporting_evidence'), items('prevention_actions')]),
      DELIVERY,
    ], { priority: 25, examples: ['DeepSeek Harness 启动不了了，帮我修一下', 'Restore the production service after an outage'] }),

  book('linux-service-deploy', 'Linux 服务部署 / Linux service deployment', '检查环境、准备可回滚配置、部署并验收 Linux 服务。',
    [DEPLOY, ['linux', 'ubuntu', 'systemd', '服务', 'service']], [
      stage('preflight', '核实主机与部署边界 / Host preflight', ['Inspect OS/architecture, service account, directories, ports, disk and dependencies.', 'Identify existing workloads and data; no destructive cleanup or unexpected interruption.'], [text('environment'), items('requirements'), text('impact_scope')]),
      stage('plan', '设计可回滚部署 / Plan reversible deployment', ['Define version pin, file ownership, config/secret locations, systemd unit, logs and health check.', 'Use least privilege; keep previous version and data backup strategy.'], [text('deployment_plan'), text('rollback_plan'), text('secret_handling')]),
      stage('install', '安装并配置 / Install and configure', ['Install only required dependencies and deploy versioned artifacts.', 'Validate config and permissions before starting/restarting the intended service.'], [items('installed_artifacts'), items('configuration_checks'), text('changes_applied')]),
      stage('verify', '验证服务可用性 / Verify service readiness', ['Check service status, logs, port binding and an actual request through the expected access path.', 'Report startup vs readiness separately; verify persistence/restart behavior only when safe.'], [items('health_checks'), text('request_result'), yes('ready')], { back: 'install' }),
      DELIVERY,
    ], { priority: 15, examples: ['在 Ubuntu 上部署一个 systemd 服务', 'Deploy this service on Linux'] }),

  book('model-deployment', '本地模型部署 / Local model deployment', '验证模型、硬件与推理接口，并用真实负载测性能和稳定性。',
    [DEPLOY.concat(['跑起来', '运行', 'serve']), ['模型', '千问', 'qwen', 'gguf', 'vllm', 'llama', 'model', 'ollama']], [
      stage('preflight', '检查硬件、模型与目标 / Model and hardware preflight', ['Record actual GPU/RAM, drivers, architecture, model format/quantization, disk and required context length.', 'Check licensing/source and runtime compatibility with official docs; do not invent memory fit or speed numbers.'], [text('hardware'), text('model_identity'), items('requirements'), items('compatibility_sources')]),
      stage('plan', '确定推理配置与回滚 / Choose serving config', ['Choose versioned runtime/model, memory and context budgets, bind address and authentication.', 'Protect existing workloads; make performance assumptions explicit and provide rollback commands.'], [text('serving_plan'), text('resource_budget'), text('rollback_plan')]),
      stage('install', '安装与启动 / Install and start', ['Verify model artifacts/checksums when available and write the minimal serving config.', 'Start under the correct user and capture startup errors without silently dropping requested capabilities.'], [items('artifacts'), text('runtime_configuration'), text('startup_result')]),
      stage('verify', '实测能力与负载 / Measure capabilities and workload', ['Run real completion/API tests; test tool calls, vision and long context only when requested and supported.', 'Record prompt/output lengths, context setting, speed measurement method, latency and peak memory. Distinguish estimates from measurements.'], [items('functional_tests'), items('measurements'), text('limitations'), yes('required_capabilities_passed')], { back: 'install' }),
      DELIVERY,
    ], { priority: 30, examples: ['在 Ubuntu 部署 Qwen GGUF 模型', 'Serve a local model with vLLM'] }),

  book('short-video-production', '短视频制作 / Short video production', '选题、开头、事实文案、自动化制作和成片验收；不保证流量。',
    [WRITE, ['短视频', '抖音', '视频', 'short video', 'tiktok', 'reel']], [
      stage('brief', '明确受众与交付 / Define audience and output', ['Use the user current topic, platform, duration and production constraints.', 'Default to available AI/automation assets, narration and editing; do not assume the user will appear or record manually.'], [text('audience'), text('topic'), text('production_constraints')]),
      stage('hook', '设计选题与开头 / Design topic and hook', ['Create specific title/hook alternatives tied to an audience benefit or question.', 'Select one and explain clarity, payoff and factual limits; no fabricated drama or guaranteed retention scores.'], [items('hook_candidates'), text('selected_hook'), text('selection_reason')]),
      stage('script', '核实文案与来源 / Ground the script', ['Build a spoken script with a clear opening, development and payoff.', 'Verify material claims and quotes using the supplied/primary sources; separate interpretation from historical fact.'], [text('narration'), items('claim_checks'), text('source_notes')]),
      stage('produce', '制作视觉、音频与字幕 / Produce video assets', ['Create a shot plan tied to narration; generate or obtain licensed assets and render with available tools.', 'Align subtitles/audio, safe areas, aspect ratio and duration. If rendering tools are absent, report a production-plan-only deliverable.'], [items('asset_manifest'), text('render_path'), text('subtitle_alignment')]),
      stage('qa', '观看成片并验收 / Inspect rendered video', ['Inspect the actual first frame and representative frames; listen to audio when playback is available.', 'Check cuts, readability, subtitle timing, sound, factual fidelity and export parameters. Do not claim an unseen video passed.'], [items('qa_observations'), text('media_probe'), yes('release_ready')], { back: 'produce' }),
      DELIVERY,
    ], { priority: 10, examples: ['帮我做一条道家文化短视频', 'Produce a short video about this experiment'] }),

  book('bilibili-video-production', 'B 站视频制作 / Bilibili video production', '面向 B 站的实验/教程/解说视频，从证据采集到成片交付。',
    [WRITE, ['b站', 'bilibili']], [
      stage('brief', '确定问题与观众收益 / Define viewer payoff', ['Define the audience question, promise, duration and proof needed.', 'Use automated screen capture/asset collection where available; do not require manual filming by default.'], [text('viewer_question'), text('video_promise'), text('constraints')]),
      stage('evidence', '收集实验或教程证据 / Collect evidence', ['For experiments define controlled settings and record raw results; for tutorials verify commands and versions.', 'Separate actual measurements, estimates and opinions. Keep source/asset provenance.'], [items('evidence_manifest'), text('method'), text('limitations')]),
      stage('script', '组织叙事和视觉 / Structure script and visuals', ['Lead with the result or problem, then method, evidence and practical conclusion.', 'Draft title/cover wording and scene plan without clickbait claims unsupported by the video.'], [text('script'), items('scene_plan'), items('title_candidates')]),
      stage('produce', '自动化制作成片 / Produce the video', ['Render narration, screens, graphics and subtitles using verified tools.', 'Preserve raw results and avoid overlays obscuring important evidence.'], [text('render_path'), items('asset_manifest'), text('production_log')]),
      stage('qa', '观看与交付前检查 / Watch and verify', ['Inspect actual video/audio, pacing, first frame, text readability and factual fidelity.', 'Record concrete timestamped defects and corrections; prepare metadata but do not publish automatically.'], [items('qa_observations'), text('media_probe'), yes('release_ready')], { back: 'produce' }), DELIVERY,
    ], { priority: 30, examples: ['帮我做一期 B站本地模型实测视频', 'Produce a Bilibili tutorial'] }),

  book('video-review', '视频审核 / Video review', '基于实际成片、音频和文案的带时间戳审核，不凭文件名打分。',
    [REVIEW, ['视频', '成片', '首帧', 'video', 'footage']], [
      stage('intake', '确认素材可访问 / Verify access to media', ['Locate the actual video, script, target platform and review objective.', 'Report unavailable media/audio explicitly; do not pretend to have watched or listened.'], [items('accessible_assets'), text('review_scope')]),
      stage('inspect', '检查开头、节奏和技术质量 / Inspect opening and media quality', ['View the first frame and relevant timestamps; listen to audio when possible.', 'Check readability, framing, transitions, timing, pacing, duration, clipping and subtitles.'], [items('timestamped_observations'), text('technical_checks'), text('access_limitations')]),
      stage('facts', '检查事实与承诺 / Check claims and payoff', ['Cross-check significant claims/quotes against available primary material.', 'Distinguish factual defects, unverified statements and subjective stylistic suggestions.'], [items('claim_checks'), text('promise_payoff')]),
      stage('report', '给出可执行修改清单 / Deliver actionable changes', ['Prioritize blockers and improvements with timestamps, reason and concrete edit suggestions.', 'State publish/hold recommendation without claiming guaranteed reach or retention.'], [text('verdict'), { key: 'required_edits', type: 'array' }, text('limitations')]),
    ], { priority: 25, examples: ['帮我审一下这个视频', 'Review the rendered video'] }),

  book('wechat-article', '公众号文章 / WeChat article', '读材料、拟标题、口语化写作、事实审核并交付 Markdown。',
    [WRITE, ['公众号', '微信文章', 'wechat article', 'wechat post']], [
      stage('brief', '确认读者与材料 / Read the brief and source', ['Identify readers, purpose, available facts and desired voice.', 'Read the actual referenced material; do not turn an unverified feature plan into a released-feature claim.'], [text('audience'), text('purpose'), items('source_material')]),
      stage('outline', '设计标题和结构 / Design headline and structure', ['Provide specific non-misleading title candidates and a useful opening.', 'Arrange motivation, actual experience, how it works, limitations and practical takeaways.'], [items('title_candidates'), text('outline'), text('opening')]),
      stage('draft', '撰写文章 / Write the draft', ['Write readable conversational Chinese unless requested otherwise.', 'Use concrete examples from evidence, not invented revenue, benchmarks or user testimonials.'], [text('article_markdown'), text('fact_vs_opinion')]),
      stage('verify', '检查事实和阅读体验 / Verify claims and readability', ['Check names, commands, numbers, links and whether examples are real or hypothetical.', 'Remove unsupported promises and keep necessary limitations in the article.'], [items('fact_checks'), text('editing_notes'), yes('claims_checked')], { back: 'draft' }),
      stage('handoff', '交付 Markdown 与封面说明 / Deliver Markdown and cover brief', ['Save the final Markdown and give a concrete file path.', 'Create a cover only if requested and a suitable tool is available; otherwise provide a labeled cover brief, not a claimed image. No automatic public posting.'], [text('markdown_path'), text('final_title'), text('cover_status')]),
    ], { priority: 25, examples: ['帮我写篇公众号介绍这个插件', 'Write a WeChat article'] }),

  book('music-production', '原创音乐制作 / Original music production', '歌词、风格与发音约束、生成制作和试听质检。',
    [WRITE, ['歌曲', '音乐', '歌词', '唱腔', '歌', 'music', 'song', 'lyrics']], [
      stage('brief', '确定音乐目标和权利 / Define music brief and rights', ['Record theme, language, vocal qualities, arrangement, duration and reference permissions.', 'Carry forward explicit user constraints; do not assume rights to copyrighted lyrics, melodies or a voice clone.'], [text('music_brief'), items('vocal_constraints'), text('rights_scope')]),
      stage('lyrics', '完成歌词与结构 / Write lyrics and structure', ['Write original or authorized lyrics with a singable structure and clear pronunciation.', 'Check exact wording and avoid unwanted filler/ad-libs; preserve requested poetry attribution.'], [text('lyrics'), text('song_structure'), text('pronunciation_notes')]),
      stage('production-plan', '设计编曲和生成参数 / Plan arrangement and generation', ['Specify voice, tempo progression, instrumentation and negative constraints supported by the chosen tool.', 'Verify the actual available model/API and resource budget; do not claim a missing music engine is installed.'], [text('generation_prompt'), text('arrangement'), text('tool_capabilities')]),
      stage('produce', '生成与整理音频 / Generate and assemble audio', ['Generate or synthesize with authorized inputs and retain take identifiers/settings.', 'Export the requested format and record actual file paths; if tools are unavailable, stop at a labeled plan.'], [items('audio_paths'), items('take_manifest'), text('export_settings')]),
      stage('listen', '试听与技术检查 / Listen and inspect', ['Listen for missing syllables, sudden silence, clipping, harshness, pronunciation and lyric alignment.', 'Check actual duration/loudness/format when tooling permits; report inaccessible listening rather than approving by filename.'], [items('listening_observations'), text('audio_checks'), yes('audio_ready')], { back: 'produce' }), DELIVERY,
    ], { priority: 15, examples: ['帮我创作一首原创歌曲', 'Produce an original song'] }),

  book('music-release', '歌曲发行准备 / Music release preparation', '核对授权、音频、歌词、封面和元数据后交付上传包。',
    [['发行', '上传', '发布', 'release', 'upload', 'publish'], ['歌曲', '音乐', '汽水', '网易', 'music', 'song', 'tracks']], [
      stage('rights', '核对作品和平台授权 / Check rights and platform scope', ['Read the actual current agreement/restrictions supplied by the user for these works.', 'Separate per-work restrictions from account-level restrictions. Unclear exclusivity requires verification, never guessed legal advice or automatic signing.'], [items('work_inventory'), text('rights_assessment'), text('platform_scope')]),
      stage('assets', '校验音频、歌词与封面 / Check release assets', ['Verify actual audio format, lyric files/timing, cover dimensions and ownership against target requirements.', 'Identify missing or duplicate files; do not upload incomplete assets.'], [items('asset_manifest'), items('asset_checks'), yes('assets_ready')]),
      stage('metadata', '整理发行元数据 / Prepare metadata', ['Map title, artist, credits, language and genre to each exact work.', 'Prepare a one-to-one track/audio/lyrics/cover mapping and flag uncertain fields.'], [items('track_metadata'), text('duplicate_check'), text('unresolved_fields')]),
      stage('handoff', '交付上传包或授权上传结果 / Deliver upload package or authorized receipts', ['Default deliverable is a release package and upload checklist, not automatic submission.', 'Only submit when explicitly authorized and allowed by the tool/platform; record actual receipts and failures, never bypass access controls or duplicate submissions.'], [items('release_package'), text('submission_status'), text('next_actions')]),
    ], { priority: 25, examples: ['整理这批歌曲的汽水上传包', 'Prepare these tracks for music release'] }),

  book('research-report', '资料调研 / Research report', '界定问题、检索可信来源、交叉核验并给出带引用结论。',
    [['调研', '调查', '研究', '竞品', '报告', 'research', 'investigate', 'compare'], ['行业', '市场', '竞品', '产品', '技术', '方案', '报告', '研究', 'market', 'competitor', 'technology', 'report', 'products']], [
      stage('scope', '界定研究问题 / Define research question', ['Define the decision, comparison dimensions, time range, geography and source constraints.', 'Separate questions answerable from provided material from those requiring current external research.'], [text('research_question'), items('dimensions'), text('source_scope')]),
      stage('collect', '收集并记录来源 / Collect sources', ['Retrieve actual primary/authoritative sources, recording publication/access dates and relevant passages.', 'Do not invent URLs or citations. If browsing is unavailable, label the report source-limited.'], [items('source_register'), text('coverage_gaps')]),
      stage('analyze', '交叉核验并分析 / Cross-check and analyze', ['Build an evidence matrix; distinguish measured facts, vendor claims, interpretation and uncertainty.', 'Check conflicting sources, units, denominators and comparable scope before ranking options.'], [items('evidence_matrix'), text('analysis'), text('uncertainties')]),
      stage('review', '核查关键结论 / Review load-bearing claims', ['Trace each material conclusion to evidence and check freshness.', 'Remove unsupported certainty and expose missing data and alternative interpretations.'], [items('claim_audit'), yes('citations_checked')], { back: 'analyze' }), DELIVERY,
    ], { priority: 10, examples: ['帮我调研这些本地推理方案', 'Research the market and competitors'] }),

  book('data-analysis', '数据分析 / Data analysis', '明确口径、检查质量、可复现分析并交付结果与限制。',
    [['分析', '统计', '复盘', 'analyze', 'analyse', 'statistics'], ['数据', '收益', '播放', 'csv', 'excel', '表格', 'data', 'dataset', 'metrics']], [
      stage('scope', '确定问题与数据口径 / Define question and data scope', ['Identify the actual input files or accessible data source, period, units and target metrics.', 'Do not treat partial screenshots or missing days as a complete dataset.'], [items('data_sources'), text('metric_definitions'), text('scope')]),
      stage('quality', '检查数据质量 / Check data quality', ['Inspect types, missingness, duplicates, outliers, time zones and reconciliation totals.', 'Keep raw data unchanged; record cleaning rules and excluded rows.'], [items('quality_checks'), text('cleaning_rules'), text('coverage_limits')]),
      stage('analyze', '计算并解释 / Calculate and interpret', ['Use reproducible calculations; separate correlations from causal claims.', 'Compare like-for-like periods and avoid overstating tiny samples or volatile single-day changes.'], [items('calculated_metrics'), text('method'), text('interpretation')]),
      stage('verify', '复算与核对 / Recalculate and reconcile', ['Independently check critical totals and formulas against source data.', 'Verify labels, denominators, units and chart scales; report unresolved reconciliation differences.'], [items('reconciliation'), text('calculation_checks'), yes('numbers_checked')], { back: 'analyze' }), DELIVERY,
    ], { priority: 15, examples: ['分析这几天的播放数据', 'Analyze this CSV dataset'] }),

  book('sop-authoring', 'SOP 编写与验证 / SOP authoring', '将明确任务领域的方法写成可执行、可测试的流程草案。',
    [BUILD.concat(['补全', '编写', '完善', '设计', 'write', 'design']), ['sop', 'playbook', '工作流程', '作业指导']], [
      stage('scope', '定义适用边界 / Define applicability', ['Identify repeated tasks, required inputs, success/failure examples and source of expertise.', 'Do not call an untested generated workflow an expert-validated best practice.'], [text('use_when'), text('not_for'), items('task_examples'), items('method_sources')]),
      stage('design', '设计阶段、产物与验收 / Design stages and evidence', ['Give each stage concrete inputs, tools, artifacts, gate rules and bounded failure handling.', 'Separate model assertions from independently verified evidence. External authorization remains with the host/user.'], [items('stage_contracts'), text('failure_policy'), text('trust_boundary')]),
      stage('implement', '生成可加载定义 / Produce loadable definitions', ['Use the installed dsh-playbook JSON schema and supported routing fields.', 'Create a draft file with version, bilingual matching examples and honest capability prerequisites. Do not silently replace an active run.'], [text('definition_path'), items('routing_examples'), text('version_notes')]),
      stage('verify', '验证加载、路由和失败分支 / Test loading, routing and failures', ['Test normalization, all referenced stages, reachable terminal state and invalid/missing evidence.', 'Test positive, ambiguous and irrelevant routing prompts; record actual fixture results.'], [items('test_results'), yes('schema_valid'), yes('routing_checked')], { back: 'implement' }), DELIVERY,
    ], { priority: 30, examples: ['把所有 SOP 补全', 'Design a playbook for our workflow'] }),

  book('task-intake', '未知任务接单 / Unclassified task intake', '无专用匹配时明确目标、能力和验收；不是通用专家流程。', [], [
    stage('clarify', '明确交付目标 / Clarify the deliverable', ['Explain that no dedicated SOP is a confident match. Ask only for missing goal/input/constraint facts that materially change execution.', 'Do not ask the user to know internal SOP names. For informational chat, cancel/avoid this workflow rather than forcing a project.'], [text('goal'), items('inputs'), items('acceptance_criteria')]),
    stage('capabilities', '核实工具与边界 / Check capabilities and boundaries', ['Inspect available tools and applicable sources within authorization.', 'If a dedicated catalog SOP becomes appropriate, recommend an explicit switch; never claim it was used while this intake remains active.'], [text('capability_check'), text('risk_boundary'), text('workflow_choice')]),
    stage('plan', '制定有界计划 / Make a bounded plan', ['Describe the smallest plan, concrete artifacts and checks with an explicit stopping condition.', 'This is guided fallback planning, not proof of an optimal domain method. Escalate high-risk uncertainty to the user.'], [items('steps'), text('validation_plan'), text('stop_condition')]),
    stage('execute', '执行已明确的任务 / Execute the scoped task', ['Use only available, authorized capabilities. Keep outputs and action results.', 'Report blockers honestly rather than simulating a completed operation.'], [items('outputs'), text('execution_record')]),
    stage('verify', '按验收条件检查 / Verify acceptance', ['Check each acceptance criterion against an actual artifact or observation.', 'Explicitly mark unverified parts; do not approve by self-confidence alone.'], [items('acceptance_results'), text('limitations'), yes('accepted')]), DELIVERY,
  ], { priority: -50, autoStart: false, examples: ['一个暂时没有专用流程的新任务 / An unclassified task'] }),
]

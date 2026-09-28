import { domainStages } from './domain-sops.js'
/** Media production is intentionally short: one planning gate, one pilot, one build, one QA. */
const text = key => ({ key, type: 'string', minLength: 1 })
const list = key => ({ key, type: 'array', minItems: 1 })
function stage(id, title, instructions, evidence, kind, back) {
  return { id, title, objective: title, mode: 'guided', instructions,
    gate: { evidence: [...evidence, ...(kind ? [text('production_manifest')] : [])],
      ...(kind ? { validators: [{ kind, pathKey: 'production_manifest' }] } : {}) },
    retry: { maxAttempts: 2, onExhausted: back ? `branch:${back}` : 'fail' } }
}
function domainGuidance(id) {
  const rows = domainStages(id)
  return rows.flatMap(row => [
    `${row.title}: ${row.objective}`,
    ...row.instructions,
  ])
}
export function videoSop(original) {
  if (!['bilibili-video-production', 'short-video-production', 'taoist-culture-video'].includes(original.id)) return original
  const p = structuredClone(original)
  p.version = '0.10.0'
  p.delivery = { review: true, revisionStage: 'diagnose',
    repairStages: ['preflight', 'pilot', 'produce', 'qa'], maxSelfRepairs: 3 }
  const brief = original.stages[0]
  const domain = domainGuidance(p.id)
  p.stages = [
    stage('preflight', '一次完成任务、来源、能力与口播预检 / One-pass preflight', [
      ...(brief?.instructions ?? []),
      ...domain,
      'Do this as ONE planning pass. The user brief/source document is authoritative input; do not rediscover requirements already written there or split them into additional internal phases.',
      'If status.input.project.capabilities contains a recent reusable profile, reuse it as a hint and run only one minimal health/probe per external service actually needed. If the user/task already names a service and its probe passes, stop capability discovery. Only on a concrete failure may you try a known alternative; do not survey every provider. Never cache tokens, cookies or credentials.',
      'Freeze the full spoken script and production.json now. Canonical segments are [{id,text,audio?,start?,end?}]; at preflight only id/text are required. Concatenated segment text must equal the complete canonical script.',
      'For source-sensitive tasks, summarize the primary-text/evidence boundary in source_truth. Distinguish quoted source, interpretation, and modern application. Unsupported claims remain uncertain.',
      'Choose the concrete production pipeline once. Record actual capability probes in capability_evidence and reusable non-secret facts in reusable_capabilities.',
      'Do not promise success, views, spiritual effects, experiment results, or final quality before measurement.',
    ], [text('task_contract'), text('source_truth'), list('capability_evidence'), list('reusable_capabilities'), text('selected_pipeline'), text('limits')], 'narration'),
    stage('pilot', '只做一个完整自然段样片 / One natural-segment pilot', [
      'Use the first segment exact text at natural voice speed. Record segments[0].audio and pilotVideo in production.json.',
      'Render ONE complete natural segment through the real voice + visual + subtitle pipeline. Do not start the whole film before this passes.',
      'Batch independent probe calls before waiting. Do not spend separate model turns inspecting every equivalent cosmetic variant.',
      'Validate actual audio/video. Optional ASR may be used once for the pilot when available; absence/timeout is not a reason for repeated ASR or a new user permission question.',
    ], [text('pipeline_command'), list('pilot_observations')], 'pilot', 'preflight'),
    stage('produce', '批量完成全片 / Batch full production', [
      'Generate all unchanged-independent assets in batches/concurrently where the Host tools permit, then collect results once. Do not do one LLM planning turn per segment or image.',
      'Use the exact approved segment text. Fill every segment audio,start,end from measured source audio and actual final placement. Natural narration is the timing master; no guessed fixed holds, atempo, looped voice or padded silence to chase a duration target.',
      'Render final video, cover, title and narration subtitles. Fill video,cover,title,subtitles,durationSeconds,coverForVideoSha256 in production.json.',
      'Use playbook build for the actual final assembly command and exact output path so the final bytes have a same-run production witness.',
      'Do not individually vision-review every source image by default. Review representative/critical source assets only; the final QA contact sheet is the main visual batch review.',
      'Reuse unchanged validated same-run assets. A caption/layout/mux fix must not trigger new TTS or image generation without evidence that those assets are defective.',
    ], [text('production_manifest'), list('deliverables'), text('production_summary')], null, 'pilot'),
    stage('qa', '一次技术验收＋批量内容审查＋自动交付 / One QA and delivery pass', [
      'First submit production_manifest to the independent validator. Static manifest problems are returned together when possible; fix all reported fields in one edit before resubmitting.',
      'For visual review, generate ONE representative contact sheet from the final video (for example 8–16 evenly spaced frames) and inspect it once. Inspect individual frames only for a concrete defect found in that sheet.',
      'If speech semantics need ASR, run at most one full-film transcription and at most one targeted retry for a specific suspicious segment. If it times out/unavailable, use script/subtitle/timing/audio evidence and mark semantics unverified rather than changing parameters repeatedly.',
      'Check first/middle/final content, title/cover, subtitles and promised points. A progress bar/timestamp alone is not meaningful content. Record timestamped observations and explicit unverified items.',
      'On a failed validator, follow the exact diagnostic code/path/hint and make the smallest state-changing fix. Never reread the same unchanged manifest repeatedly or inspect plugin source to infer hidden contracts.',
      'A passed terminal QA creates the candidate and triggers fixed-snapshot delivery automatically. There is no separate handoff stage and no extra user approval before presentation; user acceptance remains separate.',
    ], [list('timestamped_observations'), text('semantic_review_status'), text('unverified_items'), text('limitations')], 'video', 'produce'),
    stage('diagnose', '用户退回后只定位最小返修点 / Diagnose the smallest revision', [
      'Read the previous candidate and stored user feedback in status/report. Stay in the same run.',
      'Identify the concrete defect and use action=repair to preflight/pilot/produce/qa. Preserve all unaffected accepted work and cached capabilities.',
      'Do not rerun the full pipeline merely because the candidate was rejected. Missing permission or genuinely ambiguous requirements warrant one user question.',
    ], [text('defect'), list('evidence')], null),
  ]
  for (let i=0; i<p.stages.length; i++) p.stages[i].next = p.stages[i+1]?.id ?? null
  p.stages.find(s => s.id === 'qa').next = null
  p.stages.find(s => s.id === 'diagnose').next = 'preflight'
  return p
}

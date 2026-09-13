/** The two video production SOPs share technical contracts, not audience assumptions. */
const text = key => ({ key, type: 'string', minLength: 1 })
const list = key => ({ key, type: 'array', minItems: 1 })
function stage(id, title, instructions, evidence, kind, back) {
  return { id, title, objective: title, mode: 'guided', instructions,
    gate: { evidence: [...evidence, ...(kind ? [text('production_manifest')] : [])],
      ...(kind ? { validators: [{ kind, pathKey: 'production_manifest' }] } : {}) },
    retry: { maxAttempts: 2, onExhausted: back ? `branch:${back}` : 'fail' } }
}
export function videoSop(original) {
  if (!['bilibili-video-production', 'short-video-production'].includes(original.id)) return original
  const p = structuredClone(original)
  p.delivery = { review: true, revisionStage: 'diagnose', maxRevisions: 2,
    repairStages: ['script', 'pilot', 'produce', 'qa', 'content-review'], maxSelfRepairs: 3 }
  const brief = structuredClone(original.stages[0])
  brief.instructions.push('Record required deliverables and factual claims. For experiments the result is UNKNOWN until measured: do not promise success or pre-write all-gates-passed, zero interventions or A-grade claims.')
  p.stages = [brief,
    stage('capabilities', '核实可用生产工具 / Verify actual production capabilities', [
      'Inspect the public tool/schema/service/template inventory and perform a minimal safe probe. Absence of a CLI does not prove local ComfyUI/TTS services are unavailable.',
      'Reuse working public pipelines before installing replacements. Do not read prohibited historical experiment answers. Record inaccessible capabilities, not invented installations.',
    ], [list('capability_evidence'), text('selected_pipeline'), text('limits')]),
    stage('script', '冻结完整口播与逐段输入 / Freeze full narration and exact segment inputs', [
      'Write a UTF-8 plain spoken script (Markdown without unspoken headings is fine). Create production.json schemaVersion=1, script path, segments[{id,text}].',
      'Concatenated segment text must equal the FULL script (whitespace-only normalization). Never use scene summaries such as “我做了三件事...” as TTS input. Do not change the approved script later without repairing back here.',
      'The production_manifest path is relative to the DSH session workspace or an absolute path inside it. All artifact paths in it resolve relative to this manifest. The plugin independently reads the files on submit.',
      'For an experiment, source any measured result from playbook report and actual tools; claims about this unfinished delivery must remain unproven, not a prewritten victory.',
    ], [text('script_summary'), list('claim_sources')], 'narration'),
    stage('pilot', '先完成一个自然完整段样片 / Validate one complete pilot segment', [
      'Use the first segment exact text as TTS input at natural speed. Record segments[0].audio and pilotVideo paths in production.json.',
      'Render one complete natural segment with the real audio chain and layout. Do not batch the entire film until this pilot passes. Do not pad a short summary to reach a guessed duration.',
      'Listen/view via available modalities. The plugin decodes the source audio and pilot video, checks nonzero PCM, gaps and duration. This is not speech recognition or an aesthetic verdict.',
    ], [text('pipeline_command'), list('pilot_observations')], 'pilot', 'script'),
    stage('produce', '按完整段落制作全片 / Produce from the verified script and pilot', [
      'Generate all segments from their exact approved text, preserving id order. Fill each segment audio,start,end using measured audio durations; no arbitrary four-second holds.',
      'Render video, PNG/JPEG/WebP cover, title Markdown and timed SRT. Fill video,cover,title,subtitles,durationSeconds,coverForVideoSha256 in production.json.',
      'Keep natural voice pace. Fix a missing TTS input at its source, not by changing speed or filling silence. Any script change needs action=repair target script.',
      'Cover claims must match this final version. Technical metadata does not prove image text; inspect the actual cover. Use no platform-ranking claims without a source.',
    ], [list('deliverables'), text('production_manifest')], null, 'pilot'),
    stage('qa', '独立技术验收与哈希绑定 / Machine media QA and hash binding', [
      'Submit production_manifest for independent read-only checks. release_ready=true and FFmpeg exit zero cannot substitute for media contents.',
      'The worker validates canonical script/segment coverage, every source audio, full video/audio decode, all-zero audio, long low-level gaps, audio timeline, SRT bounds and full text coverage, cover decode and version metadata.',
      'Defaults (-40dB RMS per 100ms window, max 3s low gap, max 50% low windows) are narrated-video test policy, not platform policy. Music can mask absent narration; speech meaning and aesthetics remain separate.',
      'If checks fail, use bounded action=repair to the smallest affected stage and revalidate dependent artifacts. Do not keep editing outside a failed SOP.',
    ], [text('qa_scope')], 'video', 'produce'),
    stage('content-review', '检查内容而非装饰 / Review actual explanation and speech', [
      'Compare the actual speech and subtitles with the full approved script using available hearing/vision. A progress bar or changing timestamp is not meaningful explanation.',
      'Check actual first/middle/final frames, title/cover text and whether all promised points are delivered. Record timestamped observations; arrays must be arrays, not {item:[...]}.',
      'No available hearing/vision means semantic review remains UNVERIFIED; report it honestly. Do not invent an A grade or user acceptance. Machine QA does not certify spoken wording.',
    ], [list('timestamped_observations'), text('semantic_review_status'), text('unverified_items')], null, 'produce'),
    stage('handoff', '交付待验收候选 / Deliver a candidate, not user acceptance', [
      'Do not modify any media after QA. Submit the same production_manifest; hashes are checked again against QA. Changed files require repair to qa.',
      'After gate success, use playbook action=export_report to write a system report beside the validated video (or report format=markdown when export is unavailable); do not invent stage counts, timing, passes or human review counts.',
      'Deliver actual absolute paths or workspace-relative links. State awaiting_review and any unverified semantics; only the user may accept. A user rejection reopens this same run and version chain.',
    ], [list('deliverables'), text('limitations')], 'handoff', 'qa'),
    stage('diagnose', '原交付被退回：定位最小返修点 / Diagnose rejection within the original run', [
      'Read the previous candidate and user feedback stored in status/report. You are in the original run, not a new video-review task.',
      'Use the existing source/manifest and actual media checks to identify a defect. Then action=repair with stage_id script/pilot/produce/qa/content-review and a concrete note.',
      'Do not submit a success here to skip diagnosis; evidence only records the problem and returns to script conservatively. Missing permission or irreducible ambiguity warrants a user question.',
    ], [text('defect'), list('evidence')], null),
  ]
  // Revision diagnosis is off the normal success path.
  p.stages.find(s => s.id === 'handoff').next = null
  p.stages.find(s => s.id === 'diagnose').next = 'script'
  return p
}

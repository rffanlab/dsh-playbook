/** Harden shipped SOPs without changing user-authored or already-pinned definitions. */
const COMMAND_GATES = new Set(['bug-fix/verify', 'feature-development/verify', 'plugin-development/verify', 'dsh-plugin-development/package-check', 'release/build'])
export function strengthenPlaybook(input) {
  const playbook = structuredClone(input)
  playbook.version = '0.7.0'
  for (const stage of playbook.stages) {
    stage.instructions ??= []
    stage.instructions.push('Complete the actual stage work before reporting evidence. Do not fabricate files, observations or execution results to fill the form. The user deliverable is not the SOP evidence form.')
    stage.instructions.push('Do actual work, then submit only evidence. For a uniquely wrapped {item:[...]} array the plugin records a lossless correction. Other format mistakes: use check and repair the indicated field. Use action=repair for a bounded technical retry; missing inputs/permissions: action=block. Never leave a failed SOP to continue work informally.')
    const guidance = MEDIA_GUIDANCE[stage.id]
    if (guidance && playbook.stages.some(s => s.gate?.validators?.length)) stage.instructions.push(...guidance)
    if (!COMMAND_GATES.has(`${playbook.id}/${stage.id}`)) continue
    stage.gate.evidence.push(
      { key: 'verification_command', type: 'string', minLength: 1 },
      { key: 'verification_call_id', type: 'string', minLength: 1 },
    )
    stage.gate.toolResults = [{ name: 'bash', commandKey: 'verification_command', callIdKey: 'verification_call_id' }]
    stage.instructions.push('Run the real verification command in the foreground using bash. Inspect playbook status for the recorded call ID; submit that ID and the exact command. Use environment variables instead of secret literals. An unrelated echo/true command is not verification. Background acknowledgement, non-zero exit, timeout and unknown result shapes do not satisfy this gate.')
  }
  return playbook
}

// These are workflow recommendations, not extra forms, mandatory services or gates.
const MEDIA_GUIDANCE = {
  pilot: [
    'Finish ONE complete natural segment to validate the pipeline, then submit this stage. Do not quietly generate/refine the entire film while still at pilot.',
    'TTS sent the exact canonical text and returned valid audio: proceed unless there is specific evidence of a defect. Optional ASR may verify speech when available; its absence is not a reason for endless TTS retries or a new permission question.',
    'Keep cosmetic retries bounded by the task brief (normally one attempt for minor marks). Prefer a usable sample over repeated aesthetically equivalent takes.'
  ],
  produce: [
    'AUDIO-FIRST: measure the natural narration track/segments, then fit scene durations to it. Never loop voice, add fixed holds/tails, use atempo, or let an infinite ambience input determine the final duration just to reach a guessed length.',
    'Audio segments, visual shots and quote overlays have independent clocks. A 3-second quote card can overlay 9 seconds of ongoing speech/story; changing that card never inherently requires shortening or speeding the speech.',
    'Do not regenerate unchanged, validated assets from this SAME run when only captions, layout or mux timing changed. Keep original voice speed and project title/cover constraints.',
    'Layered ASS is supported directly: subtitles={path:"captions.ass",format:"ass",narrationStyles:["Txt"]}. Select the real spoken-caption style; titles/quote overlays may overlap it. No separate SRT is required solely for the plugin.'
  ],
  qa: [
    'Repair the reported dependency, not the whole movie. Punctuation-only subtitle differences are allowed; missing words, changed numbers, invalid speech-cue timing and unreadable media still fail.',
    'An unchanged cover is not automatically stale. Review its actual claims; keep locked artwork when accurate rather than changing a random pixel. The cover-to-video hash binding still must be current.'
  ],
  'content-review': [
    'Absent ASR/hearing capability is an explicit unverified item, not an invented pass or repeated demand for user decisions. Report this limitation once. Do not treat fluctuating duration alone as proof that TTS omitted words.',
    'Judge story relationships, not image count. Show quote overlays briefly over continuing story footage without treating visual duration as a speech-duration constraint. Respect the user-specified bounded cosmetic/revision policy.'
  ],
  handoff: [
    'Unchanged artifact bytes and the same material manifest contract reuse verified QA after rehashing; no repeat full decode is needed. Real changes trigger targeted qa revalidation.',
    'Waiting for user review prevents silent edits, not inspection or presentation: use playbook action=diagnose for read-only measurements. Do not ask the user to cancel the task merely to inspect media.'
  ],
}

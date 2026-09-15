# 0.7.0: reduce workflow friction without lowering deliverable requirements

[中文](WORKFLOW-UX.md)

A real session exposed ignored long user reviews, rejected repair aliases, repeated producer/QA loops when the script dependency was stale, forced cover-byte changes, merged ASS quote/narration validation, and blocked read-only inspection. Its pinned SOP was 0.4.0, not evidence of the currently installed plugin version. Public fixtures are synthetic; no private transcript or media is committed.

## Use

Back up the actual state file, use the original service account/DSH_HOME, update and restart:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Start a fresh conversation with the task. No new per-stage approvals. Existing definitions remain pinned; a legacy candidate can be inspected read-only but cannot be relabelled as a newly isolated run.

## Runtime corrections

Long formal reviews and direct rejection phrases now reopen the same run. A conditional example buried in a real review does not invalidate the entire instruction. Input is bounded to 64000 characters and persisted feedback to 24000; the original user message remains authoritative. Code blocks, quotes, hypothetical questions, and requests to summarize/translate logs do not authorize acceptance or revision. Explicit user commands remain available for ambiguous phrasing.

Repair accepts canonical `stage_id`/`note` and unambiguous `target_stage_id`, `target_stage`, `target`, `diagnosis`, `reason` aliases. Corrections are returned in the tool result; conflicting values fail without mutation. Wrong-stage submissions return the current contract rather than misleading missing-diagnosis errors.

Model-facing status/submit/report responses are compact by default. Current instructions, gates, failures, root paths and recent receipts remain. Use `detail="full"` for complete evidence/history; human `/playbook status json` and report exports remain complete. This reduces repeated tool output, not user-context content or ordering.

## Dependency-aware repair

A failed canonical-script check returns to script, not producer/QA repeatedly. Stale final QA returns directly to QA. Subtitle and manifest-reference corrections stay near the current checking phase instead of regenerating all assets. Affected accepted evidence is invalidated; the engine does not delete or render files, and unchanged verified same-run assets remain reusable.

Each revision/source-stage/error family gets at most three automatic recoveries. All actual gate submissions still count against the original 64-submission run budget. No permission, ownership or cross-run failure is waived. Exhaustion remains a failure, never a fabricated pass.

## Subtitle and visual timing

SRT remains supported. ASS can use an explicit narration style selection:

```json
{"subtitles":{"path":"final/captions.ass","format":"ass","narrationStyles":["Txt"]}}
```

The selected narration track must cover the complete spoken script. Other styles may be quote/title overlays, not duplicated speech. Display punctuation is normalized while wording, numbers, decimal/sign/percentage punctuation and actual narration timing remain checked. ASS requires a proper Events Format with Text last.

The voice track determines final duration, not the lifetime of every overlay. A quote may remain visible for two seconds while its natural narration continues over subsequent visuals. Do not accelerate or loop speech to fit arbitrary fixed scene lengths.

## Remove false gates; reuse valid measurements

Unchanged generic cover bytes after a video edit now produce a content-review advisory, not an automatic failure. Check actual wording rather than changing an irrelevant pixel. Cover decoding/current-video binding and final artifact consistency remain required; no OCR comprehension is claimed.

Handoff rehashes all previously checked artifacts and compares material manifest fields. Identical bytes/references/timing can reuse accepted same-run measurements without another full decode. Changed files/timing still fail as QA_STALE. Unrelated report metadata does not force video regeneration. Older or excessively large cached snapshots fall back to full validation.

## Read-only inspection

The real `present` tool, file/image reads and job-output queries are allowed within existing tool policies while awaiting review. `playbook(action="diagnose")` measures a recorded candidate/previously checked media path only, through the same guarded Host pipeline and cancellation tree. No arbitrary path/command, raw-shell fallback, acceptance, revision or budget reset. Results are explicitly `readOnly` and `notAGate`.

Decode/duration/PCM/low-level measurements do not establish exact spoken words or a repeated-speech loop. No ASR is added. A denied measurement cannot support a factual audio diagnosis.

## Keep the pilot small

New media instructions scope pilot work to one complete natural segment and the real audio/layout chain. Minor cosmetics should not drive repeated full production. After 32 observed tool results, a non-blocking status/prompt notice asks whether the stage is expanding unnecessarily. This is not a hard call/time limit and does not cancel jobs or guarantee model compliance.

Run isolation, zero-audio rejection, full narration coverage, hashes, linked revisions and protected SOP approval stay in force. State remains v3 with optional recovery counters; template version is 0.7.0 while machine-result protocol remains 0.4.0. Tests use synthetic state and actual FFmpeg/ASS/SRT fixtures. No E5 or real Qwen/MiniMax experiment has been rerun; passing tests do not prove real production quality or speed gains.

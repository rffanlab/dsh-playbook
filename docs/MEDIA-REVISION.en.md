# 0.4.0: controlled video delivery after the MiniMax audit

[中文](MEDIA-REVISION.md)

Update main under the original DSH service account, DSH_HOME and Web Profile, restart, refresh and use a new session. All 19 SOPs and automatic selection remain. The full narrated-media contract applies to newly started `bilibili-video-production` and `short-video-production`. Other workflows gain generic repairs, shape corrections and reports, not imaginary media validators. Existing pinned runs do not acquire new rules.

## Workflow and manifest

Delivery brief → probe public capabilities/templates → freeze full narration and exact segments → validate the first natural segment as a pilot → produce full assets → independent technical QA → content review → awaiting user review.

There are eight normal-path stages and one off-path diagnosis node. The engine counts definitions/events rather than accepting model-written totals.

The Agent, not the user, creates `production.json` inside the session workspace. The script stage needs:

```json
{"schemaVersion":1,"script":"narration.txt","segments":[{"id":"S01","text":"First complete spoken paragraph."},{"id":"S02","text":"Second complete spoken paragraph."}]}
```

The canonical file contains spoken text only. Joining segment texts in order must equal the full script after Unicode/whitespace normalization. Summaries cannot replace the script; intentional literary ellipses are not banned. Unique segment IDs and accepted text hashes prevent unnoticed downstream text changes.

For the pilot add the first segment's `audio` path and a `pilotVideo` path. For full production each segment also needs measured `start`/`end`, and the manifest adds `video`, `cover`, `title`, `subtitles` (SRT), measured `durationSeconds`, and the actual `coverForVideoSha256`. Manifest-relative asset paths resolve against the manifest directory. The tool's `production_manifest` path resolves within the current DSH session workspace. Subtitle text must cover the canonical script; timestamps must be valid and non-overlapping. Different spoken segments must not reuse identical audio bytes.

## Independent checks and limits

During validator-backed submissions, the plugin launches its bundled read-only Python worker through the same Agent's DSH `bash` pipeline, forwarding parent/root identity and cancellation. Existing guards, approvals and sandbox policy remain authoritative. There is no unguarded Host shell/filesystem fallback, new online model or automatic installer. Agent-supplied pass flags and fabricated validation JSON cannot replace worker results.

Requirements: Python 3.9+ standard library, FFmpeg and ffprobe. Missing executables/permissions are unverified prerequisites. Missing newly produced files are repairable validation failures. Paths and resolved symlinks must stay in the session workspace. URLs and playlist demuxers are not supported. Bounds: 512 MiB per artifact, 1 MiB text/manifest, 15-minute media. Exceeding a bound never claims a complete inspection.

Checks cover full script/segment mapping, source audio decoding/nonzero PCM, complete video/audio decoding, low-level intervals, A/V duration, segment timing, subtitle text/time, cover decoding, version metadata and SHA-256 bindings. Handoff revalidates against the accepted QA snapshot. Changes during reading fail.

The narrated-video policy uses 100ms RMS windows below -40dB, intervals of at least 0.3s, a maximum 3s low-level gap, and a maximum 50% low-level ratio. These are template test criteria, **not platform rules or universal quality thresholds**. Intentionally long silent, music-only or oversized videos need a different authored workflow, not fabricated passing evidence.

There is **no ASR or phoneme alignment**: declared TTS text matching does not prove every word was spoken correctly. Background music may mask absent speech. There is no OCR of cover text and no frame-difference proxy for narrative quality. Results explicitly state `speechRecognition=false` and `semanticVerification=false`. Hearing, vision, factual and editorial review still require capable agents or users.

A changed video with an unchanged rejected cover is conservatively stale, requiring regeneration/review. This can reject a legitimately reusable generic cover; it does not understand embedded words and cannot defeat meaningless one-pixel edits. Hashes prove a point-in-time artifact set, not permanent immutability against external writers.

## Revision control

Video success ends at `awaiting_review`, not user acceptance. Explicit direct-user rejection reopens the **same run** with a new revision and diagnosis stage; it does not replace production with a separate review SOP. The Agent calls `repair` with an earlier/same allowed stage and concrete diagnosis. Old candidates, hashes, rejection events, total budgets and history survive; affected accepted evidence and checks are invalidated.

Chat controls:

```text
/playbook report
/playbook report markdown
/playbook revise Please diagnose and repair the previous candidate
/playbook accept
```

An explicit direct “验收通过”/“I accept this version” also records acceptance. Quotes, code and hypothetical questions are not approvals. Ambiguous language may need the command. With automatic routing off, use explicit commands.

Default limits: 64 execution-gate submissions globally, two user revisions and three autonomous repairs per video run; other workflows default to two repairs. Repair cannot skip prerequisites or reset budgets. Failed runs continue to restrict work tools but allow controlled repair/report/check. Missing-authority/dependency blocks still require user resolution and resume. Cancellation does not roll back files or background jobs.

## Format correction and reports

The exact singleton `{item: [...]}` mistake is unwrapped only when the gate requires an array, with a recorded lossless correction. Objects with extra fields or ambiguity are not coerced. Other errors identify the path, expected/actual types and shape. `check` is optional format/receipt preflight; pending machine checks never count as an artifact pass. Actual media is read on submission.

After candidate delivery the Agent calls `export_report`. The plugin constructs the path/content and uses DSH `write` to create a uniquely named `execution-report.system.rN.<id>.md` beside the validated video. All other guards remain effective; there is no direct-write fallback. `report` also returns JSON/Markdown directly.

Facts include actual stage definitions/path, gate counts, shape repairs, controlled repairs, human rejection/acceptance, revisions, candidate hashes and engine timestamps. Engine start is not user enqueue time; elapsed time includes waiting and is not model compute time. Reports are not signed or tamper-proof. Agent commentary can be separate, not a replacement for system facts.

Starting another task archives up to 20 prior run snapshots per session. Reports index them; full snapshots live in state `archives`. This is not an unlimited database or full session log. State v2 can read v1, but older plugins do not safely understand new states; back up before downgrading.

## Verification

Public tests use anonymized/synthetic fixtures, never the user's raw session, videos or private assets. Node tests cover engine/interfaces; Python tests invoke real FFmpeg and decode real generated media. Tone fixtures demonstrate technical checks, not speech correctness. Live MiniMax reproduction and target E5 Web/browser end-to-end validation remain separate and have not been claimed.

# 0.9.0: bind final attachments to the verified candidate

[中文](ARTIFACT-DELIVERY.md)

## The gap

Earlier run-directory, media-validation and known-hash checks were actual implementation, not merely prompts. They primarily checked submit. The v0.8.0 plugin did not bind the final native `present.files` selection to the current candidate. Native DSH present records accessible source paths, not preserved file bytes. Validating A then presenting B, or overwriting an already presented working file, are separate outlet problems.

A synthetic original-Guard reproduction confirms that an old final outside the current Run was not rejected at present. It does not establish the unique cause of a historical incident; identical files prove equal bytes, not who produced them or which step reused them.

## Normal operation

For new media production runs, the Agent uses `build` with the actual foreground final assembly command and 1..8 exact `output_paths`. Existing Bash, same Agent and parent/root call IDs, stage policies, sandbox and cancellation are retained. Read-only probes measure declared outputs before and after actual execution. Nonzero exits, missing outputs, background acknowledgements, no-op commands and a changed dummy file beside an unchanged untracked final cannot supply a production witness. Default timeout is 120 seconds, configurable by timeout_ms from 1 to 600 seconds within existing Host limits. Long-running asset generation remains with the original tools; this entry is for final assembly.

Unchanged files already witnessed in the same Run retain their earlier witness. Video/handoff Gates require a matching final-output witness for new runs, in addition to existing real media QC. This observes a command window; it does not certify semantic authorship or untainted inputs.

A successful final submission automatically delivers its verified candidate. `deliver` retries only attachment preparation/presentation after an outlet failure, without rerendering or changing QC. `artifacts` and status.artifactDelivery expose system-generated identities; users need not manage IDs manually.

## Exact-file delivery

Current run/candidate key → registered artifact identities and measured manifest → verify source hashes → exclusively create a unique `.deliveries/<UUID>` → copy and rehash → native present of the fixed copies → verify actual returned paths and bytes → durable prepared/presented receipt.

No filename search or old-file fallback is added. Video, cover, exact narration, title and subtitles come from explicit verified manifest references. A system report and delivery receipt bring the default to seven files. One optional current-run auxiliary text report is allowed through extra_paths; it is labeled auxiliary, never QC authority. Lower Host presentation limits fail explicitly.

Direct present of a prior/cross-run final is rejected. Final candidates use deliver rather than a guessed working path. Non-media code/document/audio workflows are not made subject to video rules, and current-root non-final image/document previews remain available. Unknown third-party delivery APIs are not claimed to be covered.

Known video digests are preserved separately from the bounded old-run archive. Existing human exclude-hash entries remain effective. The plugin does not scan the whole disk, publish private digests or pretend to know untracked outputs. Exact duplicates establish unproven independence, not automatic plagiarism.

Fixed copies use exclusive creation, unique paths and ordinary read-only permissions. The plugin does not overwrite them when source files change. They consume disk space; no automatic deletion of the user's assets or delivery history is introduced.

## Compatibility and limits

Existing Runs, method snapshots, projects, candidates and history remain. Legacy runs without production witnesses are not retrospectively credited: their report records absent producer evidence. Where an actual candidate and original isolated/legacy continuation scope exist, they can deliver verified fixed copies without rerendering just to upgrade. Missing bindings require rechecking the existing candidate, not guessing a different final.

Internal fixed IO exemptions match the complete registered arguments, caller identity and call tree. The actual production command receives no exemption. External Host rules remain; no raw-filesystem fallback or automatic user acceptance is added.

Command/output association is not model authorship, provenance of every input or protection from another same-user process. Unknown copied/re-encoded files cannot be reliably detected by known hashes. Read-only copies are not an OS security sandbox; native DSH still serves paths, and third-party download mapping/cache behavior is not audited here. Only media-validator production runs using this plugin's outlet are covered. Mixed engineering/video requests still need an explicit production scope. No ASR, semantic-quality score or live E5/model result is claimed.

Update main with the original service account/DSH_HOME, back up actual state, and restart the Profile. runtimePluginVersion is 0.9.0; method versions may remain pinned. Do not cancel, clear state or reapprove an unchanged method merely to install this patch.

Verification includes original-Guard reproductions, real subprocess IO, negative/denied/no-op builds, changed candidates, persistent prior hashes, filesystem links, snapshots, presentation retry and non-media isolation. Real FFmpeg fixtures plus scripts/delivery-smoke.mjs exercise generation → media/subtitle QA → automatic snapshots → simulated Host present. They are not a deployed browser/E5/live-model end-to-end test.

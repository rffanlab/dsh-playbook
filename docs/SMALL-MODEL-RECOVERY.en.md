# 0.9.4: recovery feedback that small models can act on

[中文](SMALL-MODEL-RECOVERY.md)

A real 27B media run received only `video: A non-empty local path is required`. The top-level video path existed; the actual mismatch was missing inline `segments[].audio/start/end` while equivalent values lived under `segmentTiming`. The model then issued 170 identical reads of the same production manifest. A larger model eventually inspected plugin source and reverse-engineered the hidden contract.

0.9.4 moves that contract into the validator result. Repairable manifest failures expose stable `MANIFEST_*` codes, exact JSON paths, measured values when relevant, and a minimal hint. Compact Playbook output preserves the structured diagnostic. Manifest recovery tells the Agent to change the named field/dependency rather than reread unchanged data or inspect plugin internals.

The canonical segment form remains `{id,text,audio,start,end}`. For compatibility, missing `audio/start/end` can be read from a top-level `segmentTiming[id]` object in the validation-only in-memory view. Inline values win, source JSON is not mutated, and all media/timing/subtitle/hash checks remain in force.

Tool observations now include deterministic argument fingerprints scoped to the current stage epoch. After a failed Gate, a fourth consecutive identical read/grep/glob is denied with `NO_PROGRESS_REPEAT` and the last Gate failure. A different diagnostic or any state-changing work breaks the sequence. This is a no-progress guard, not a three-read budget and not a user revision limit.

High-activity notices are stage-aware: pilot guidance is only used in pilot; QA and other stages point back to structured Gate diagnostics and the smallest state-changing repair.

These changes reduce hidden-contract reasoning load but do not guarantee model quality, accept arbitrary schemas, or create a global Harness loop detector. The media protocol remains validatorVersion 0.4.0 for old-run compatibility; implementation identity remains available through the worker SHA and runtime plugin version. Tests use synthetic media, not the user's E5 or a live 27B/128B benchmark.

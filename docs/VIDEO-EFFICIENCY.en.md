# 0.10.0: efficient video workflow for smaller models

[中文](VIDEO-EFFICIENCY.md)

The optimization removes model round-trips, not quality checks. New built-in produced-video tasks use `preflight → pilot → produce → qa`; `diagnose` is entered only after direct user rejection.

Preflight combines task/source boundaries, capability selection and exact narration freezing in one Gate. Accepted preflight evidence stores a project-scoped non-secret capability hint so recurring voice/image/render services need only a minimal health probe on later episodes.

Pilot validates one natural segment. Produce batches independent assets and reuses unchanged same-run work. QA first performs cheap collect-all manifest lint, then real media decoding/timing/subtitle/hash checks. Content review is part of QA; one representative contact sheet is preferred over one vision turn per asset. ASR is bounded to one full pass plus one targeted retry when a concrete discrepancy exists.

Terminal QA creates an awaiting-review candidate and fixed-snapshot delivery automatically. Direct user acceptance remains separate.

Soft tool targets are preflight 12, pilot 10, produce 36, qa 14 and diagnose 8. They are advisories, not quality waivers. A fourth consecutive identical read/grep/glob in the same stage epoch is blocked as `NO_PROGRESS_REPEAT`; state-changing work or a different diagnostic resets that sequence.

Existing active Runs and approved project SOPs keep their pinned definitions. The short chain applies to new built-in video tasks unless a project-specific approved method says otherwise.

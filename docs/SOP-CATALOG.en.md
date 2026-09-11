# SOP catalog

[中文](SOP-CATALOG.md)

19 starter templates. Read the full instructions and evidence constraints using `/playbook inspect <id>`. They are executable contracts, not empirically proven optimal methods.

| SOP | Stage sequence |
|---|---|
| `bug-fix` — Bug Fix | Reproduce the defect → Find root cause → Implement the smallest safe fix → Verify the fix → Review scope and risk |
| `feature-development` — Feature development | Define requirements and acceptance → Inspect and design → Implement a focused change → Verify behavior and regressions → Deliver artifacts and limitations |
| `plugin-development` — Plugin development | Verify host contract → Design lifecycle and boundaries → Implement plugin and docs → Verify behavior and regressions → Host load/unload smoke test → Deliver artifacts and limitations |
| `dsh-plugin-development` — DSH plugin development | Verify DSH version and contracts → Design scopes and state → Implement DSH integration → Check packed exports → Isolated Profile and Web smoke → Deliver artifacts and limitations |
| `code-review` — Code review | Establish review scope → Inspect behavior and risks → Validate findings → Deliver prioritized findings |
| `release` — Release preparation | Verify version and changes → Build and test → Install and rollback smoke → Deliver release package |
| `incident-response` — Incident response | Triage scope → Choose reversible recovery → Recover within authorized scope → Identify cause and prevention → Deliver artifacts and limitations |
| `linux-service-deploy` — Linux service deployment | Host preflight → Plan reversible deployment → Install and configure → Verify service readiness → Deliver artifacts and limitations |
| `model-deployment` — Local model deployment | Model and hardware preflight → Choose serving config → Install and start → Measure capabilities and workload → Deliver artifacts and limitations |
| `short-video-production` — Short video production | Define audience and output → Design topic and hook → Ground the script → Produce video assets → Inspect rendered video → Deliver artifacts and limitations |
| `bilibili-video-production` — Bilibili video production | Define viewer payoff → Collect evidence → Structure script and visuals → Produce the video → Watch and verify → Deliver artifacts and limitations |
| `video-review` — Video review | Verify access to media → Inspect opening and media quality → Check claims and payoff → Deliver actionable changes |
| `wechat-article` — WeChat article | Read the brief and source → Design headline and structure → Write the draft → Verify claims and readability → Deliver Markdown and cover brief |
| `music-production` — Original music production | Define music brief and rights → Write lyrics and structure → Plan arrangement and generation → Generate and assemble audio → Listen and inspect → Deliver artifacts and limitations |
| `music-release` — Music release preparation | Check rights and platform scope → Check release assets → Prepare metadata → Deliver upload package or authorized receipts |
| `research-report` — Research report | Define research question → Collect sources → Cross-check and analyze → Review load-bearing claims → Deliver artifacts and limitations |
| `data-analysis` — Data analysis | Define question and data scope → Check data quality → Calculate and interpret → Recalculate and reconcile → Deliver artifacts and limitations |
| `sop-authoring` — SOP authoring | Define applicability → Design stages and evidence → Produce loadable definitions → Test loading, routing and failures → Deliver artifacts and limitations |
| `task-intake` — Unclassified task intake | Clarify the deliverable → Check capabilities and boundaries → Make a bounded plan → Execute the scoped task → Verify acceptance → Deliver artifacts and limitations |

## How to inspect evidence

`inspect` returns every stage objective, instructions, tool policy, evidence schema, retry and next/on-failure target. `status` shows the current stage plus actual gate failures. Submit only observations/artifacts that exist. New stage instructions expose type, length, count and equality constraints; descriptive completeness is not independent proof of truth.

Most gates allow two submissions before failure or an explicitly declared return to implementation/production. Runs have a global 64-submission cap. The built-in bug-fix verification additionally requires an observed bash tool success, which does not prove process exit zero or passing tests.

`release` and `music-release` default to preparing deliverables. No template silently authorizes public posting, account operations or signing. `task-intake` is an explicitly labeled fallback; unknown work is not claimed to follow a specialized expert method.

# 0.8.0: route the requested deliverable, not media-related nouns

[中文](TASK-SCOPE.md)

The previous video predicate searched the whole request/source text after a few exclusions. A media CLI integration task could therefore become mandatory video production merely because the API manual mentioned supported video formats. Intake saved that heuristic hint and authorization treated it as a protected requirement. An Agent's correct engineering selection was rejected and it asked the user to rename the project.

## Changes

`task-scope.js` supplies one deliverable analysis to recommendations, intake, method derivation and admission. An explicit direct-user operation takes precedence over the appended manual, examples, supported formats and project name. A source brief defines the task only when the user delegated the deliverable to it and the request itself did not name an output. Classification does not delete/reorder messages; complete task/source data remains available for execution.

Media-tool integration, plugin/code work and configuration are not video production. Writing scripts/docs/subtitles, creating images/audio and reviewing an existing video likewise do not need narration/pilot/MP4 gates. Actual produced-video requests still select the relevant domain workflow, run isolation and real media checks. Compound outputs remain marked mixed rather than claiming that a single SOP covers everything. Unknown requests remain eligible for Agent selection or task-intake; this is a conservative rule-based extractor, not a perfect semantic classifier.

A pre-start mismatch returns `SOP_TASK_MISMATCH`, its taskScope, selected/suggested base and `nextAction=select_matching_sop`. It means select an appropriate method, not obtain new user permission, rename the project, clear state or produce an unwanted video. Stale intake hints are recomputed. Model task/note/requirements cannot override a captured explicit video request. Active run snapshots cannot be rewritten through intake.

A project's approved video method does not govern unrelated engineering/doc tasks in the same project. `sop_list` adds `matchesCurrentTask`; definitions are not removed or weakened. Existing approval rules still protect replacement of applicable approved methods.

## Update and compatibility

Back up the actual state and use the original service account/DSH_HOME:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart the original Profile. In a conversation stuck at intake with no Run, continue the original integration task. No project rename or new SOP is needed. Transient intake data is lost on restart, so the Agent may repeat intake from the existing conversation. `runtimePluginVersion` is 0.8.0; unchanged method snapshots may still show 0.7.0.

State remains v3 with optional `input.contract.taskScope`. No active/candidate/failed run is silently reassigned. Actual Host permissions, global-config write approvals, isolation and quality gates are not relaxed. Wrong guessed paths or real access denials are separate from classification faults.

## Verification limits

Tests cover Chinese/English engineering, docs/scripts, audio/images, review vs production, misleading API examples, source-operation priority, approved video methods with unrelated work, stale hints, model-authored downgrade attempts and active-run immutability. The Host regression follows the user pre-step through intake, wrong selection, correct engineering route, contract/design/implementation, without media allocation or validation. Public fixtures are synthetic, with no private sessions/paths/credentials.

A private offline replay uses the original user request and intake/route arguments: old code selected short-video-production and rejected engineering; new code starts engineering with zero video validators. Neither replay nor CI is an E5 deployment, completed global tool installation or a live-model quality measurement.

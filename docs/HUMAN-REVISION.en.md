# 0.7.4: user revisions are not autonomous retries

[中文](HUMAN-REVISION.md)

## Corrected policy

The old `delivery.maxRevisions=2` rejected a third explicit human request. Merely removing that comparison was insufficient: gate submissions and self-repairs also exhausted lifetime counters across otherwise legitimate revision rounds.

Explicit human revisions now have **no fixed count limit**. They retain the same run/session, artifact root, pinned SOP, previous candidates and review history. Redelivered user message IDs and stale UI targets do not grant another revision.

Automatic work remains bounded **per direct user instruction**, not over the lifetime of the work product. The default is 64 gate submissions per cycle; the SOP's maxSelfRepairs still limits autonomous repair inside that cycle. A new direct user review starts another cycle without deleting earlier submissions, failures, repairs or audit history. Model repair/recover/check/status/reload and purported user permission cannot renew it.

`workBudget` reports current-cycle use/remaining counts, lifetime totals and `userRevisions.limit=null`. Existing report counters remain lifetime facts, not newly zeroed claims of first-pass success. Counts do not measure token spend, money or wall-clock time; external Host limits remain in force.

## Continue an exhausted cycle

On real automatic exhaustion, report progress and the actual blocker rather than proposing cancellation, reset or SOP-external work. A direct user continuation such as `继续原任务` or `Continue this task` can begin another bounded cycle in the same run, revision and stage. It cannot reject an awaiting-review candidate, waive a missing permission/input, or revive a cancelled task. The optional human command is `/playbook continue`; the model tool has no continue/reset-budget/accept/reject authority.

Continuation recognition deliberately accepts only explicit short phrases. Quotes, examples and model/tool messages do not renew work. Existing scoped checks and stale-result/epoch protection remain. Unchanged valid artifacts are preserved, not deleted or automatically regenerated.

## Compatibility and operation

Old pinned `maxRevisions` values remain as ignored compatibility metadata; new definitions default to null. Project-method comparison disregards only this deprecated field, while preserving real gate, stage, tool and automatic-repair protections. Approved methods need no reapproval simply to receive this runtime fix.

Back up the actual state file, update with the original service account/DSH_HOME, and restart the original Profile:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Return to the existing conversation and resend the intended rejection. Do not cancel, clear state or start another run. Check runtimePluginVersion=0.7.4, not the pinned SOP version. Previously unregistered feedback is not silently replayed during upgrade.

Tests cover third/many reviews, legacy snapshots, more than64 lifetime submissions, finite per-cycle retries, persistence/restart, duplicate/stale events, direct continuations, model/quoted non-authority and failing quality criteria. There is no new live-model/E5/video result. Media checks, artifact isolation and Host permissions are unchanged. Earlier documents' lifetime-64/two-revision descriptions are historical; current workBudget is the governing counter definition.

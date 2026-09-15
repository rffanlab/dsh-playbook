# 0.7.2: recovery must not be blocked by intake

[中文](RECOVERY-DISPATCH.md)

## Reproduced failure

On the complete 0.7.1 plugin wiring: retain an eligible failed manifest-base run, deliver a direct continuation request, then call recover. Pre-step incorrectly created pending intake. The fixed read-only Bash probe passed the run-state guard but was refused by the separate intake guard. The earlier smoke called recover directly and missed the preceding user-message path.

This is a synthetic source-level reproduction, not a new deployment trace or model run. The current user report is an excerpt; additional deployment restrictions have not been ruled out.

## Fix

Failed-task continuations remain with their original run instead of starting new intake. A recognized adapter incident is handled before counting another revision. Existing user messages, task identity, history and budgets are not cleared.

Plugin-owned control-dispatch recognition is shared by this plugin's run and intake guards. Recovery exemptions match the complete call identity (call ID, Agent, parent, rootCallId) and complete arguments, and expire on completion. Changed commands, workdirs, timeouts or escalation fields do not inherit the exemption. Independent Host policies, other plugins, isolation and cancellation still apply; there is no raw-shell fallback or Host code change.

A failed probe now returns bounded hostFailure details: call ID, actual error code/message and execution category. Errors are not all mislabeled as missing user approval. Compact output preserves the explicit next action instead of overwriting report_actual_host_failure with recover. Genuine permission refusal remains authoritative; off-SOP production is not an alternative permission path.

Recovery still requires a real successful read-only probe and is not a gate pass. Original task, stage, revision, candidates and budgets remain. The existing 0.7.1 incident key is retained so patch updates do not repeat completed recovery.

## Update

Use the original service account and DSH_HOME, then restart that Profile:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Continue the original conversation. No extra approval to erase the run or leave the SOP is needed. Model status responses and `/playbook status json` expose `runtimePluginVersion`, which should be `0.7.2`; the pinned `run.playbookVersion` may remain older.

If another Host policy refuses the probe, report its exact hostFailure rather than offering a menu of clearing state, bypassing the SOP or changing Host code. Updating this plugin does not guarantee all external permissions or content problems are resolved.

## Validation

New all-guard regressions cover user continuation, stale pending intake, preserved run/budget, external refusal, eight mutated call identities/argument sets, error detail and compact-response precedence. The existing isolation smoke now includes pre-step before simulated Host dispatch runs real Python and normal gate submission.

No schema migration, new dependency, gate relaxation, E5 access or new MiniMax/Qwen generation. Source fixtures and CI do not establish that the user's v3 was produced or reviewed.

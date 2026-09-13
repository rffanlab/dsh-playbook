# v0.3.0: execution receipts and format repair

[中文](QUALITY.md)

This release fixes source-audit reproductions of v0.2.0. The requested external experiment transcript could not be retrieved. Fixtures are synthetic, not a replay of a model conversation, and no live-model quality gain has been measured.

## Evidence and retries

Whitespace cannot pad string length. Null/blank/empty records cannot fill evidence arrays; explicitly optional empty finding lists still accept `[]`. Unsupported gate fields now fail instead of silently dropping imagined validators.

The model's `check` action validates `stage_id` and `evidence` without transitions, attempt consumption or persistence. Pure format errors on submission retain the stage and recorded work. Three consecutive format repairs block the run. Failed criteria, missing work and invalid execution receipts still follow execution retries and branches.

Only accepted evidence flows forward. Backtracking invalidates accepted evidence for the target and its downstream stages so old test findings cannot silently verify new implementation. This does not roll back files or external effects.

## Host command receipts

Five built-in gates now require `verification_call_id` and the exact `verification_command`: bug-fix/verify, feature-development/verify, plugin-development/verify, dsh-plugin-development/package-check, release/build.

Run the real check through the existing DSH bash tool in the foreground. Obtain its receipt ID from current-stage observations in `status`. The final canonical Host result must have exit code zero without timeout, abort, signal or sandbox failure, and the submitted command must match the recorded SHA-256 fingerprint. A background job acknowledgement, stale-stage receipt, unknown shape, prose claiming success or a printed exit marker does not count. No separate command executor or permission bypass is added.

The collector stores IDs, tool name, command hash, outcome and exit code, not stdout/stderr or raw commands. Submitted evidence is persisted, so reference secret environment variables rather than embedding secrets. Only the verified canonical foreground shape is recognized; unknown results fail closed. Each tool retains 16 recent receipts and a 128-call duplicate-detection window.

A zero exit proves that command's process outcome, **not** that it is a sufficient or trustworthy test. An echo command is not verification. Independent test-selection review, artifact-content validators and Reviewer agents are not implemented. Content/media gates remain primarily structural checks.

Custom gate example:

```json
{
  "evidence": [
    {"key":"check_id","type":"string"},
    {"key":"check_command","type":"string"}
  ],
  "toolResults": [{"name":"bash","callIdKey":"check_id","commandKey":"check_command"}]
}
```

## Block instead of fabricating progress

Use `action=block` with a concrete `note` for missing inputs/tools/permissions. The run and stage are preserved, work tools are blocked, and automatic routing does not replace it. PTC `run_code` remains a control transport; nested tools still pass the guard. This is not an OS sandbox.

Once the prerequisite is resolved, the user runs `/playbook resume` or clicks the panel's resume control, then sends a continuation message. `/playbook cancel` abandons the run. Neither action rolls back completed effects nor automatically cancels published background jobs. Model-side cancellation is disabled, and a terminal run cannot be restarted by the Agent without a fresh direct-user task. Human commands retain control.

## Diagnostics and compatibility

`/playbook report` or `action=report` returns the session's latest run, gate pass/fail, format-repair, invalidation and blocker counts plus event history. It is not the complete chat transcript or a database of every prior run; starting another run still replaces the previous one.

Submission returns explicit `gatePassed` and `nextAction` fields: transport `ok=true` is not gate success. Progress responses omit bulk prior evidence; `status` returns the full record. Bounded stage context prioritizes the task, failure reason and recent accepted evidence.

Update main and restart the original DSH Profile. The 19 shipped templates become 0.3.0; existing runs keep pinned definitions and do not automatically acquire new receipt gates. Use a new session for comparisons.

Tests cover source-audit fixtures, a mocked Host integration, actual published SDK contracts and package exports. They do not replace deployment-version Web/browser or real-model end-to-end evaluation.

An optional SOP-authored `toolResults[].command` pins the expected command. When set, an unrelated successful command fails even if the model honestly submits its actual command. Generic built-ins cannot know a project-specific test command and do not pin this value.

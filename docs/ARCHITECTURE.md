# dsh-playbook Architecture

## Responsibility split

```text
Model / Agent
    |
    v
playbook tool  <----> PlaybookEngine ----> durable run snapshot
    |                  |       |
    |                  |       +---- Gate evaluator
    |                  +------------ stage/retry/branch state machine
    v
dsh-tools guard + tools/result observer
    |
    v
DeepSeek Harness tools / subagents / sandbox / APIs
```

The plugin intentionally does not replace the DSH agent loop or workflow engine. It is a policy/state layer on top of public Harness extension points.

## Invariants

1. A run has exactly one current stage while active.
2. Only `submit()` can advance or branch a run.
3. A passing Gate follows `stage.next`; a failed Gate never silently advances.
4. Tool observations reset on stage transition/retry so evidence cannot leak from an earlier attempt.
5. The `playbook` controller tool is never blocked by the stage tool policy.
6. STRICT allowlists and all deny rules return monotonic guard denials.
7. Run state is persisted outside the model context.
8. A run pins an embedded Playbook snapshot at start; catalog reloads cannot mutate an in-flight workflow.

## Why not use ctx.workflowEngine as the state machine?

DSH's workflow seam is designed for model-written orchestration scripts that can fan out subagents. A Playbook is different: its stage graph is expert-authored policy and must remain authoritative even if the model would prefer a different route. Future stages may invoke `ctx.workflowEngine` or a managed subagent as an execution primitive, but they do not delegate transition authority to it.

## Gate evolution

v0.1:
- evidence shape checks
- observed tool call/success/failure checks

planned:
- shell/test exit-code validators
- file existence/hash/content validators
- JSON Schema validators
- independent reviewer-subagent validators
- human approval gates
- historical metric gates

## v0.2 routing layer

`routing.js` owns bounded literal metadata validation, heuristic recommendation and session-local selection. `automation.js` wraps the public pre-step waterfall, preserves downstream rejection/message identity/series flags, excludes child prompts and contributes the selected stage to the same accepted step. Long or ambiguous tasks are handed to the existing Agent for explicit semantic selection; work tools remain gated while a selection is pending. `tool.js` is the SDK-neutral definition; `index.js` wraps it in the actual DSH `defineTool` and supplies `createUserMessage`.

Hydration is awaited before startup mutations. Selection never replaces an active run. Gate constraints are fully rendered. Accepted task/routing metadata live in durable `run.input`; per-session automatic-mode overrides are intentionally transient. Tool observations carry run/stage/attempt/epoch identity, so late results cannot satisfy a later visit. A bounded gate-submission budget terminates branch cycles. Failed persistence rolls back in-memory run mutations.

Template coverage and state-machine fixtures establish contracts only. They do not prove semantic evidence, operational permissions, production compatibility, or real-model task quality. CI distinguishes dependency-free unit tests, packed-file contracts, and real SDK smoke; target-version Web/Profile/browser/model verification remains separate.

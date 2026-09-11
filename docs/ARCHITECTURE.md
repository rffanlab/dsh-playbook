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

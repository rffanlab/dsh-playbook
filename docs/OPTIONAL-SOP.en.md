# 0.9.3: SOPs are optional methods, not a prerequisite for every task

[中文](OPTIONAL-SOP.md)

Playbook takes control only when a specialized method clearly applies. With no applicable SOP, Harness continues under the user's instruction and its existing tools, permissions, safety policy and context.

`task-intake` is no longer the mandatory fallback for unknown work. It remains an opt-in structured planning/intake workflow and can still be started manually. A model may not force it merely because no better method exists.

Routing has four outcomes: `match` for one clear complete method, `ambiguous` for multiple complete matches, `passthrough` for no complete match, and `conversation` for ordinary chat. Partial words such as plugin/model/video are only hints. “Uninstall model-mgr” may contain plugin/model terms, but its deliverable is maintenance, not plugin development or model deployment.

Passthrough applies only before a Playbook is attached. An active run retains its pinned stages, gates, repair rules and permissions. Passthrough never expands Host authority.

A passthrough task does not contaminate the next direct user task. Genuine native clarification for the current intake is still merged into that task.

Project SOP authoring remains available, but absence of an SOP is not by itself a reason to generate one. Clear one-off maintenance should usually execute directly; recurring methods can be captured when doing so has real value.

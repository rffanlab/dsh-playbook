# 0.9.1: rejection dispatches work, not only a state transition

[中文](REVISION-WAKEUP.md)

DSH human commands directly invoke their handler without creating a model message. The previous revise/panel-reject path only persisted requestRevision and returned text. An idle Agent therefore stayed idle after a successful command. A repeated review was then rejected because the Run was already active.

This patch persists a review and a dispatch intent together, then invokes the exact live Agent's public steer with a plugin-source message. Idle Agents wake through the normal driver; busy Agents receive steering at the nearest step boundary. No parallel driver or private run API is used. inject is not an acceptable substitute because it does not wake idle Agents. The command does not await whenIdle or the whole rendering job.

Status/report exposes revisionDispatch: pending, queued, claimed, failed or discarded. Native inbox claimed/discarded events update these receipts. Queue admission is not successful task completion or acceptance.

Explicit supplementary feedback in an active/blocked existing revision is appended to that revision, preserving stage, epoch, artifacts and automatic budget. It does not remove real prerequisites or permission blockers. Re-delivery of the same native commandId does not create another revision or execution message. Stale panel candidate targets remain errors. Normal chat is already a driven turn and does not receive an additional waking message. Model tools cannot invoke human review/dispatch controls.

State-write failure prevents sending uncommitted instructions. Native steer failure reports that feedback was saved but work was not dispatched, with the actual error. No inject-only fallback, cancellation, new task or permission expansion occurs. If the send succeeded but audit persistence failed, retries reconcile in-memory receipts and the public inbox/session insertion record. Cross-file power-loss exactly-once is not claimed. Upgrade does not automatically revive historical tasks or host-cancelled messages.

Update main under the original account/DSH_HOME and restart the original Profile. In an existing already-rejected but idle conversation, reissue the original /playbook revise command once: it supplements that revision and dispatches directly, without a subsequent continuation prompt. Future rejection is a single operation. No state clearing, Run replacement or SOP reapproval is needed. runtimePluginVersion is 0.9.1; the method snapshot remains pinned.

Unit tests cover send ordering, duplicate and concurrent feedback, native failures, cancellation, write failures, receipt reconciliation, model-tool separation and chat without duplicate wakes. React/jsdom checks the actual panel callback causes steer, not merely a changed stage. The separate revisioncheck uses real installed DSH Commands/AgentLoop/Inbox/Session/tool runtime and a scripted LLM adapter; it verifies turn/start and actual tool execution without a second user message, plus steering while a request is running. This is not an E5, live-model or real-media production test.

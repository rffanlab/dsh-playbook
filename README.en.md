# dsh-playbook

[中文](README.md)

**Select a method for the requested deliverable, not a single production pipeline for every task.**

A general DeepSeek Harness SOP plugin: a method catalog, project library, stage evidence, controlled repair and audit reports. Video production is one domain, not the engine's default task.

## 0.9.1: review commands wake the original Agent

Reject commands/panel actions now persist feedback and use native steer to dispatch actual work. Additional feedback stays in the same revision; ordinary chat does not double-dispatch. See [revision wakeup](docs/REVISION-WAKEUP.en.md).

## 0.9.0: run-bound final delivery

Deliver registered candidate copies, not another filename lookup. New media builds record actual command/output observations; final submission automatically snapshots and presents the verified files. An outlet failure retries delivery, not production. Non-media workflows do not acquire video requirements. See [artifact delivery and limits](docs/ARTIFACT-DELIVERY.en.md).

## 0.8.0: deliverable-scoped selection

Integrating media tools into all Sessions is an engineering/configuration task, not an MP4 request just because the manual lists video formats, TTS examples or cover paths. Recommendations, intake and admission share a deliverable analysis; project identity is separate from task type. See [task scope](docs/TASK-SCOPE.en.md) for the reproduced fault and limits.

| Request | Method family |
|---|---|
| Develop a video plugin, integrate a CLI, fix rendering code | Appropriate software/configuration workflow |
| Write docs, a video script or subtitles only | Document workflow or explicit generic intake |
| Create only audio, narration, an image or a cover | That deliverable, not a complete video |
| Review an existing video | Review, not production from scratch |
| Produce a complete video | Applicable production SOP and real media checks |

Uncertain cases remain for the current Agent to interpret; ask only materially missing task facts. Generic intake is explicitly labeled when no specialized method fits. Rules are not an accuracy-benchmarked semantic classifier, and mixed requests do not imply automatic parallel multi-SOP orchestration.

## Update and use

Back up the actual state. Use the original service account, DSH_HOME and Web Profile:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart and refresh the browser, then give a task directly. Simple clear tasks can auto-select; referenced sources/project methods require read-first intake. No routine hand-written JSON, manual method choice or start command is required.

For an integration conversation stuck at intake without a Run, continue the same task without a project rename, state clearing or method recreation. `runtimePluginVersion=0.9.1` identifies this runtime; pinned method versions may remain older.

## Engine and domain contracts

20 base methods cover engineering, review, release preparation, recovery, deployment, content, music, research and analysis. The selected method defines stage evidence; document topics and supported tool input formats do not add unwanted task requirements.

Project methods are scoped by Host cwd plus project_id. A project may maintain both engineering and content methods instead of a permanent video-only identity. Additive methods may be trials; protected changes remain drafts until human approval of the exact version. See [project SOPs](docs/PROJECT-SOPS.en.md).

Started runs pin their task and method. An Agent cannot remove a failing gate. Technical repair stays within the original Run; formatting or recognized plugin incidents should not require user cancellation/cleanup. Explicit human revisions have no fixed two-revision cap; autonomous work is bounded per instruction and lifetime records remain. See [runtime recovery](docs/RUNTIME-RECOVERY.en.md) and [work budgets](docs/HUMAN-REVISION.en.md).

Evidence submission alone is not independent proof. A software command receipt establishes the actual invocation/outcome, not sufficient tests. Artifact checks establish measured properties, not satisfaction or semantic certification.

## Video-production-specific checks

Only production methods with media validators require `.dsh-runs/<UUID>`, exact narration mapping, a pilot, audio/subtitle and final-media checks. Bilibili experiments and Taoist culture retain distinct business stages. Code, articles and audio-only work do not acquire video obligations.

Video candidates can await direct user review; rejecting in chat resumes the same task, with the panel optional. Independent experiments cannot present known old finals as new outputs, while same-work revisions may reuse unchanged assets. Acceptance isolation is not an OS sandbox or authorship attestation. See [media revision](docs/MEDIA-REVISION.en.md), [run isolation](docs/RUN-ISOLATION.en.md), [candidate review](docs/CANDIDATE-REVIEW.en.md).

## Inspect and control

In DSH chat:

```text
/playbook status json
/playbook list
/playbook project
/playbook sops
/playbook report
/playbook auto off
```

These are observation/manual controls, not routine prerequisites. `auto off` disables new intake without cancelling active work. The Web panel provides method inspection/approval and applicable candidate review.

## Verification and boundaries

Node 20+: `npm test`, `npm run check`, `npm run packcheck`. Media checks additionally use Python 3.9+, ffmpeg and ffprobe: `npm run mediatest`. Actual SDK contracts use `npm run sdkcheck`; CI also exercises React/DOM review and real Python through simulated Host dispatch.

State remains v3 with a single Host writer. This classification fix does not delete methods/messages/history or override Host file, external-action or approval policy. Tests are not an E5/live-model delivery. No ASR or independent semantic reviewer is added, and no universal routing accuracy or model-quality improvement is claimed.

[SOP catalog](docs/SOP-CATALOG.en.md) · [Changelog](CHANGELOG.md)

MIT License.

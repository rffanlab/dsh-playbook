# dsh-playbook

[中文](README.md)

**Give a task. Select its SOP automatically. Execute through stages and gates.**

Version 0.3.0 ships **19 starter workflows** for engineering, review, releases, recovery, deployment, content, music, research, analysis and SOP authoring. This extends DeepSeek Harness rather than replacing its Agent runtime.


## 0.3.0 execution-quality fixes

Adds Host command-receipt gates, read-only `check`, separate format repairs, durable blocking/human resume, stale-evidence invalidation and run reports. Automatic intake and all 19 SOPs remain. The model cannot reset gates through cancel/start; human controls remain available. See [execution receipts and format repair](docs/QUALITY.en.md). Existing runs retain old pinned definitions; test new gates in a fresh session.

## Start directly

Update using the original service account, `DSH_HOME`, and Web Profile:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart DSH, refresh the Web Client and open a new conversation. Send a task such as “Build a DeepSeek Harness plugin”, “Write a WeChat article about this plugin”, or “Deploy a local Qwen model”. No initial `/playbook start`, hand-written JSON or manual evidence submission is required.

Clear literal-rule matches are attached before work. Ambiguous matches are handed to the current Agent, which inspects the catalog and selects with a reason. The Agent asks only missing requirements, not which internal SOP name the user prefers. Ordinary chat and usage explanations do not require a workflow. No separate classifier model, credentials or online service is added.

An active run is not silently replaced by a clarification or another task. Use a new session for independent work. Automatic parallel multi-SOP decomposition is not implemented.

See [automatic routing](docs/AUTO-ROUTING.en.md) and the [SOP catalog](docs/SOP-CATALOG.en.md).

## Included scope

| Category | SOP IDs |
|---|---|
| Engineering | `bug-fix`, `feature-development`, `plugin-development`, `dsh-plugin-development`, `code-review` |
| Delivery and operations | `release`, `incident-response`, `linux-service-deploy`, `model-deployment` |
| Content and music | `short-video-production`, `bilibili-video-production`, `video-review`, `wechat-article`, `music-production`, `music-release` |
| Research and intake | `research-report`, `data-analysis`, `sop-authoring`, `task-intake` |

Every definition includes concrete instructions, evidence requirements and failure handling. `task-intake` is explicitly a fallback for unclassified tasks, not a universal expert method. These are starter templates, not empirically proven optimal workflows or evidence that a smaller model matches a larger one.

## Manual controls

Enter in DSH chat, not the shell:

```text
/playbook list
/playbook inspect dsh-plugin-development
/playbook recommend Write a WeChat article
/playbook status
/playbook status json
/playbook report
/playbook resume
/playbook auto off
/playbook auto on
/playbook start bug-fix
/playbook cancel
/playbook reload
```

`recommend` is read-only. Per-session `auto off` disables subsequent intake without cancelling an active run, and resets on Host restart. Set `DSH_PLAYBOOK_AUTO_ROUTE=0` for deployment-wide manual-by-default operation.

The existing Settings → Plugins → Playbook panel still shows the catalog and current-session Stage/Gate/tool observations and provides manual start/cancel. Automatic selection does not require opening it.

## Custom SOPs and tools

User JSON definitions load from `${DSH_HOME:-~/.dsh}/playbooks`; override with `DSH_PLAYBOOK_DIR`. `DSH_PLAYBOOK_STATE` overrides the durable run-state file. Reload with `/playbook reload`. A matching user ID overrides a built-in for future starts; active runs keep their pinned snapshot.

Top-level routing metadata supports `groups`, `keywords`, `exclude`, `priority`, `autoStart` and `examples`. Definitions without routing metadata remain explicitly selectable by the Agent or user.

The `playbook` model tool provides `list/inspect/recommend/route/start/status/check/submit/block/report/reload`. Both `check` and `submit` require an explicit `stage_id`. Model-side `cancel` remains only as a compatibility entry that returns a clear error; cancellation and resume are human command/panel controls.

## Guarantees and limits

Stage gates, retries/branches, snapshot pinning and durable run state remain. Automatic starts wait for state hydration. Stage context includes actual evidence type/length/count/equality requirements plus a bounded prior-evidence summary. A default 64-submission execution-gate budget bounds loops, with a separate three-repair format budget before blocking; neither is a token or wall-clock limit.

Tool-name policies use DSH guards, not an OS sandbox. Denying `write`/`edit` does not prevent all shell-based writes. Semantic evidence is structurally validated, not independently proven. Observed `bash` tool success is not a zero exit status or a passing-test guarantee.

SOPs do not include video/music/model engines. Missing capabilities must be reported, not replaced with fabricated artifacts. Automatic selection grants no additional publication, upload, deletion, purchase, signing or account authority. Existing user authorization and Host policy remain in force. State storage targets a single Host process, not concurrent multi-process writers.

Independent Test/File/Reviewer validators, automatic worker/model routing and a full visual editor are **not implemented**.

## Verification

From a source checkout, without model calls:

```bash
npm test
npm run check
npm run packcheck
```

With actual DSH peer dependencies installed, `npm run sdkcheck` verifies SDK imports, tool definitions, canonical output and message creation. CI runs offline tests on Node 20/22/24 and a separate current-published-SDK contract smoke. This is not a live deployment-version Web Profile/browser/model end-to-end test.

For A/B evaluation, use identical initial code/assets, model and tools. Disable automatic selection in A with no active run, and leave B enabled. Compare real acceptance, turns, calls, rework and human intervention. Never let B inherit changes already made by A.

## License

MIT

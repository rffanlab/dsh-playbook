# Automatic task intake and SOP selection

[中文](AUTO-ROUTING.md)

## Entry point

After updating the plugin and restarting the same DSH Web Profile, open a new conversation and send the task directly. No `/playbook start` is required.

The public `agent/pre-step` hook examines admitted direct-user text only. It excludes tool results, plugin notices and child-agent prompts. Conservative Chinese/English literal groups rank the available catalog. A clear match starts its SOP before work and contributes its stage contract to the same step, even though the normal system-prompt assembly may have happened earlier.

An ambiguous request produces candidates for the current Agent to inspect. The Agent calls `playbook` with `action=route`, a selected `playbook_id`, and an explanatory `note`. Only missing deliverable/input/scope facts warrant a user question; users should not need to choose internal SOP names. No separate classifier model, API key or online routing service is introduced.

This is heuristic matching plus the current Agent's semantic judgment, not a classifier with measured accuracy. Confidence labels are not probabilities. An active run is never silently replaced by a clarification or a new request. Use a new session for an independent task; parallel multi-SOP decomposition is not implemented.

## Control

Enter these in the DSH chat, not in a shell:

```text
/playbook list
/playbook inspect dsh-plugin-development
/playbook status
/playbook status json
/playbook recommend Write a WeChat article about this plugin
/playbook auto off
/playbook auto on
/playbook cancel
```

`recommend` is read-only. `route` starts a clearly matched or explicitly selected SOP. Per-session `auto off` disables future intake without cancelling an active run; the setting resets on Host restart. Set `DSH_PLAYBOOK_AUTO_ROUTE=0` for a deployment default of manual selection. Cancellation is not rollback of completed actions.

Model tool examples:

```json
{"action":"route","task":"Build a DeepSeek Harness plugin"}
```

```json
{"action":"route","playbook_id":"wechat-article","note":"The requested deliverable is an article; plugin development is only its topic."}
```

Every stage submission requires `stage_id` and complete `evidence`. Stage instructions expose actual type, length, item-count and equality constraints.

## Custom definitions

Place JSON definitions in `${DSH_HOME:-~/.dsh}/playbooks` (or `DSH_PLAYBOOK_DIR`) under the same service account/environment. User definitions override matching built-in IDs for future runs; active runs retain their pinned snapshot.

A top-level `routing` object supports `groups` (AND across groups, OR within a group), `keywords`, `exclude`, `priority` (-50 through 50), `autoStart` and `examples`. Matchers are literal text, not executable regex or scripts. `autoStart=false` disables rule-based automatic selection; explicit selection remains possible. Run `/playbook reload` after changes.

## Failure and trust boundaries

State hydration completes before new automatic starts. Unreadable state produces an explicit routing-unavailable notice rather than a fabricated active run. Concurrent selections are serialized. A default 64-submission budget stops endless gate/branch loops; it is not a token or wall-clock budget.

Pending selection gates ordinary work tools, while `run_code` remains a PTC transport whose nested calls traverse the normal guards. This is not an operating-system sandbox. Denying `write`/`edit` by name does not prevent shell-based writes or malicious Host code. SOP selection never grants additional authority; publication, account actions and destructive changes remain governed by the user request and Host permissions.

Semantic evidence remains a model assertion checked for structure. A successful `bash` dispatch is not evidence of zero process exit or passing tests. Templates require real tools and assets; they do not include video/music/model engines. All 19 workflows are starter templates awaiting real-task validation, not all-domain expertise or proof that a weak model matches a stronger one.

## A/B evaluation

Use two fresh sessions with identical initial code/assets, model, parameters, tools and inputs. Disable automatic routing in A and confirm no run is attached; leave B enabled. Compare real acceptance, model turns, tool calls, retries, human intervention and elapsed time. Do not let the second run inherit fixes made by the first.

# dsh-playbook

[中文](README.md)

**Keep working methods as project SOPs: read the task, select or propose a method, execute through stages, evidence and validators.**

## 0.5.0: project methods

Video and referenced-document tasks no longer start solely on keywords. The Agent reads sources, identifies the project, reuses its SOP or saves a derived trial. Taoist culture and Bilibili experiment/tutorial work retain different domain stages even when both publish to Bilibili. Narration/media checks, hashes and controlled revision remain shared. There are 20 built-in bases and a separate persistent project library.

Trials are not approved methods. Versions are immutable; protected-rule changes are non-executable drafts until a human approves the exact revision. Active runs retain their pinned definitions.

## Update

Use the original service account, DSH_HOME and Web Profile. Back up the state file first:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart the Profile, refresh the page and open a new session with the task brief. No daily manual SOP selection, JSON authoring or evidence submission is required.

Read [project SOPs and migration](docs/PROJECT-SOPS.en.md), [routing](docs/AUTO-ROUTING.en.md), [media contracts/revisions](docs/MEDIA-REVISION.en.md) and [receipt/format handling](docs/QUALITY.en.md). Older documentation describes its respective release, not a claim of live-model validation for new features.

## Control

Enter in DSH chat, not the shell:

```text
/playbook status
/playbook report
/playbook project
/playbook sops
/playbook sop <sop-id> <revision>
/playbook approve <sop-id> <full-revision>
/playbook auto off
/playbook cancel
```

The Web Playbook panel lists project SOPs and requires inspection before exact-version approval. This is a method-level decision, not approval of every execution. Approval is not a model action.

New Agent actions: intake_status/intake/sop_list/sop_inspect/sop_validate/sop_save. Existing route, execution, check, repair and report actions remain. Automatic trials are allowed; confirmed-rule changes require review. Schema validity is not domain expertise.

## Limits

Scopes combine Host session cwd and project_id. The original state file gains sopLibrary in format v3, reading v1/v2. Existing runs stay pinned; restore a matching state backup before downgrading. Storage is single-writer with at most 100 immutable versions per project.

Legacy JSON files with built-in IDs are warned and ignored; other custom legacy IDs still load globally and are not automatically approved project methods. Use the managed interface rather than model edits to global files.

Strong source receipts support UTF-8 read windows; a complete pasted brief also works as input. Source relevance, exhaustive extraction and semantic conflicts still need model/human review. Static interface protections are not an OS sandbox, signature or defense against same-process/file-writing code.

Media checks require Python 3.9+, FFmpeg and ffprobe; no new model/API key. No ASR or independent semantic Reviewer is included. Technical success is not content quality or user acceptance.

## Tests

```bash
npm test
npm run check
npm run packcheck
npm run mediatest
```

With actual DSH peers installed, run npm run sdkcheck. CI covers Node 20/22/24, SDK contracts and synthetic media decoding, not the user's live E5/Web/browser/MiniMax end-to-end path.

MIT

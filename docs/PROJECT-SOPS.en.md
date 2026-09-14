# 0.5.0: project SOP library and read-first intake

[中文](PROJECT-SOPS.md)

## Use

Update main using the original service account and DSH_HOME, restart the Profile, and open a new session with the task document. No daily JSON authoring or manual SOP selection is required.

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

The Agent reads referenced material using existing read/glob/grep tools, queries `intake_status` for observed read IDs and available projects, calls `intake` with the project and task requirements, then reuses a suitable project SOP or derives a trial through `sop_validate` / `sop_save`. Video/document tasks no longer start solely on a platform keyword. Simple non-document tasks can still auto-start.

`taoist-culture-video` adds distinct primary-text/context/interpretation work. Bilibili experiments/tutorials regain their evidence phase. Narration, pilot, media and version checks are reused rather than replacing the business workflow. There are 20 built-in bases. A culture video published on Bilibili remains culture work. Given scripts are preserved; a script-only request should not become a full video task. Episode topic, duration and output directory are task inputs, not new workflow identities.

## Lifecycle

`trial` preserves the base contract while adding stable project rules/instructions. It may run in its project but is not expert-validated. Changing/removing protected stage goals, topology, modes, tool policy, gates, revision policy or approved requirements produces a non-executable `draft`. A human approves an exact immutable revision to make it `approved`. Accepting one task does not approve the SOP automatically.

Models cannot overwrite approved versions, fall back to a generic method for the same approved family, rename a weaker trial to replace the method, or automatically select an obsolete approved revision. Every run pins its definition and project/task contract. In-flight, failed or pending-review tasks use controlled repair/revision, not a new intake or project identity.

The Web Playbook panel lists the current project's SOPs. Inspect the complete definition/change report before approving. Equivalent human commands:

```text
/playbook project
/playbook sops
/playbook sop <sop-id> <revision>
/playbook approve <sop-id> <full-revision>
```

Approval is not exposed as a model action. Stale-parent proposals must be reviewed again. Switching the visible session invalidates the panel's prior approval view.

Scopes combine the Host's absolute session cwd with a project ID. Model-supplied cwd and process.cwd fallback are not used. Multiple business projects can share a workspace; a bound session cannot silently rename its project. An explicitly independent project can be selected by the human via `/playbook project use <id>` after finishing/cancelling the current run. Workspace identity uses normalized Host path spelling, not cross-symlink canonicalization. Scope filtering is not multi-tenant filesystem authorization.

## Model actions

`intake` receives `project_id`, `requirements`, and `source_call_ids` from actual read-tool outcomes. `sop_list`/`sop_inspect` are scoped queries; `sop_validate` is read-only. `sop_save` accepts a base ID, logical SOP ID, stable rules and additional `stage_notes`, or a complete proposed definition. Protected changes remain drafts. `route` with `sop_id` selects the current approved version or an eligible trial.

Example additive proposal:

```json
{"action":"sop_save","sop_id":"culture-production","base_id":"taoist-culture-video","rules":["Verify the original passage and interpretive limits"],"stage_notes":{"source-truth":["Use the edition named by the task brief."]}}
```

Identical methods deduplicate even when the episode's source document changes. A genuinely different graph may be proposed, but its changed protections need one explicit review; the executing model cannot declare semantic equivalence by itself.

## Evidence and limitations

Receipts come from successful final canonical Host `read` results. Referenced documents require real IDs and paginated line coverage. This version certifies UTF-8 read windows, not PDF/OCR/web or other plugin formats as complete task-document reads. Other discovery tools remain useful but do not fabricate read receipts.

Hashes cover returned text windows, not original file bytes. They cannot prove full untruncated long lines, page-to-page file stability, source relevance or model understanding. The original request, extracted requirements and provenance are retained for review. Exhaustive extraction and semantic conflict detection remain model/human responsibilities.

Static change review is conservative: rewriting a protected clause requires review instead of guessing equivalence. Added prose can still contradict instructions, and trial execution is not independent semantic validation. Scopes, immutable definitions and approval controls prevent management-interface mistakes; they are not an OS sandbox, cryptographic signature or protection from code with write access to the Host state. Configure Host permissions accordingly.

## Storage and compatibility

The existing state file gains `sopLibrary` in schema v3, reading v1/v2. Runs, revisions and archives remain. Each project permits up to 100 immutable versions. A single state file is single-process storage.

No new classifier model, API key or vector database is installed. Existing media prerequisites and thresholds are unchanged. Legacy global JSON definitions with built-in IDs are now warned and ignored; other legacy custom IDs still load globally and are not automatically approved project methods. Migrate through the managed proposal interface instead of asking a model to rewrite global files.

Back up the state before updating. Existing runs keep their old pinned SOPs. Restore the appropriate old state before downgrading so an older writer cannot erase the new library.

Tests cover read-first routing, real read receipts, scope isolation, distinct domain graphs, immutable drafts/trials/approval, current defaults, renamed bypass attempts, stale parent conflicts, pinned runs, rollback, legacy overrides, real SDK schemas and media regressions. Fixtures are synthetic; no private documents or sessions are published. MiniMax and the user's live E5 Web Profile have not been retested.

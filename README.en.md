# dsh-playbook

[中文](README.md)

**Give a task, read its sources, choose a project SOP, execute through evidence gates.**

## 0.6.0: per-run media artifact roots

New media production runs allocate `.dsh-runs/<UUID>` instead of treating old final.mp4 files in the shared project as current outputs. Validation checks actual paths, ownership markers, links, supplementary timestamps and known prior final hashes. Reports include validation-time lineage. **This is artifact acceptance isolation, not an OS read sandbox or proof that a model created the bytes.**

[Run isolation, prior-hash registration and migration](docs/RUN-ISOLATION.en.md)

## Update and use

Back up the actual playbook-state.json. Use the original service account, DSH_HOME and Web Profile:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart the service, refresh the browser and open a fresh conversation. Give the task directly; no hand-written SOP JSON is required. Old unisolated runs are not silently copied or relabelled as new independent experiments.

Read sources → identify project → reuse/draft SOP → pin version → execute → verify → bounded repair → candidate → user review.

Media route/start prepares an isolated artifact directory through the original guarded tools. A failed preparation never adopts an old directory. The Agent can use `playbook(action="workspace")` and then use its absolute paths and explicit bash workdir.

## Retained capabilities

20 base workflows cover engineering, review, releases, recovery, deployment, media, music, research and analysis. Bilibili experiments, Taoist-culture videos and generic short videos retain different business methods while sharing applicable technical checks. A script-only request should not force a full video.

Project SOPs are scoped by Host cwd plus project_id. Additive trial methods may be saved; protected changes remain drafts until the user approves the exact version. Renaming/reloading cannot waive active gates. Episode inputs, platform and long-term method remain separate.

Stages, retries, revisions and pinned definitions persist outside model context. Media checks read actual full scripts, exact segment texts, pilots, audio, subtitles, covers and final bytes. Model claims do not replace machine checks; technical success does not establish semantic or creative quality.

## Controls

Use DSH chat, not a system shell:

```text
/playbook project
/playbook sops
/playbook status json
/playbook report
/playbook revise Diagnose and repair the rejected candidate
/playbook accept
/playbook auto off
/playbook cancel
```

The Web Playbook panel retains project inspection/approval, status and resume. `auto off` does not cancel an active run. For an untracked legacy result the user can register `/playbook exclude-hash <SHA256> <reason>`; this is not a model-removable baseline.

## Documentation and tests

See [project methods](docs/PROJECT-SOPS.en.md), [media revision](docs/MEDIA-REVISION.en.md), [catalog](docs/SOP-CATALOG.en.md), [receipts/format repair](docs/QUALITY.en.md) and [architecture](docs/ARCHITECTURE.md).

Node 20+. Media validation needs Python 3.9+, ffmpeg and ffprobe, with no pip/model/API-key dependency. Missing tools are unverified, never auto-installed. Directory preparation and validation inherit the existing DSH tool policy.

Run `npm test`, `npm run check`, `npm run packcheck`; real synthetic media: `npm run mediatest`; installed SDK contract: `npm run sdkcheck`. `node scripts/isolation-smoke.mjs` executes real Python through simulated Host dispatch, not a deployed Web/model test.

State stays v3 with optional isolation fields and a single Host writer. Approval and ownership are not isolation from malicious same-user processes. Hashes do not detect re-encoding, timestamps do not prove origin, model labels do not attest authorship. No ASR, independent semantic reviewer or measured model-quality gain is claimed.

MIT License.

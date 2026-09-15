# 0.7.1: recover plugin incidents in the original run

[中文](RUNTIME-RECOVERY.md)

This patch changes runtime compatibility, not approved SOP requirements. Existing pinned 0.4.0/0.7.0 definitions remain unchanged; upgrading does not require rebuilding projects or rewriting scripts.

## Manifest path bases

Absolute current-run paths, explicit `.dsh-runs/<current-key>/work/production.json` paths relative to the session workspace, and `work/production.json` relative to the run root now resolve once to the same file. Paths inside the manifest remain relative to the manifest directory. Both the Host boundary and Python entry support the explicit current-run prefix. The resolver never searches alternate directories, accepts another run, or relaxes traversal checks. The response records pathResolution; files are not renamed or generated.

## Recover without cancellation

The Agent `recover` action recognizes only a recorded legacy manifest-base incident or the exact pre-isolation compatibility blocker. It runs a fixed read-only validator through the original Host tool pipeline. Only after actual validation succeeds may the same run/stage/revision reopen. This is not a Gate pass. Counters, task, candidates, review feedback and prior failure events remain. Each patch/stage/revision incident can be recovered once; no blanket budget reset occurs.

`repair`, `workspace`, `route` and `submit` try this narrow recovery before asking for manual intervention. `status` is read-only and exposes a recover next action. Permission refusal, real content failures, cross-run ownership failures, cancellation and an exhausted global budget are not waived. Concurrent state changes or failed persistence prevent a fake success. This does not kill published jobs or delete output files.

## Old same-run revisions

A pinned pre-isolation run with recorded machine-bound candidate files and a real user rejection may retain a legacy-same-run scope based only on its historical manifest directories and exact files. A fresh read checks the actual full script before removing the exact isolation-upgrade blocker. No new run, copied experiment, producer label or accepted Gate is fabricated. Reports mark independentRun=false and creationAttested=false. New runs still require fresh isolated roots and cannot opt into compatibility by supplying model-authored metadata. Cancelled runs remain cancelled; only the current repairable run is recovered.

Legacy validation rejects unrelated directories, managed sibling runs, links and known foreign final hashes. It does not gain the creation-time ownership guarantee of a new root and must not be used as an independent model comparison.

## Source references

Intake accepts source_paths instead of opaque source_call_ids. Paths resolve only to actual current-session read receipts and retain full-page/line coverage checks. Unknown IDs return the real available path/receipt choices for the Agent to correct, not a request for the user to clear state. A small auxiliary code excerpt must not be misrepresented as a complete task source.

## Upgrade and continue

Back up the actual state file. With the original account and DSH_HOME:

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

Restart the Profile, refresh the client and ask the Agent to continue in the original session. No cancel, state deletion, new conversation or weakened validator is required for the supported incidents. recover is an Agent tool action, not an additional human approval step. State remains v3 with optional continuation/recovery records.

Tests cover pure contracts, real files and simulated Host dispatch executing real Python. They are not a deployed E5/model test. No new ASR, audio-loop recognition or creative-quality guarantee is claimed. Existing Host permissions, cancellation and all quality gates remain; there is no direct filesystem/shell fallback or OS-sandbox claim.

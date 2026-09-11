# dsh-playbook

[中文](README.md)

`dsh-playbook` turns expert-proven procedures into executable DeepSeek Harness playbooks with stages, quality gates, retries, branches, hard tool policies, and durable run state.

The core idea is simple: do not force every agent to rediscover the best process. Encode the expert process once, then make the runtime enforce it.

## MVP

The plugin registers a `playbook` model tool with `list`, `start`, `status`, `submit`, `reload`, and `cancel` actions, plus a `/playbook` human command.

A gate can combine model-submitted structured evidence with Harness-observed tool facts. For example, a verification gate may require both `fixed=true` and at least one successful `bash` call. STRICT stages can enforce a hard tool allowlist through the DSH tool guard; deny rules are always hard enforced.

User playbooks are loaded from `~/.dsh/playbooks/*.json` by default. Runtime state is persisted to `~/.dsh/playbook-state.json`. Override these with `DSH_PLAYBOOK_DIR` and `DSH_PLAYBOOK_STATE`.

The built-in `bug-fix` playbook runs:

```text
reproduce -> root-cause -> implement -> verify -> review
                              ^           |
                              +-----------+ verification failed
```

## Trust boundary

The MVP can strongly enforce stage transitions, retry/branch policy, tool policy, and observed tool outcomes. Semantic claims submitted by the model are currently shape-validated, not independently proven. Validator gates (shell/test/file/schema/reviewer-subagent) are the next milestone.

## Development

```bash
npm test
npm run check
npm run packcheck
```

## License

MIT

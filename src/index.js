import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BUILTIN_PLAYBOOKS } from './builtins.js'
import { loadPlaybooksFromDirectory } from './catalog.js'
import { PlaybookEngine } from './engine.js'
import { readState, writeState } from './state.js'

export const name = 'dsh-playbook'
export const inject = ['tools', 'systemPrompt']
export const PLAYBOOK_TOOL_NAME = 'playbook'

function homeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function pathsFromEnvironment() {
  const home = homeDir()
  return {
    directory: resolve(process.env.DSH_PLAYBOOK_DIR || join(home, 'playbooks')),
    state: resolve(process.env.DSH_PLAYBOOK_STATE || join(home, 'playbook-state.json')),
  }
}

function sessionIdFromExec(exec) {
  const id = exec?.agent?.id
  if (id === undefined || id === null) throw new Error('playbook action requires an agent/session context')
  return String(id)
}

function asObject(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function renderValue(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function conciseStatus(status) {
  if (!status?.run) return 'No playbook run is attached to this session.'
  if (!status.active) return `${status.run.playbookId} is ${status.run.state}.`
  return `${status.run.playbookId} → ${status.run.stageId} (attempt ${status.run.stageAttempt}).\n${status.instruction}`
}

export function createPlaybookTool(engine, reloadCatalog) {
  return defineTool({
    name: PLAYBOOK_TOOL_NAME,
    description: 'Run an expert-authored playbook. Use list to discover playbooks, start to attach one to this session, status to inspect the current gate, submit to provide structured stage evidence, reload to reload user playbooks, and cancel to stop the active run. A stage advances only when the plugin gate passes.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'start', 'status', 'submit', 'reload', 'cancel'], description: 'Playbook operation.' },
      playbook_id: { type: 'string', description: 'Playbook id for start.' },
      stage_id: { type: 'string', description: 'Expected current stage id for submit.' },
      input: { type: 'object', additionalProperties: true, description: 'Run input object for start.' },
      evidence: { type: 'object', additionalProperties: true, description: 'Structured evidence for the current stage gate.' },
      note: { type: 'string', description: 'Optional note recorded with submit/cancel.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderValue,
    },
    async execute(args, exec) {
      switch (args.action) {
        case 'list':
          return { ok: true, playbooks: engine.listPlaybooks() }
        case 'reload':
          return { ok: true, playbooks: await reloadCatalog() }
        case 'start': {
          if (!args.playbook_id) throw new Error('playbook_id is required for start')
          const status = await engine.start(sessionIdFromExec(exec), args.playbook_id, asObject(args.input, 'input'))
          return { ok: true, status, message: conciseStatus(status) }
        }
        case 'status': {
          const status = engine.status(sessionIdFromExec(exec))
          return { ok: true, status, message: conciseStatus(status) }
        }
        case 'submit': {
          const status = await engine.submit(sessionIdFromExec(exec), {
            stageId: args.stage_id,
            evidence: asObject(args.evidence, 'evidence'),
            note: args.note ?? '',
          })
          return { ok: true, status, gate: status.lastGate, message: conciseStatus(status) }
        }
        case 'cancel': {
          const status = await engine.cancel(sessionIdFromExec(exec), args.note ?? 'cancelled by model/user')
          return { ok: true, status, message: conciseStatus(status) }
        }
        default:
          throw new Error(`unsupported action: ${String(args.action)}`)
      }
    },
  })
}

export function apply(ctx) {
  const paths = pathsFromEnvironment()
  const engine = new PlaybookEngine({ persist: snapshot => writeState(paths.state, snapshot) })

  let userEntries = []
  const reloadCatalog = async () => {
    userEntries = await loadPlaybooksFromDirectory(paths.directory)
    const merged = [
      ...BUILTIN_PLAYBOOKS.map(playbook => ({ playbook, source: 'builtin' })),
      ...userEntries,
    ]
    return engine.replaceCatalog(merged)
  }

  for (const playbook of BUILTIN_PLAYBOOKS) engine.register(playbook, { source: 'builtin' })
  void readState(paths.state).then(snapshot => engine.hydrate(snapshot)).catch(error => {
    console.error(`[dsh-playbook] state load failed: ${error?.stack ?? error}`)
  })
  void reloadCatalog().catch(error => {
    console.error(`[dsh-playbook] catalog load failed: ${error?.stack ?? error}`)
  })

  ctx.tools.register(createPlaybookTool(engine, reloadCatalog))

  const basePolicy = [
    'Playbook policy:',
    '- A playbook is an expert-authored execution contract, not a suggestion list.',
    '- When a playbook run is active, obey its current stage objective, mode, tool policy, and gate.',
    '- Do not advance stages in prose. Call the playbook tool with action=submit and structured evidence.',
    '- If a gate fails, correct the failed evidence/observed-tool requirements before resubmitting.',
    '- Exploration is a fallback only when the playbook explicitly branches to it; do not replace a known workflow with ad-hoc exploration.',
  ].join('\n')
  ctx.systemPrompt.section({
    name: 'tool:playbook',
    order: 365,
    text: ({ agent } = {}) => {
      if (!agent?.id) return basePolicy
      const status = engine.status(String(agent.id))
      if (!status.active || !status.instruction) return basePolicy
      return `${basePolicy}\n\nACTIVE PLAYBOOK (runtime-authoritative):\n${status.instruction}`
    },
  })

  ctx.tools.guard(exec => {
    const sessionId = exec.agent?.id
    if (sessionId === undefined || sessionId === null) return undefined
    return engine.policyDecision(String(sessionId), exec.name, PLAYBOOK_TOOL_NAME)
  })

  ctx.on('tools/result', (exec, result) => {
    const sessionId = exec.agent?.id
    if (sessionId === undefined || sessionId === null || exec.name === PLAYBOOK_TOOL_NAME) return
    void engine.observeTool(String(sessionId), {
      name: exec.name,
      callId: exec.callId,
      isError: result.isError,
    }).catch(error => console.error(`[dsh-playbook] tool observation failed: ${error?.stack ?? error}`))
  })

  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      name: 'playbook',
      description: 'manage expert playbook runs for the current session',
      input: { hint: '[list|reload|start <id>|status|cancel]' },
      handler: async invocation => {
        try {
          const raw = invocation.rawInput?.trim() ?? ''
          const [op = 'status', ...rest] = raw.split(/\s+/).filter(Boolean)
          if (op === 'list' || op === 'ls') return { kind: 'success', text: JSON.stringify(engine.listPlaybooks(), null, 2) }
          if (op === 'reload') return { kind: 'success', text: JSON.stringify(await reloadCatalog(), null, 2) }
          const sessionId = invocation.agent?.id ?? invocation.session?.id
          if (sessionId === undefined || sessionId === null) return { kind: 'error', text: 'current command invocation has no session id' }
          if (op === 'start') {
            if (!rest[0]) return { kind: 'error', text: 'usage: /playbook start <id>' }
            const status = await engine.start(String(sessionId), rest[0], {})
            return { kind: 'success', text: conciseStatus(status) }
          }
          if (op === 'cancel') {
            const status = await engine.cancel(String(sessionId), rest.join(' ') || 'cancelled by user')
            return { kind: 'success', text: conciseStatus(status) }
          }
          if (op === 'status' || op === 'show') {
            const status = engine.status(String(sessionId))
            if (rest[0] === 'json') return { kind: 'success', text: JSON.stringify(status, null, 2) }
            return { kind: 'success', text: conciseStatus(status) }
          }
          return { kind: 'error', text: 'usage: /playbook [list|reload|start <id>|status|cancel]' }
        } catch (error) {
          return { kind: 'error', text: error?.message ?? String(error) }
        }
      },
    })
  })

  // Export for sibling plugins/tests without taking ownership of DSH core state.
  ctx.provide?.('playbookEngine', engine)
  return engine
}

export { PlaybookEngine } from './engine.js'
export { normalizePlaybook, evaluateGate, toolPolicyDecision, formatStageInstruction } from './core.js'

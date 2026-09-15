import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PlaybookRouter } from './routing.js'
import { playbookDefinition } from './tool.js'
import { install } from './host.js'
import { usableController } from './controller-ux.js'

export { name, inject, PLAYBOOK_TOOL_NAME, pathsFromEnvironment, install } from './host.js'
export { PlaybookEngine } from './engine.js'
export { normalizePlaybook, evaluateGate, toolPolicyDecision, formatStageInstruction } from './core.js'
export function createPlaybookTool(engine, reloadCatalog, router = new PlaybookRouter(engine), ready) {
  return defineTool(usableController(playbookDefinition(engine, reloadCatalog, router, ready), engine))
}
export function apply(ctx) {
  return install(ctx, { define: defineTool, message: createUserMessage })
}

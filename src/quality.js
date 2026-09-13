/** Harden shipped SOPs without changing user-authored or already-pinned definitions. */
const COMMAND_GATES = new Set(['bug-fix/verify', 'feature-development/verify', 'plugin-development/verify', 'dsh-plugin-development/package-check', 'release/build'])
export function strengthenPlaybook(input) {
  const playbook = structuredClone(input)
  playbook.version = '0.3.0'
  for (const stage of playbook.stages) {
    stage.instructions ??= []
    stage.instructions.push('Complete the actual stage work before reporting evidence. Do not fabricate files, observations or execution results to fill the form. The user deliverable is not the SOP evidence form.')
    stage.instructions.push('If a prerequisite is missing, use playbook action=block with what is missing and what would unblock it. For format errors use action=check and repair the fields; do not repeat successful work just to fill a form.')
    if (!COMMAND_GATES.has(`${playbook.id}/${stage.id}`)) continue
    stage.gate.evidence.push(
      { key: 'verification_command', type: 'string', minLength: 1 },
      { key: 'verification_call_id', type: 'string', minLength: 1 },
    )
    stage.gate.toolResults = [{ name: 'bash', commandKey: 'verification_command', callIdKey: 'verification_call_id' }]
    stage.instructions.push('Run the real verification command in the foreground using bash. Inspect playbook status for the recorded call ID; submit that ID and the exact command. Use environment variables instead of secret literals. An unrelated echo/true command is not verification. Background acknowledgement, non-zero exit, timeout and unknown result shapes do not satisfy this gate.')
  }
  return playbook
}

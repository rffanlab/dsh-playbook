import { createHash } from 'node:crypto'

/** No output/log parsing: only the canonical foreground result is authoritative. */
export function commandFingerprint(command) {
  return typeof command === 'string' ? createHash('sha256').update(command).digest('hex') : null
}
export function toolReceipt(exec, result) {
  const value = result?.value
  const commandHash = commandFingerprint(exec?.arguments?.command)
  let outcome = 'unknown', exitCode = null
  if (result?.isError === true) outcome = 'tool-error'
  else if (value?.kind === 'background') outcome = 'background'
  else if (result?.isError === false && value?.kind === 'foreground') {
    if (value.aborted === true) outcome = 'aborted'
    else if (value.timedOut === true) outcome = 'timed-out'
    else if (value.sandbox?.denied === true || value.sandbox?.runnerFailed === true) outcome = 'sandbox-denied'
    else if (value.signal !== null && value.signal !== undefined) outcome = 'signalled'
    else if (value.signal === null && Number.isSafeInteger(value.exitCode) && value.aborted === false && value.timedOut === false) {
      exitCode = value.exitCode
      outcome = exitCode === 0 ? 'exit-zero' : 'exit-nonzero'
    }
  }
  return { callId: String(exec.callId), tool: String(exec.name), commandHash, outcome, exitCode }
}

/** A receipt proves which command exited, not whether that command is a good test. */
export function resultFailures(rules, evidence, observations) {
  const failures = []
  for (const rule of rules ?? []) {
    const id = Object.hasOwn(evidence, rule.callIdKey) ? evidence[rule.callIdKey] : undefined
    const command = Object.hasOwn(evidence, rule.commandKey) ? evidence[rule.commandKey] : undefined
    // Missing/wrongly typed fields are handled as format repair by evidence rules.
    if (typeof id !== 'string' || !id.trim() || typeof command !== 'string' || !command.trim()) continue
    const receipt = (observations[rule.name]?.receipts ?? []).find(row => row.callId === id)
    if (!receipt) failures.push(`evidence.${rule.callIdKey}: no current-stage ${rule.name} receipt; inspect status after running the real check`)
    else if (receipt.commandHash === null || receipt.commandHash !== commandFingerprint(command)) failures.push(`evidence.${rule.commandKey}: does not match the command in receipt ${id}`)
    else if (rule.command !== undefined && commandFingerprint(rule.command) !== receipt.commandHash) failures.push(`tool result ${id}: the executed command is not the SOP-authored command`)
    else if (receipt.outcome !== 'exit-zero' || receipt.exitCode !== 0) failures.push(`tool result ${id}: ${receipt.outcome}, exitCode=${receipt.exitCode}; a real foreground exit 0 is required`)
  }
  return failures
}

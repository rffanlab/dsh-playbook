import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateGate, normalizePlaybook, toolPolicyDecision } from '../src/core.js'

const sample = () => normalizePlaybook({
  id: 'sample',
  stages: [
    {
      id: 'inspect',
      mode: 'strict',
      objective: 'Inspect before editing',
      tools: { allow: ['read', 'grep'] },
      gate: {
        evidence: [
          { key: 'finding', type: 'string', minLength: 5 },
          { key: 'confirmed', type: 'boolean', equals: true },
        ],
        observedTools: [{ name: 'read', minCalls: 1, minSuccesses: 1 }],
      },
      retry: { maxAttempts: 2, onExhausted: 'fail' },
    },
  ],
})

test('normalizes defaults and sequential next', () => {
  const pb = normalizePlaybook({
    id: 'flow',
    stages: [
      { id: 'a', objective: 'A' },
      { id: 'b', objective: 'B' },
    ],
  })
  assert.equal(pb.initialStage, 'a')
  assert.equal(pb.stages[0].next, 'b')
  assert.equal(pb.stages[1].next, null)
  assert.equal(pb.stages[0].mode, 'guided')
})

test('rejects broken stage references', () => {
  assert.throws(() => normalizePlaybook({ id: 'bad', stages: [{ id: 'a', objective: 'A', next: 'missing' }] }), /unknown stage/)
})

test('gate combines submitted evidence and observed tool facts', () => {
  const stage = sample().stages[0]
  const fail = evaluateGate(stage, { finding: 'yes', confirmed: true }, {})
  assert.equal(fail.passed, false)
  assert.ok(fail.failures.some(row => row.includes('length')))
  assert.ok(fail.failures.some(row => row.includes('read')))

  const pass = evaluateGate(stage, { finding: 'found a concrete cause', confirmed: true }, { read: { calls: 1, successes: 1, failures: 0 } })
  assert.deepEqual(pass, { passed: true, failures: [] })
})

test('strict mode hard-blocks tools outside the allowlist', () => {
  const stage = sample().stages[0]
  assert.equal(toolPolicyDecision(stage, 'read'), undefined)
  assert.match(toolPolicyDecision(stage, 'write'), /outside its allowlist/)
  assert.equal(toolPolicyDecision(stage, 'playbook'), undefined)
})

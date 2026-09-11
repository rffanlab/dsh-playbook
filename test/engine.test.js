import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybookEngine } from '../src/engine.js'

function workflow() {
  return {
    id: 'demo',
    version: '1',
    stages: [
      {
        id: 'inspect',
        mode: 'strict',
        objective: 'Inspect',
        tools: { allow: ['read'] },
        gate: { evidence: [{ key: 'finding', type: 'string', minLength: 5 }], observedTools: [{ name: 'read', minSuccesses: 1 }] },
        retry: { maxAttempts: 2, onExhausted: 'fail' },
      },
      {
        id: 'finish',
        objective: 'Finish',
        gate: { evidence: [{ key: 'done', type: 'boolean', equals: true }] },
        next: null,
      },
    ],
  }
}

test('run cannot pass a gate without required observed tool success', async () => {
  let persisted = null
  let tick = 1000
  const engine = new PlaybookEngine({ clock: () => tick++, persist: async value => { persisted = value } })
  engine.register(workflow())
  await engine.start('s1', 'demo')

  let status = await engine.submit('s1', { stageId: 'inspect', evidence: { finding: 'clear finding' } })
  assert.equal(status.run.stageId, 'inspect')
  assert.equal(status.run.stageAttempt, 2)
  assert.equal(status.lastGate.passed, false)

  await engine.observeTool('s1', { name: 'read', callId: 'c1', isError: false })
  status = await engine.submit('s1', { stageId: 'inspect', evidence: { finding: 'clear finding' } })
  assert.equal(status.run.stageId, 'finish')
  assert.equal(status.lastGate.passed, true)
  assert.ok(persisted.runs.s1)
})

test('failed verification can branch back to implementation', async () => {
  const engine = new PlaybookEngine()
  engine.register({
    id: 'branching',
    stages: [
      { id: 'implement', objective: 'Implement', gate: { evidence: ['patch'] } },
      { id: 'verify', objective: 'Verify', gate: { evidence: [{ key: 'ok', type: 'boolean', equals: true }] }, retry: { maxAttempts: 1, onExhausted: 'branch:implement' } },
    ],
  })
  await engine.start('s2', 'branching')
  await engine.submit('s2', { evidence: { patch: 'x' } })
  const status = await engine.submit('s2', { evidence: { ok: false } })
  assert.equal(status.run.state, 'active')
  assert.equal(status.run.stageId, 'implement')
})

test('terminal gate completes run', async () => {
  const engine = new PlaybookEngine()
  engine.register(workflow())
  await engine.start('s3', 'demo')
  await engine.observeTool('s3', { name: 'read', isError: false })
  await engine.submit('s3', { evidence: { finding: 'valid evidence' } })
  const status = await engine.submit('s3', { evidence: { done: true } })
  assert.equal(status.active, false)
  assert.equal(status.run.state, 'completed')
})


test('active run pins its playbook snapshot across catalog reloads', async () => {
  const engine = new PlaybookEngine()
  engine.register({ id: 'pinned', version: '1', stages: [{ id: 'old-stage', objective: 'Old', gate: { evidence: ['ok'] }, next: null }] })
  await engine.start('s4', 'pinned')
  engine.replaceCatalog([{ playbook: { id: 'pinned', version: '2', stages: [{ id: 'new-stage', objective: 'New', gate: { evidence: ['ok'] }, next: null }] }, source: 'test' }])
  const before = engine.status('s4')
  assert.equal(before.run.playbookVersion, '1')
  assert.equal(before.run.stageId, 'old-stage')
  assert.equal(before.stage.objective, 'Old')
  const done = await engine.submit('s4', { stageId: 'old-stage', evidence: { ok: true } })
  assert.equal(done.run.state, 'completed')
})

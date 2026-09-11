export const BUILTIN_PLAYBOOKS = [
  {
    id: 'bug-fix',
    version: '0.1.0',
    name: 'Bug Fix',
    description: 'Evidence-gated software bug-fix workflow: reproduce, isolate, implement, verify, review.',
    goal: 'Fix a reported software defect without skipping reproduction, root-cause analysis, verification, or review.',
    stages: [
      {
        id: 'reproduce',
        title: 'Reproduce the defect',
        mode: 'guided',
        objective: 'Reproduce or precisely characterize the reported defect before modifying implementation code.',
        instructions: [
          'Inspect the report and the smallest relevant surface.',
          'Run a reproduction when executable; otherwise collect concrete static evidence explaining why reproduction is unavailable.',
          'Do not modify implementation code in this stage.',
        ],
        tools: { deny: ['write', 'edit'] },
        gate: {
          evidence: [
            { key: 'reproduction', type: 'string', minLength: 12 },
            { key: 'observed_behavior', type: 'string', minLength: 8 },
          ],
        },
        retry: { maxAttempts: 2, onExhausted: 'fail' },
      },
      {
        id: 'root-cause',
        title: 'Find root cause',
        mode: 'guided',
        objective: 'Identify the causal defect and connect it to concrete code/runtime evidence.',
        instructions: ['Do not patch yet.', 'Prefer a narrow causal explanation over a broad speculative redesign.'],
        tools: { deny: ['write', 'edit'] },
        gate: {
          evidence: [
            { key: 'root_cause', type: 'string', minLength: 20 },
            { key: 'supporting_evidence', type: 'array', minItems: 1 },
          ],
        },
        retry: { maxAttempts: 2, onExhausted: 'fail' },
      },
      {
        id: 'implement',
        title: 'Implement the smallest safe fix',
        mode: 'guided',
        objective: 'Implement a focused fix that addresses the proven root cause without unrelated scope creep.',
        gate: {
          evidence: [
            { key: 'changed_files', type: 'array', minItems: 1 },
            { key: 'change_summary', type: 'string', minLength: 12 },
          ],
        },
        retry: { maxAttempts: 2, onExhausted: 'fail' },
      },
      {
        id: 'verify',
        title: 'Verify the fix',
        mode: 'guided',
        objective: 'Demonstrate that the original defect is fixed and relevant regression coverage passes.',
        gate: {
          evidence: [
            { key: 'original_bug_fixed', type: 'boolean', equals: true },
            { key: 'verification', type: 'string', minLength: 12 },
          ],
          observedTools: [
            { name: 'bash', minCalls: 1, minSuccesses: 1 },
          ],
        },
        retry: { maxAttempts: 2, onExhausted: 'branch:implement' },
      },
      {
        id: 'review',
        title: 'Review scope and risk',
        mode: 'guided',
        objective: 'Review the completed change for scope creep, obvious regressions, and compatibility risk.',
        gate: {
          evidence: [
            { key: 'scope_ok', type: 'boolean', equals: true },
            { key: 'regression_risk', type: 'string', minLength: 8 },
            { key: 'review_summary', type: 'string', minLength: 12 },
          ],
        },
        retry: { maxAttempts: 1, onExhausted: 'branch:implement' },
        next: null,
      },
    ],
  },
]

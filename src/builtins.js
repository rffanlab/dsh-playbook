import { TAOIST_VIDEO } from './domain-sops.js'
import { videoSop } from './video-sop.js'
import { strengthenPlaybook } from './quality.js'
import { SOP_PLAYBOOKS } from './sops.js'

export const BUILTIN_PLAYBOOKS = [
  {
    id: 'bug-fix',
    version: '0.2.0',
    routing: {
      groups: [['修', '排查', '修复', 'fix', 'debug'], ['bug', '报错', '错误', '缺陷', '异常', 'error', 'defect']],
      priority: 20,
      examples: ['修复这个接口的分页 bug', 'Fix this code defect'],
    },
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
        instructions: ['Apply the smallest change justified by root-cause evidence.', 'Add a regression case for the original defect; preserve unrelated work.'],
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
        instructions: ['Execute a real targeted test and relevant regressions; report exact commands, exit codes and outputs.', 'A successful bash tool dispatch is not proof the command or tests passed. Inspect the exit status; missing test/runtime capabilities must be reported.'],
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
        instructions: ['Review the actual diff against the original defect and regression evidence.', 'Distinguish confirmed checks, remaining risks and untested assumptions. Do not auto-publish or claim an independent reviewer ran.'],
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
  ...SOP_PLAYBOOKS,
  TAOIST_VIDEO,
].map(videoSop).map(strengthenPlaybook)

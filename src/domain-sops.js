/** Domain contracts are separate from platform/export metadata and shared technical checks. */
export const TAOIST_VIDEO = {
  id: 'taoist-culture-video', version: '0.5.0', name: '道家文化讲解 / Taoist culture video',
  description: '道家文化项目：原文、语境、释义边界、自然口播与内容忠实度；发布到 B 站也不改成硬件/AI 实验流程。',
  routing: { groups: [['制作', '做', '生成', 'produce', 'create', 'make'], ['视频', '口播', 'video'], ['道家', '道教', '庄子', '老子', '道德经', 'taoist', 'daoist', 'zhuangzi']], priority: 50,
    examples: ['制作一期庄子道家文化视频，发到B站', 'Produce a Taoist culture video'] },
  stages: [{ id: 'brief', title: '读取道家文化任务书 / Read the culture project brief', mode: 'guided',
    objective: '保留已给定的原文、主题、脚本、配音和制作要求，不重新猜测任务。',
    instructions: ['Read the actual project task brief before work. Given topic, canonical text, narration and voice requirements are task inputs; do not silently replace them with generic short-video formulas.',
      'Distinguish required deliverables from internal production files. Record the target audience and source boundaries, not a promise of views or spiritual effects.'],
    gate: { evidence: [{key:'task_contract',type:'string',minLength:1},{key:'source_scope',type:'string',minLength:1}] }, retry: {maxAttempts:2,onExhausted:'fail'} }],
}
export function domainStages(id) {
  const s = (id, objective, instructions, keys) => ({ id, title: objective, objective, mode: 'guided', instructions,
    gate: { evidence: keys.map(key => ({key,type:'string',minLength:1})) }, retry: { maxAttempts:2,onExhausted:'fail' } })
  if (id === 'taoist-culture-video') return [
    s('source-truth', '核实原文与语境 / Verify primary text and context', [
      'Read the supplied original passage and cited edition/context. Preserve wording and attribution; distinguish source text, later interpretation, and modern application.',
      'Do not invent quotations, history or doctrinal certainty. Supplied claims lacking support remain uncertain, not silently repaired with a different story.',
    ], ['primary_text_reference', 'context_notes', 'interpretation_boundary']),
    s('interpretation', '组织忠实且可听的解释 / Faithful, listenable explanation', [
      'Use the project-approved narration verbatim when provided; otherwise explain the original idea and its limits before applying it to a concrete situation.',
      'Natural voice and coherent listening take precedence over guessed platform-duration formulas. Do not speed up narration or add arbitrary pauses to hit a guessed length.',
      'Do not replace culture interpretation with an experiment-results template; do not force new hooks when the brief already fixes the opening.',
    ], ['narrative_plan', 'source_to_script_mapping', 'voice_constraints']),
  ]
  if (id === 'bilibili-video-production') return [s('evidence', '核实实验或教程证据 / Verify experiment or tutorial evidence', [
    'For an experiment, record methods, actual settings, baseline and raw observations before drawing conclusions. For a tutorial, verify the demonstrated steps and version.',
    'Keep estimates, measured results and interpretation separate. Never prewrite an all-pass success story for an unfinished experiment.',
    'Reuse a supplied script/method when specified; do not make the publishing platform override an already identified culture or other specialist project.',
  ], ['method', 'evidence_register', 'limitations'])]
  return []
}

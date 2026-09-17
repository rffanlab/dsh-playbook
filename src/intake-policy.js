/** Intake policy is about the deliverable, not every keyword mentioned in its subject. */
import { analyzeTask } from './task-scope.js'
export { VIDEO_BASES } from './task-scope.js'
export const INTAKE_READ_TOOLS = new Set(['read', 'grep', 'glob', 'read_image', 'web_search', 'web_fetch', 'skill'])
const clean = text => String(text ?? '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/^\s*>.*$/gm, ' ')
export function isVideoTask(text) { return analyzeTask(text).producesVideo }
export function mentionsSource(text) {
  const t = clean(text)
  const inlineBrief = String(text ?? '').length >= 800 && String(text).split('\n').length >= 8
  if (inlineBrief && !/(?:读取|阅读|参考|参照|附件|attached)[^\n]{0,80}\.(md|txt|pdf)\b|(?:见附件|读取附件|read the attachment)/i.test(t)) return false
  if (/任务书|附件|这份|这篇|(?:按照|根据|参考|读取|现有).{0,16}(?:文档|文件|方案|材料)|\b(attached|provided document|existing document|task brief|specification)\b/i.test(t)) return true
  const pathMention = /\.(md|txt|pdf)\b/i.test(t)
  const outputOnly = /(?:写|创建|生成|保存为|create|write|save as).{0,16}[\w.-]+\.(md|txt)\b/i.test(t) && !/读取|参考|根据|\bread\b|\bexisting\b/i.test(t)
  return pathMention && !outputOnly
}
export function projectHint(text, sources = []) { return analyzeTask(text, sources).suggestedBase }

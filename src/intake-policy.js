/** Intake policy is about the deliverable, not every keyword mentioned in its subject. */
export const VIDEO_BASES = new Set(['bilibili-video-production', 'short-video-production', 'taoist-culture-video'])
export const INTAKE_READ_TOOLS = new Set(['read', 'grep', 'glob', 'read_image', 'web_search', 'web_fetch', 'skill'])
const clean = text => String(text ?? '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/^\s*>.*$/gm, ' ')
export function isVideoTask(text) {
  const t = clean(text)
  if (/(?:只要|只写|仅需|只做).{0,15}(?:脚本|文案|标题|封面)|(?:only).{0,15}(?:script|title|cover)/i.test(t)) return false
  if (/(?:写|撰写|write|draft).{0,15}(?:文章|公众号|文档|article|post|documentation)/i.test(t)) return false
  if (/(?:开发|修复|debug|implement|develop).{0,24}(?:插件|接口|功能|代码|plugin|api|feature|code)/i.test(t)) return false
  return /视频|成片|口播|b站|\b(video|bilibili|tiktok)\b/i.test(t)
}
export function mentionsSource(text) {
  const t = clean(text)
  const inlineBrief = String(text ?? '').length >= 800 && String(text).split('\n').length >= 8
  if (inlineBrief && !/(?:读取|阅读|参考|参照|附件|attached)[^\n]{0,80}\.(md|txt|pdf)\b|(?:见附件|读取附件|read the attachment)/i.test(t)) return false
  if (/任务书|附件|这份|这篇|(?:按照|根据|参考|读取|现有).{0,16}(?:文档|文件|方案|材料)|\b(attached|provided document|existing document|task brief|specification)\b/i.test(t)) return true
  const pathMention = /\.(md|txt|pdf)\b/i.test(t)
  const outputOnly = /(?:写|创建|生成|保存为|create|write|save as).{0,16}[\w.-]+\.(md|txt)\b/i.test(t) && !/读取|参考|根据|\bread\b|\bexisting\b/i.test(t)
  return pathMention && !outputOnly
}
export function projectHint(text) {
  if (!isVideoTask(text)) return null
  if (/道家|道教|庄子|老子|道德经|逍遥游|\b(taoist|taoism|daoist|zhuangzi)\b/i.test(clean(text))) return 'taoist-culture-video'
  if (/b站|bilibili/i.test(clean(text))) return 'bilibili-video-production'
  return 'short-video-production'
}

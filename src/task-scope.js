/** One deliverable analysis shared by routing and intake.
 * This is conservative intent extraction, not a semantic authority or permission
 * grant. A noun in a tool's input formats, sample, path or project name is NOT a
 * requested output. Unknown work remains selectable by the Agent.
 */
export const VIDEO_BASES = new Set(['bilibili-video-production', 'short-video-production', 'taoist-culture-video'])
const SOFTWARE_BASES = new Set(['bug-fix','feature-development','plugin-development','dsh-plugin-development','code-review','release','incident-response','linux-service-deploy','model-deployment'])

export function prose(text) {
  const lines = []; let fence = null
  for (const raw of String(text ?? '').slice(0, 160000).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = null; continue }
    if (fence || /^\s*>/.test(raw)) continue
    lines.push(raw.replace(/`([^`]+)`/g, '$1').replaceAll('**', ''))
  }
  return lines.join('\n')
}

/** Only the request/brief heading leads classification, not the appended manual. */
export function requestLead(text) {
  const lines = prose(text).split('\n'), out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { if (out.length) break; continue }
    if (out.length && (/^#{1,6}\s/.test(line) || /^(?:[-*]|\d+[.)、])\s/.test(line))) break
    const lead = line.split(/[:：]\s*#{1,6}\s/)[0].replace(/^#{1,6}\s*/, '')
    out.push(lead)
    if (lead !== line.replace(/^#{1,6}\s*/, '') || out.join('\n').length >= 2000 || out.length >= 6) break
  }
  return out.join('\n').slice(0, 2000)
}

// A subordinate production requirement is not another requested deliverable.
// Keep explicit 'also/separately deliver' requests as independent work.
function supportingRequirement(raw) {
  const t = raw.trim()
  if (/^(?:另外|另行|另交|单独|分别|额外|同时交付|also\b|separately\b|additionally\b)/i.test(t)) return false
  return /^(?:(?:注意(?:了)?|其中|要求|请注意|并且|且|同时|然后)\s*[:：]?\s*)?(?:配音|语音合成|语音|口播|旁白|声音|音色|画面|素材|图片|字幕|封面|渲染|voice(?:over)?|narration|audio|speech|images?|subtitles?|captions?|cover|rendering)[^\n]{0,28}(?:用|使用|采用|通过|交给|保持|来自|提供|uses?\b|using\b|with\b|via\b)/i.test(t)
    || /^(?:用|使用|采用|通过|using\b|with\b)[^\n]{0,60}(?:配音|语音|口播|旁白|音频|音色|声音|字幕|素材|voice|narration|audio|images?|captions?)/i.test(t)
}

const negative = /^(?:但)?(?:不要|别|不用|无需|不需要|不做|不生成|不制作|不生产|不是要|不要求|禁止|do not\b|don't\b|no need\b|without\b)/i
function clauseKind(raw) {
  const t = raw.trim().replace(/^(?:然后|同时|并且|再|then\b|and then\b)\s*/i, '')
  if (!t || negative.test(t)) return null
  if (/^(?:如何|怎么|为什么|什么是|请问|解释|what (?:is|are)\b|how (?:to|do|does)\b)/i.test(t)) return {kind:'information'}
  // Writing about a process must not execute the process mentioned in the topic.
  const writing = /(?:只要|只写|仅需|仅写|只做|写|撰写|编写|整理|更新|同步|生成|write|draft|update|sync|generate)[^\n]{0,60}?(?:公众号|文章|文档|说明|契约|文案|口播稿|讲解稿|台词|任务书|字幕|README(?:\.md)?|AGENTS\.md|视频脚本|video script|narration script|article|documentation|document|subtitles|captions)/i.exec(t)
  const engineering = /(?:开发|实现|接入|集成|注册|封装|创建|部署|安装|配置|同步|修复|排查|构建|维护|implement|develop|integrate|register|deploy|install|configure|sync|debug|fix|build)[^\n]{0,100}?(?:插件|接口|工具|功能|代码|脚本|软件|服务|环境|依赖|工作流|核心|宿主|CLI|SDK|API|plugin|extension|tool|feature|code|software|service|runtime|environment|harness|session|模型|model|vllm|gguf)/i.exec(t)
  const nounFirstEngineering = /(?:工具|插件|接口|服务|配置|契约|tool|plugin|service|config)[^\n]{0,40}(?:全局|所有\s*session|global)[^\n]{0,20}(?:同步|接入|配置|注册|安装|可用|sync|install|available)|(?:工具|插件|接口|tool|plugin)[^\n]{0,24}(?:接入|集成|开发|封装|注册)(?:契约|规范|任务|方案)|^(?:DSH\s*)?(?:核心)?工具接入契约/i.test(t)
  const craftSoftware = /(?:做|制作|写|create|make)[^\n]{0,60}(?:插件|接口|软件|工具|plugin|extension|software|tool)(?:[\s。.!]|$)/i.exec(t)
  const software = engineering ?? (craftSoftware && !/(?:一条|一期|一支|a video|a clip)/i.test(t) ? craftSoftware : null)
  if (/(?:只要|只写|只做|仅需|only)[^\n]{0,20}(?:文案|脚本|script|title|标题)/i.test(t) && !software) return {kind:'document'}
  if (/(?:只要|只做|仅需|only)[^\n]{0,20}(?:封面|图片|cover|image)/i.test(t) && !software) return {kind:'image'}
  if (/(?:检查|审查|审核|review|audit)[^\n]{0,60}(?:代码|渲染脚本|处理脚本|code|script)/i.test(t)) return {kind:'software',suggestedBase:'code-review'}
  if (writing && (!software || writing.index <= software.index) && !/^(?:开发|实现|接入|集成|build|implement|develop)/i.test(t)) {
    return {kind:'document', suggestedBase: /公众号|wechat/i.test(t) ? 'wechat-article' : null}
  }
  if (/(?:编写|设计|整理|补全|完善|新增|创建|write|design|create|build)[^\n]{0,80}(?:SOP|playbook|作业指导|工作流程)/i.test(t)) return {kind:'sop-authoring',suggestedBase:'sop-authoring'}
  if (software || nounFirstEngineering) {
    let suggestedBase = null
    if (/修复|报错|bug|\bfix\b|debug/i.test(t)) suggestedBase = 'bug-fix'
    else if (/插件|plugin|extension|核心工具|工具.*(?:同步|接入|注册)|(?:同步|接入|注册).*工具/i.test(t)) suggestedBase = /dsh|harness|session/i.test(t) ? 'dsh-plugin-development' : 'plugin-development'
    else if (writing) suggestedBase = null // e.g. AGENTS.md synchronization is a document/config operation.
    return {kind:'software',suggestedBase}
  }
  if (writing) return {kind:'document',suggestedBase:/公众号|wechat/i.test(t)?'wechat-article':null}
  const review = /(?:审一下|审查|审核|评审|审一审|检查|看一下|review|audit|check)[^\n]{0,60}(?:视频|成片|video|footage|\.mp4)/i.test(t)
  if (review) return {kind:'video-review',suggestedBase:'video-review'}
  if (/(?:分析|统计|复盘|调研|研究|对比|比较|analy[sz]e|research|compare)[^\n]{0,90}(?:数据|播放|收益|日志|方案|市场|竞品|报告|视频|data|metrics|logs?|market|report|video)/i.test(t)) return {kind:'analysis'}
  // Nominal order ('执行视频的生成') and explicit final-video heads must be
  // recognized before inspecting their audio/image implementation requirements.
  // Engineering/doc/review clauses above still take precedence.
  const videoHead = t.split(/\s+(?:using|with|from)\s+/i)[0]
  if (!/(?:audio|voice|image|cover)\s+(?:for|of)\b/i.test(videoHead) && /(?:执行|进行|开展|完成|负责)[^\n]{0,25}(?:视频|成片|短片)(?:的)?(?:生成|制作|生产|渲染|剪辑)(?:[。！!?？\s]|$)|(?:制作|生成|剪辑|组装|渲染|做成|合成|produce|create|generate|make|render)[^\n]{0,65}(?:视频|成片|短片|video|clip|mp4)(?:文件|file)?[。！!?？\s]*$/i.test(videoHead)) return {kind:'video-production'}
  if (/(?:生成|制作|画|绘制|设计|做|create|generate|draw|design|make)[^\n]{0,40}(?:封面|图片|图像|海报|cover|image|poster)/i.test(t)) return {kind:'image'}
  if (/(?:给|为)[^\n]{0,30}配音|(?:生成|合成|制作|配|转录|识别|复刻|克隆|做|generate|synthesize|produce|transcribe|clone)[^\n]{0,50}(?:配音|语音|音频|声音|歌曲|音乐|歌词|音色|TTS|ASR|audio|speech|voice|song|music)|^(?:配音|语音合成|音色复刻)/i.test(t)) return {kind:'audio'}
  if (/(?:制作|生成|剪辑|组装|渲染|合成|重做|做|produce|create|generate|make|render|edit)[^\n]{0,65}(?:视频|成片|短片|宣传片|video|clip|\.mp4)|(?:做|制作|produce)[^\n]{0,20}(?:b站|bilibili)[^\n]{0,30}(?:教程|实验|评测|tutorial|experiment)|(?:出片|成片交付)|(?:视频|video).{0,16}(?:任务书|制作任务|生产任务|production brief)/i.test(t)) return {kind:'video-production'}
  return null
}
function inferLead(text) {
  const lead = requestLead(text)
  // When an output is named before a topic marker, leave the subject out of
  // classification ("write an article about how to produce a video").
  const topic = /介绍|讲解|主题是|关于|\babout\b|\bexplaining\b/i.exec(lead)
  const prefix = topic && clauseKind(lead.slice(0, topic.index))
  const scoped = prefix && ['document','video-production','video-review','image','audio'].includes(prefix.kind) ? lead.slice(0,topic.index) : lead
  const chunks = scoped.split(/[\n，,；;。]|(?:\band (?:then |also )?)(?=(?:write|create|deploy|publish|produce|build|generate)\b)|并(?=(?:写|做|生成|发布|制作))/i)
  const classified = chunks.map(raw => ({raw, hit:clauseKind(raw)})).filter(row => row.hit)
  const hasVideo = classified.some(row => row.hit.kind === 'video-production')
  const hits = classified.filter(row => !hasVideo || row.hit.kind === 'video-production' || !supportingRequirement(row.raw)).map(row => row.hit)
  const kinds = [...new Set(hits.map(h=>h.kind))]
  if (!kinds.length) return {kind:'unknown',lead,kinds:[],suggestedBase:null}
  if (kinds.length > 1) return {kind:'mixed',lead,kinds,suggestedBase:null}
  const kind = kinds[0]
  return {kind,lead,kinds,suggestedBase:hits.find(h=>h.suggestedBase)?.suggestedBase ?? null}
}

export function analyzeTask(task, sourceTexts = []) {
  const messages = String(task ?? '').split('\n用户补充 / Clarification: ').map(inferLead)
  const direct = messages.filter(m=>m.kind!=='unknown').at(-1) ?? messages[0]
  let effective = direct, basis = 'direct-user-request'
  // Source text can define the job only when the user delegated the deliverable
  // to that document. "Review/explain/update the video brief" remains a review,
  // explanation or update, never an instruction to run the brief's workflow.
  if (direct.kind === 'unknown' && /(?:按|按照|根据|执行|完成|照着|照此|follow|carry out|execute|complete)[^\n]{0,90}(?:任务|文档|要求|方案|附件|task|brief|document|instructions|specification)|^(?:开始|执行|完成|do it|go ahead)[!！。\s]*$/i.test(direct.lead)) {
    const known = sourceTexts.map(inferLead).filter(s=>s.kind!=='unknown')
    const kinds = [...new Set(known.flatMap(s=>s.kinds))]
    if (kinds.length === 1) { effective = known[0]; basis = 'requested-source-brief' }
    else if (kinds.length > 1) { effective = {kind:'mixed',kinds,lead:direct.lead,suggestedBase:null}; basis='conflicting-source-briefs' }
  }
  const producesVideo = effective.kind === 'video-production'
  let suggestedBase = effective.suggestedBase
  let domain = null
  if (producesVideo) {
    // Domain is considered only AFTER proving a video is requested. A project's
    // name, broad workspace instructions or media API examples never impose it.
    const domainText = basis === 'requested-source-brief' ? effective.lead :
      // A generic '完整成片' clarification does not erase the already stated domain.
      [...messages.filter(m => m.kind === 'video-production').map(m => m.lead), direct.lead].join('\n')
    domain = /道家|道教|庄子|老子|道德经|逍遥游|\b(taoist|taoism|daoist|zhuangzi)\b/i.test(domainText) ? 'taoist-culture' : null
    suggestedBase = domain ? 'taoist-culture-video' : /b站|bilibili/i.test(domainText) ? 'bilibili-video-production' : 'short-video-production'
  }
  return {version:1,kind:effective.kind,kinds:effective.kinds,producesVideo,domain,suggestedBase,basis,
    requestExcerpt:direct.lead.slice(0,500),confidence:effective.kind==='unknown'||effective.kind==='mixed'?'uncertain':'rule-match',
    note:'Deliverable hint, not an authorization or proof of semantic understanding. Project names and API examples do not define the deliverable.'}
}

export function baseKind(baseId, definition) {
  if (VIDEO_BASES.has(baseId) || definition?.stages?.some(s=>s.gate?.validators?.length)) return 'video-production'
  if (SOFTWARE_BASES.has(baseId)) return 'software'
  if (baseId === 'video-review') return 'video-review'
  if (baseId === 'sop-authoring') return 'sop-authoring'
  if (baseId === 'wechat-article') return 'document'
  if (['data-analysis','research-report','code-review'].includes(baseId)) return 'analysis'
  if (['music-production','music-release'].includes(baseId)) return 'audio'
  return 'unknown'
}

/** Symmetric media applicability check BEFORE starting, not a new quality gate. */
export function selectionMismatch(scope, baseId, definition) {
  if (!scope || scope.kind === 'unknown' || scope.kind === 'mixed') return null
  const selected = baseKind(baseId, definition)
  if (scope.producesVideo && selected !== 'video-production') return 'This request actually requires a video deliverable; a non-video base does not cover it.'
  if (!scope.producesVideo && selected === 'video-production') return 'The requested deliverable is not a produced video. Do not attach narration/pilot/MP4 checks to tools, documents, audio, images or reviews.'
  if (scope.domain === 'taoist-culture' && VIDEO_BASES.has(baseId) && baseId !== 'taoist-culture-video') return 'Taoist video production requires its domain base, not only its publishing platform.'
  return null
}

/** Filtering recommendations is not deleting stored methods. */
export function recommendationFits(scope, baseId) {
  if (!scope || ['unknown','mixed'].includes(scope.kind)) return true
  const k = baseKind(baseId)
  if (k === 'unknown') return true
  if (scope.producesVideo) return k === 'video-production' && (scope.domain !== 'taoist-culture' || baseId === 'taoist-culture-video')
  if (k === 'video-production') return false
  if (k === 'video-review') return scope.kind === 'video-review'
  return true
}

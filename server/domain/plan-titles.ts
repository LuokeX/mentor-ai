/**
 * 方案标题领域函数（纯函数，不依赖数据库）。
 *
 * 标题按方案来源分支生成并在方案生成时固化为快照（title/titleFull）：
 * - assistant_dialogue（AI 来源）：「对象名称 ｜ AI问题：提问首句」，
 *   无对象时省略对象段，无提问时兜底「模块标题 ｜ 方案」；
 * - direct_assessment（直接评估）：按归因顺序每条描述取首句，最多前 3 条，
 * 列表与详情都只投影快照，避免旧方案随三库版本发布而"变标题"。
 */

export type PlanSourceType = 'assistant_dialogue' | 'direct_assessment'

export interface PlanTitleInput {
  sourceType: PlanSourceType
  /** 模块标题（如「班级系统建设」），无归因/无提问时的兜底文案用 */
  moduleTitle: string
  /** 关联对象标签（学生/班级/家长），为空时省略该段 */
  objectLabel?: string | null
  /** AI 来源的提问首句（已脱敏截断） */
  questionSummary?: string | null
  /** 归因关键词，按序（用于关键词快照与标题兜底） */
  attributionNames: string[]
  /** 归因描述文本，按归因顺序；每条取首句拼接（直接评估标题，最多前 3 条） */
  attributionDescriptions?: string[]
}

export const PLAN_TITLE_MAX = 200

/**
 * 按中文标点断句：句号/分号/叹号/问号/换行均视为句界，标点保留在句尾。
 * 过滤空串，返回前 max 句。
 */
export function splitSentences(text: string, max = 3): string[] {
  const sentences = String(text || '').match(/[^。；;！？!?\n]+[。；;！？!?]?/g) || []
  return sentences.map(s => s.trim()).filter(Boolean).slice(0, max)
}

/** 按 Unicode 码点截断，避免代理对（emoji 等）被切成半个字符。 */
export function truncateByChars(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/** 直接评估标题：按归因顺序每条取首句，最多前 3 条；无描述时回退到归因关键词连接。 */
function buildDirectAssessmentTitle(input: PlanTitleInput): string {
  const sentences = (input.attributionDescriptions || [])
    .map(desc => splitSentences(desc, 1)[0] || '')
    .filter(Boolean)
    .slice(0, 3)
  if (sentences.length) return sentences.join('')
  const keywords = input.attributionNames.filter(Boolean)
  if (keywords.length) return keywords.join('、')
  return `${input.moduleTitle} ｜ 方案`
}

export function buildPlanTitle(input: PlanTitleInput): { title: string, titleFull: string } {
  const question = input.questionSummary?.trim()
  const titleFull = input.sourceType === 'assistant_dialogue'
    ? [input.objectLabel || undefined, question ? `AI问题：${question}` : undefined]
        .filter(Boolean)
        .join(' ｜ ') || `${input.moduleTitle} ｜ 方案`
    : buildDirectAssessmentTitle(input)
  return { title: truncateByChars(titleFull, PLAN_TITLE_MAX), titleFull }
}

/** 归因关键词快照：按序去重，取前 5 个。 */
export function buildAttributionKeywords(names: string[], max = 5): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const item = name?.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= max) break
  }
  return result
}
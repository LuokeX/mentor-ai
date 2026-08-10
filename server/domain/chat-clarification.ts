import type { ModuleId } from '../../shared/contracts'
import { moduleMeta } from '../../shared/assessments'

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export function composeClarificationSummaryHistory(input: {
  entityMemory?: ChatHistoryMessage[]
  history: ChatHistoryMessage[]
  currentMessage?: string
  includeCurrentMessage: boolean
}): ChatHistoryMessage[] {
  const base = [...(input.entityMemory || []), ...input.history]
  if (!input.includeCurrentMessage) return base

  const currentMessage = input.currentMessage?.trim()
  if (!currentMessage) return base
  return [...base, { role: 'user', content: currentMessage }]
}

/**
 * 判定文本是否像"追问问题"而不是总结。
 *
 * 总结阶段模型可能受历史中"问题 + 选项"格式影响，再次输出追问（如
 * "这学期数学课的内容，你觉得…？\n\n选项：…"）。这类输出没有分析价值，
 * 解析层应识别并拒绝，而不是当成总结结果保存展示。
 */
export function isFollowUpQuestionLike(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  // 出现"选项："是追问轮次输出的最典型特征，总结文本不应包含
  if (value.includes('选项：') || value.includes('选项:')) return true
  // 追问通常短句 + 问号结尾；总结要求 500-1500 字，短问句不可能是总结
  const questionMarkEnding = /[？?]\s*$/.test(value)
  if (questionMarkEnding && value.length < 200) return true
  // 追问语气词组合兜底（短文本 + 明显追问句式）
  const followUpPhrases = ['你觉得', '你观察', '你印象', '大概', '是怎么', '为什么', '什么样', '多久']
  if (value.length < 200 && followUpPhrases.some(phrase => value.includes(phrase))) return true
  return false
}

/**
 * 总结阶段清洗历史：把 assistant 追问消息截断到"选项："之前，
 * 只保留问题本身。避免模型把"问题 + 选项"格式当作输出范例，
 * 在总结阶段继续模仿追问。
 */
export function sanitizeHistoryForSummary(history: ChatHistoryMessage[]): ChatHistoryMessage[] {
  return history.map(item => {
    if (item.role !== 'assistant') return item
    const optionIdx = item.content.indexOf('选项：')
    if (optionIdx === -1) return item
    const question = item.content.slice(0, optionIdx).trim()
    return question ? { role: item.role, content: question } : item
  })
}

/** 从模块评分中取最高分模块；无评分时返回 undefined。 */
export function topModuleFromScores(scores: Record<string, number> | undefined | null): ModuleId | undefined {
  if (!scores) return undefined
  const entries = Object.entries(scores).filter(([, value]) => value > 0)
  if (entries.length === 0) return undefined
  return entries.reduce((a, b) => (a[1] >= b[1] ? a : b))[0] as ModuleId
}

/** 澄清总结响应中期望的 JSON 元数据结构（模型输出，字段可缺省）。 */
export interface SummaryJsonMeta {
  rationale?: string
  primaryModule?: string
  moduleProportions?: Record<string, number>
  suggestedActions?: Array<{ label: string; type: string; module?: string }>
}

/**
 * 总结输出质量校验：长度足够、不是追问句式、JSON 元数据完整且模块合法。
 * 不满足任一条件即视为失败，应由调用方重试或走结构化兜底。
 */
export function isValidSummaryOutput(answer: string, jsonMeta: SummaryJsonMeta): boolean {
  return (
    answer.trim().length >= 20 &&
    !isFollowUpQuestionLike(answer) &&
    Boolean(jsonMeta.rationale) &&
    Boolean(jsonMeta.moduleProportions) &&
    (Object.keys(moduleMeta) as string[]).includes(jsonMeta.primaryModule || '')
  )
}

/** 将任意模块评分收敛为五模块全量占比；缺失或非法值保持原字段。 */
export function normalizeModuleProportions(
  scores: Record<string, number> | undefined | null
): Record<ModuleId, number> | null {
  if (!scores) return null
  const filtered: Partial<Record<ModuleId, number>> = {}
  for (const key of Object.keys(moduleMeta) as ModuleId[]) {
    const value = scores[key]
    if (typeof value === 'number' && Number.isFinite(value)) filtered[key] = value
  }
  return Object.keys(filtered).length === Object.keys(moduleMeta).length
    ? filtered as Record<ModuleId, number>
    : null
}
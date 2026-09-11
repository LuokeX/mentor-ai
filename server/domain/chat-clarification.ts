import type { ModuleId } from '../../shared/contracts'

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Agent 回放历史时清洗消息：把 assistant 消息里"问题 + 选项"格式截断到"选项："之前，
 * 只保留问题本身，避免模型把历史中的追问格式当作输出范例继续模仿。
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

import { z } from 'zod'
import { estimateTokens, type HistoryMessage } from './chat-history'

const entry = z.object({
  kind: z.enum(['fact', 'constraint', 'attempt', 'hypothesis', 'open_question', 'agreement']),
  text: z.string().min(1).max(500),
  sourceId: z.string().min(1),
  occurredAt: z.string(),
  sourceRole: z.enum(['user', 'assistant'])
})
export const memorySchema = z.object({ version: z.literal(1), entries: z.array(entry).max(30) })
export type ConversationMemory = z.infer<typeof memorySchema>

export function parseMemory(text: string | null): ConversationMemory | null {
  try { return memorySchema.parse(JSON.parse(text ?? '')) } catch { return null }
}

/** 旧文本仍可读取；新摘要逐项校验来源，不能将助手建议提升为事实。 */
export function validateMemory(text: string, messages: HistoryMessage[], previous: string | null): string | null {
  const memory = parseMemory(text)
  if (!memory) return null
  const old = parseMemory(previous)
  const sources = new Map(messages.filter(m => m.id && m.createdAt).map(m => [m.id!, m]))
  const valid = memory.entries.every(item => {
    const source = sources.get(item.sourceId)
    if (source) return item.sourceRole === source.role && item.occurredAt === source.createdAt
      && (source.role === 'user' || ['hypothesis', 'open_question'].includes(item.kind))
      && source.content.includes(item.text)
    return old?.entries.some(e => JSON.stringify(e) === JSON.stringify(item)) ?? false
  })
  return valid ? JSON.stringify(memory) : null
}

/** 相关片段和最近纠正共同保留；来源与原文均返回，不生成跨会话“事实”。 */
export function rankMemory<T extends { content: string; createdAt: Date }>(rows: T[], query: string, limit = 12): T[] {
  const terms = [...new Set(query.match(/[\u3400-\u9fff]{2,}|[a-zA-Z]{3,}/g)?.flatMap(t => t.length > 2 ? Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2)) : [t]) ?? [])]
  const scored = rows.map((row, index) => ({ row, score: terms.reduce((n, term) => n + Number(row.content.includes(term)), 0) + (index < 2 ? 2 : 0) + (/更正|说错|不是|没用|无效/.test(row.content) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.row.createdAt.getTime() - a.row.createdAt.getTime())
  // 最新两条先入选，避免新纠正被词面高度相关的旧陈述挤出。
  const newest = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, Math.min(2, limit))
  const ordered = [...newest, ...scored.map(item => item.row).filter(row => !newest.includes(row))]
  let tokens = 0
  const picked: T[] = []
  for (const row of ordered) {
    const cost = estimateTokens(row.content)
    if (cost + tokens > 6000) continue
    picked.push(row); tokens += cost
    if (picked.length >= limit) break
  }
  return picked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

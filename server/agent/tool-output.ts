/** 按段落/句子分配正文预算，展示摘要另行裁剪。绝不切开 JSON。 */
export function budgetText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const prefix = text.slice(0, max)
  const boundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('。'), prefix.lastIndexOf('；'))
  return { text: boundary >= 0 ? prefix.slice(0, boundary + 1) : '', truncated: true }
}

export type ToolOutcome = 'success' | 'empty' | 'error' | 'timeout'

export function toolOutcome(value: unknown): ToolOutcome {
  if (!value || typeof value !== 'object') return 'success'
  const item = value as Record<string, unknown>
  if (['error', 'timeout', 'empty'].includes(String(item.status))) return item.status as ToolOutcome
  if (item.error) return /超时/.test(String(item.error)) ? 'timeout' : 'error'
  const arrays = Object.values(item).filter(Array.isArray)
  return arrays.length > 0 && arrays.every(list => list.length === 0) ? 'empty' : 'success'
}

export function serializeToolOutput(value: unknown, cap = 16000): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  if (serialized.length <= cap) return serialized
  // 无法在通用层安全理解领域结构：要求缩小查询，不能把残缺事实送给模型。
  return JSON.stringify({ status: 'error', error: '工具结果超过预算', truncated: true, message: '请缩小查询范围后重试，不要把本次结果当作没有记录。' })
}

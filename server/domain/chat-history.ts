/**
 * 对话历史装载（P1：只追加前缀 + token 预算）。
 *
 * 背景：DeepSeek 的上下文硬盘缓存只认「完整匹配缓存前缀单元」。原先按条数滑窗
 * （limit(8) + slice(-12)）会让每一轮的请求前缀从历史开头就分叉，等于每轮都
 * 放弃缓存命中；这里改为按 token 预算保留尾部，且只在超预算时整块丢弃，
 * 使连续多轮的前缀保持「上一轮是这一轮的前缀」这一不变量。
 *
 * 本模块只做纯计算，不访问数据库；token 数用字符启发式估算，便于后续替换为真实分词器。
 */
import type { AgentMessage } from '../agent/types'

export interface HistoryMessage {
  id?: string
  createdAt?: string
  role: 'user' | 'assistant'
  content: string
}

export interface HistoryWindow {
  /** 预算内的历史（正序），起点对齐到 user 消息。 */
  selected: HistoryMessage[]
  /** 被丢弃的历史条数（超预算部分）。 */
  droppedCount: number
  /** 选中历史的估算 token 数（含每条消息的角色开销）。 */
  estimatedTokens: number
}

/** 单条消息的角色与格式开销（token），保守取值。 */
export const MESSAGE_OVERHEAD_TOKENS = 4

/**
 * 估算文本 token 数：CJK 字符按 1 token，其余按 4 字符 1 token（保守取整）。
 * 仅用于预算裁剪；需要精确值时用服务端返回的 usage。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g)?.length ?? 0
  const rest = text.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/** 估算一组历史消息的 token 数（含每条消息的角色开销）。 */
export function estimateHistoryTokens(messages: HistoryMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS, 0)
}

/**
 * 按 token 预算选择历史尾部。
 *
 * 规则：
 * 1. 从最新一条往前累加，直到超出预算；
 * 2. 起点对齐到 user 消息，保证历史以教师提问开头；
 * 3. 若对齐后为空（预算极小或尾部全是 assistant），退化为最后一个完整来回（最后一条 user 起）。
 */
export function selectHistoryWindow(messages: HistoryMessage[], budgetTokens: number): HistoryWindow {
  if (!messages.length) return { selected: [], droppedCount: 0, estimatedTokens: 0 }
  const budget = Math.max(0, Math.floor(budgetTokens))
  let start = messages.length
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(messages[index]!.content) + MESSAGE_OVERHEAD_TOKENS
    if (used + cost > budget && start < messages.length) break
    used += cost
    start = index
  }
  // 对齐到 user 消息起点：把可能落在窗口开头的 assistant 消息排除掉
  while (start < messages.length && messages[start]!.role !== 'user') {
    used -= estimateTokens(messages[start]!.content) + MESSAGE_OVERHEAD_TOKENS
    start += 1
  }
  // 对齐后为空：退化为最后一个完整来回（保证至少带回一次教师提问）
  if (start >= messages.length) {
    let lastUser = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]!.role === 'user') {
        lastUser = index
        break
      }
    }
    start = lastUser === -1 ? messages.length - 1 : lastUser
    used = estimateHistoryTokens(messages.slice(start))
  }
  const selected = messages.slice(start)
  return { selected, droppedCount: start, estimatedTokens: used }
}

/**
 * 前缀稳定性断言：next 的前 N 条（N = previous.length）是否与 previous 完全一致。
 * 只追加布局下，连续两轮的请求序列应满足该不变量（压缩轮除外）。
 */
export function isAppendOnlyPrefix(previous: HistoryMessage[], next: HistoryMessage[]): boolean {
  if (previous.length > next.length) return false
  return previous.every((message, index) => {
    const other = next[index]
    return Boolean(other) && other!.role === message.role && other!.content === message.content
  })
}

/** 把数据库回放的 AgentMessage 转成历史视图（过滤非法角色）。 */
export function toHistoryMessages(messages: Array<{ role: string, content: string, id?: string, createdAt?: Date | string }>): HistoryMessage[] {
  return messages.flatMap(message => (
    message.role === 'user' || message.role === 'assistant'
      ? [{ role: message.role as 'user' | 'assistant', content: message.content, ...(message.id ? { id: message.id } : {}), ...(message.createdAt ? { createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt } : {}) }]
      : []
  ))
}

/** AgentMessage 与 HistoryMessage 结构一致，显式转换以便类型收窄。 */
export function toAgentMessages(messages: HistoryMessage[]): AgentMessage[] {
  return messages.map(message => ({ role: message.role, content: message.content }))
}

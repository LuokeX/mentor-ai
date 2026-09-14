/**
 * 会话历史压缩（P2）。
 *
 * 目标：长会话不再无限增长，也不每天丢弃最旧消息。做法是按「预算的保留比例」
 * 找一条保留边界，把游标之后、边界之前的消息一次性压缩成一份加密摘要，
 * 下次请求用「摘要 + 边界之后的原文」组成上下文。
 *
 * 与缓存的关系：摘要只在压缩时更新，每次压缩会让前缀断裂一次，因此压缩必须
 * 低频、大批量；具体频率由调用点用 token 预算与保留比例控制。
 *
 * 与安全边界的关系：压缩输入按学校数据模式脱敏，摘要正文加密落库，原始消息保留不删。
 */
import type { H3Event } from 'h3'
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm'
import { decryptSensitive, encryptSensitive } from '../utils/crypto'
import { schema, useDb } from '../utils/db'
import { renderPrompt } from './ai-config'
import { estimateHistoryTokens, estimateTokens, MESSAGE_OVERHEAD_TOKENS, type HistoryMessage } from './chat-history'
import { redactOutboundText, type AiDataMode } from './ai-governance'

/** 摘要提示词占位符上限：避免超长输入把摘要调用拖慢或超时。 */
const SUMMARY_INPUT_TOKEN_CAP = 30000
/** 摘要输出上限与超时。 */
const SUMMARY_MAX_TOKENS = 800
const SUMMARY_SOURCE_LIMIT = 300

export interface CompactionPlan {
  required: boolean
  /** 需要压缩的消息（较旧部分）。 */
  compactMessages: HistoryMessage[]
  /** 压缩后保留的原文消息（较新部分）。 */
  keepMessages: HistoryMessage[]
  compactTokens: number
  keepTokens: number
}

/**
 * 规划压缩范围（纯函数）：保留最近 keepRatio × 预算 的原文，更旧的进入压缩。
 * 保留边界对齐到 user 消息，避免摘要从半个来回处切开。
 *
 * 注意：本函数只回答「有没有可压缩的前缀」，是否需要压缩由调用点决定
 * （调用点仅在历史超出预算、不得不丢弃原文时才压缩，以保证压缩低频）。
 * 历史本身就小于保留预算时，返回 required=false。
 */
export function planCompaction(
  messages: HistoryMessage[],
  budgetTokens: number,
  keepRatio = 0.5
): CompactionPlan {
  const totalTokens = estimateHistoryTokens(messages)
  const empty: CompactionPlan = { required: false, compactMessages: [], keepMessages: messages, compactTokens: 0, keepTokens: totalTokens }
  if (!messages.length) return empty
  const keepBudget = Math.max(1, Math.floor(budgetTokens * Math.min(1, Math.max(0.1, keepRatio))))
  let start = messages.length
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(messages[index]!.content) + MESSAGE_OVERHEAD_TOKENS
    if (used + cost > keepBudget && start < messages.length) break
    used += cost
    start = index
  }
  while (start < messages.length && messages[start]!.role !== 'user') {
    used -= estimateTokens(messages[start]!.content) + MESSAGE_OVERHEAD_TOKENS
    start += 1
  }
  if (start <= 0 || start >= messages.length) return empty
  return {
    required: true,
    compactMessages: messages.slice(0, start),
    keepMessages: messages.slice(start),
    compactTokens: totalTokens - used,
    keepTokens: used
  }
}

/** 把待压缩消息渲染成提示词用的文本（含角色标记，逐字节确定）。 */
export function formatCompactionTranscript(messages: HistoryMessage[]): string {
  return messages
    .map(message => `${message.role === 'user' ? '教师' : '助手'}：${message.content}`)
    .join('\n')
}

export interface SummarizeHistoryResult {
  summary: string
  promptTokens?: number
  completionTokens?: number
}

/**
 * 调用模型生成/合并摘要。失败返回 null（调用点保留旧摘要并继续本轮回答）。
 * 只记录元数据审计，不记录摘要正文与原文。
 */
export async function summarizeHistory(
  event: H3Event,
  input: {
    messages: HistoryMessage[]
    previousSummary: string | null
    dataMode: AiDataMode
    schoolId: string | null
    ownerUserId: string
    sessionId: string
  }
): Promise<SummarizeHistoryResult | null> {
  if (!input.messages.length) return null
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return null
  const model = String(config.deepseekRouterModel || 'deepseek-flash')
  const startedAt = Date.now()

  // 输入限长：从最近的消息往前取，避免摘要调用本身超时
  const outbound = (text: string) => redactOutboundText(text, input.dataMode)
  const picked: HistoryMessage[] = []
  let usedTokens = 0
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]!
    const cost = estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS
    if (usedTokens + cost > SUMMARY_INPUT_TOKEN_CAP && picked.length) break
    picked.unshift({ role: message.role, content: outbound(message.content) })
    usedTokens += cost
  }

  const prompt = await renderPrompt(event, 'chat_history_summary', {
    previousSummary: input.previousSummary?.trim() || '（无）',
    newMessages: formatCompactionTranscript(picked)
  })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  if (!messages.length) return null

  const record = async (status: 'success' | 'failed', extra: { promptTokens?: number, completionTokens?: number, errorCode?: string } = {}) => {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model,
      purpose: 'chat_history_summary',
      status,
      latencyMs: Date.now() - startedAt,
      promptTokens: extra.promptTokens,
      completionTokens: extra.completionTokens,
      errorCode: extra.errorCode
    }).catch(() => undefined)
  }

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model,
        messages,
        // 摘要不需要思考链：显式关闭以降低延迟与成本（OpenAI 兼容格式下放在请求体）
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: SUMMARY_MAX_TOKENS
      }),
      signal: AbortSignal.timeout(Math.max(Number(config.deepseekTimeoutMs) || 0, 30000))
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number, completion_tokens?: number }
    }
    const summary = json.choices?.[0]?.message?.content?.trim()
    if (!summary) throw new Error('Empty summary output')
    await record('success', {
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens
    })
    return { summary, promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens }
  } catch (error) {
    await record('failed', { errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown' })
    console.warn('[chat-compaction] 摘要生成失败，保留旧摘要:', error instanceof Error ? error.message : error)
    return null
  }
}

export interface CompactSessionResult {
  summary: string
  /** 摘要覆盖到的消息时间（游标）；下一轮只回放该时间之后的消息。 */
  uptoAt: Date
  summaryTokens: number
}

/**
 * 压缩会话历史：读取游标之后、保留边界之前的消息，生成合并摘要并加密落库。
 * 任何失败返回 null，本轮回答继续（最坏情况退化为按预算丢弃最旧消息）。
 */
export async function compactSessionHistory(
  event: H3Event,
  input: {
    sessionId: string
    schoolId: string | null
    ownerUserId: string
    dataMode: AiDataMode
    summaryUptoAt: Date | null
    /** 保留边界（不含）：该时间之后的消息继续以原文回放。 */
    uptoBeforeAt: Date
    previousSummary: string | null
  }
): Promise<CompactSessionResult | null> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const conditions = [
    eq(schema.chatMessages.sessionId, input.sessionId),
    eq(schema.chatMessages.ownerUserId, input.ownerUserId),
    isNull(schema.chatMessages.deletedAt),
    lt(schema.chatMessages.createdAt, input.uptoBeforeAt)
  ]
  if (input.summaryUptoAt) conditions.push(gt(schema.chatMessages.createdAt, input.summaryUptoAt))

  const rows = await db.select({
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    createdAt: schema.chatMessages.createdAt
  }).from(schema.chatMessages)
    .where(and(...conditions))
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(SUMMARY_SOURCE_LIMIT)

  const messages = rows.flatMap(row => (
    row.role === 'user' || row.role === 'assistant'
      ? [{ role: row.role as 'user' | 'assistant', content: decryptSensitive(row.contentEnc, secret) }]
      : []
  ))
  if (!messages.length) return null

  const result = await summarizeHistory(event, {
    messages,
    previousSummary: input.previousSummary,
    dataMode: input.dataMode,
    schoolId: input.schoolId,
    ownerUserId: input.ownerUserId,
    sessionId: input.sessionId
  })
  if (!result) return null

  const uptoAt = rows[rows.length - 1]!.createdAt
  const summaryTokens = estimateTokens(result.summary)
  try {
    await db.update(schema.chatSessions).set({
      contextSummaryEnc: encryptSensitive(result.summary, secret),
      contextSummaryUptoAt: uptoAt,
      contextSummaryUpdatedAt: new Date(),
      contextSummaryTokens: summaryTokens
    }).where(eq(schema.chatSessions.id, input.sessionId))
  } catch (error) {
    console.warn('[chat-compaction] 摘要落库失败，本轮不启用新摘要:', error instanceof Error ? error.message : error)
    return null
  }
  return { summary: result.summary, uptoAt, summaryTokens }
}

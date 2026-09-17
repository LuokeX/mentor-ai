/**
 * 首页助手一轮对话的共享流水线。
 *
 * 为什么单独成模块：普通提问（POST /chat/messages）与「重新生成」（POST /chat/messages/[id]/regenerate）
 * 需要完全相同的装载、脱敏、图执行、校验、落库与事件转发逻辑。抽到这里后两条入口各自只保留
 * 认证、归属校验与「这一轮到底问的是什么」，避免复制一份 200 行的实现后两边逐渐走偏。
 *
 * 不变式（与 AGENTS.md 第 8.2 节一致）：
 *  - 历史按「只追加前缀 + token 预算」装载，超预算走低频大块压缩，不做条数滑窗；
 *  - 工具轨迹只回放最近一轮，使上一轮请求成为本轮前缀；
 *  - system 段会话内稳定（咨询对象只留指针，档案由工具按需查）；
 *  - 外发文本按学校数据模式脱敏；local 模式不进入本模块（入口直接返回提示）。
 */
import { parseMemory } from './chat-memory'
import { AnswerDelivery } from '../agent/answer-delivery'
import { needsEvidenceReview, teacherEvidence, type AnswerEvidence } from '../agent/evidence'
import { reviewAssistantAnswer } from './assistant-answer-review'
import type { H3Event } from 'h3'
import { and, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm'
import type { ModuleId } from '../../shared/contracts'
import type { AgentMessage, AgentToolTraceStep } from '../agent/types'
import { buildAgentSystemPrompt } from '../agent/prompts'
import { runAgentGraph } from '../agent/graph'
import { inspectAgentAnswer } from '../agent/answer-guard'
import { parseToolTrace, attachToolTraces, serializeToolTrace } from '../agent/tool-trace'
import { MESSAGE_OVERHEAD_TOKENS, estimateTokens, selectHistoryWindow, toHistoryMessages } from './chat-history'
import { compactSessionHistory, planCompaction } from './chat-compaction'
import { contextTypeLabel } from './chat-context-switch'
import { sanitizeHistoryForSummary } from './chat-clarification'
import { redactOutboundText, type AiDataMode } from './ai-governance'
import { generateChatTitle } from '../integrations/deepseek'
import { buildChatTitle } from './chat-titles'
import { trackProductEvent } from './product-events'
import { decryptSensitive, encryptSensitive } from '../utils/crypto'
import { schema, useDb } from '../utils/db'

/** 历史装载的安全上限（仅防异常长会话全表读入；实际裁剪由 token 预算决定）。 */
export const HISTORY_ROW_SAFETY_LIMIT = 400

/** 治理对象的调用方视图（只用到生效模式与告知版本）。 */
export interface ChatGovernanceLike {
  effectiveMode: AiDataMode
  noticeVersion?: string | null
}

/** 入口侧的调用者视图。 */
export interface ChatStreamUser {
  id: string
  schoolId: string
  /** 任教年级（1-12）：供工具按学段筛选资源；空或未传表示未填写，不过滤 */
  teachingGrades?: number[]
}

/** 会话里读出来的元数据（模块占比等）。 */
export interface ChatSessionContext {
  sessionId: string
  metadata: Record<string, unknown>
  contextSummary: string | null
  summaryUptoAt: Date | null
  contextSummaryEnc: string | null
}

/** 读取会话的摘要字段与元数据（归属由调用方在查询条件里保证）。 */
export async function loadChatSessionContext(
  event: H3Event,
  user: ChatStreamUser,
  sessionId: string
): Promise<ChatSessionContext | null> {
  const db = useDb(event)
  const [row] = await db.select({
    id: schema.chatSessions.id,
    metadata: schema.chatSessions.metadata,
    contextSummaryEnc: schema.chatSessions.contextSummaryEnc,
    contextSummaryUptoAt: schema.chatSessions.contextSummaryUptoAt
  }).from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id), eq(schema.chatSessions.schoolId, user.schoolId)))
    .limit(1)
  if (!row) return null
  const config = useRuntimeConfig(event)
  let contextSummary: string | null = null
  let summaryUptoAt = row.contextSummaryUptoAt ?? null
  if (row.contextSummaryEnc) {
    try {
      contextSummary = decryptSensitive(row.contextSummaryEnc, config.encryptionKey)
    } catch (error) {
      console.warn('[chat-stream] 会话摘要解密失败，本轮忽略摘要:', error instanceof Error ? error.message : error)
      contextSummary = null
      summaryUptoAt = null
    }
  }
  return {
    sessionId: row.id,
    metadata: (row.metadata as Record<string, unknown>) || {},
    contextSummary,
    summaryUptoAt,
    contextSummaryEnc: row.contextSummaryEnc ?? null
  }
}

/** 最小教师画像快照：只取业务所需的班主任/学科/任教年级，不含姓名电话等 PII；全空时返回 null 不注入。 */
export async function buildTeacherProfileText(event: H3Event, userId: string): Promise<string | null> {
  const db = useDb(event)
  const [row] = await db.select({
    subject: schema.users.subject,
    teachingGrades: schema.users.teachingGrades,
    isClassTeacher: schema.users.isClassTeacher,
    classTeacherYears: schema.users.classTeacherYears
  }).from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!row) return null
  const parts: string[] = []
  if (row.isClassTeacher) parts.push(row.classTeacherYears ? `班主任（${row.classTeacherYears}年）` : '班主任')
  if (row.subject) parts.push(`${row.subject}学科教师`)
  if (row.teachingGrades?.length) parts.push(`任教年级：${row.teachingGrades.join('、')}`)
  return parts.length ? parts.join('；') : null
}

/** 会话内模块评估占比（兼容历史结构 metadata.clarificationState.moduleScores）。 */export function getSessionModuleScores(metadata: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!metadata) return {}
  const direct = metadata.moduleScores
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, number>
  const legacy = (metadata.clarificationState as { moduleScores?: Record<string, number> } | undefined)?.moduleScores
  return legacy && typeof legacy === 'object' ? legacy : {}
}

export interface LoadHistoryInput {
  before?: Date
  objectSince?: Date
  withoutRecord?: boolean
  event: H3Event
  user: ChatStreamUser
  sessionId: string
  contextSummary: string | null
  summaryUptoAt: Date | null
  /** 历史 token 预算（入口从运行时配置取） */
  historyBudgetTokens: number
  /** 压缩保留比例 */
  compactionKeepRatio: number
  dataMode: AiDataMode
}

export interface LoadedHistory {
  /** 已脱敏、已挂载最近一轮工具轨迹的历史消息（不含本轮提问） */
  messages: AgentMessage[]
  contextSummary: string | null
  summaryUptoAt: Date | null
}

/**
 * 装载会话历史（含超预算压缩与最近一轮工具轨迹回放）。
 *
 * 预算与压缩口径与改造前保持一致：倒序增量解密 → 超预算时尝试一次低频大块压缩 →
 * 压缩后的保留段再做 token 预算裁剪；软删消息与摘要已覆盖的消息都不回放。
 */
export async function loadSessionHistoryForAgent(input: LoadHistoryInput): Promise<LoadedHistory> {
  const { event, user, sessionId, dataMode } = input
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  const memory = parseMemory(input.contextSummary)
  const summarySafe = !input.withoutRecord && (!input.before || !input.summaryUptoAt || input.summaryUptoAt < input.before)
    && (!input.objectSince || Boolean(memory?.entries.length && memory.entries.every(item => Date.parse(item.occurredAt) >= input.objectSince!.getTime())))
  const savedSummary = summarySafe ? input.contextSummary : null
  const savedCursor = summarySafe ? input.summaryUptoAt : null
  const summaryBudgetTokens = savedSummary ? estimateTokens(savedSummary) : 0
  const historyBudget = Math.max(2000, input.historyBudgetTokens - summaryBudgetTokens)
  const conditions = [
    eq(schema.chatMessages.sessionId, sessionId),
    eq(schema.chatMessages.ownerUserId, user.id),
    eq(schema.chatMessages.schoolId, user.schoolId),
    isNull(schema.chatMessages.deletedAt)
  ]
  if (savedCursor) conditions.push(gt(schema.chatMessages.createdAt, savedCursor))
  if (input.before) conditions.push(lt(schema.chatMessages.createdAt, input.before))
  if (input.objectSince) conditions.push(gte(schema.chatMessages.createdAt, input.objectSince))
  if (input.withoutRecord) conditions.push(eq(schema.chatMessages.role, 'user'))

  const previousMessages = await db.select({
    id: schema.chatMessages.id,
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    toolTraceEnc: schema.chatMessages.toolTraceEnc,
    createdAt: schema.chatMessages.createdAt
  }).from(schema.chatMessages)
    .where(and(...conditions))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(HISTORY_ROW_SAFETY_LIMIT)

  // 倒序增量解密：预算已满足且再往前只会更旧时停止，避免整会话全量解密
  const decryptedDesc: Array<{ id: string, role: 'user' | 'assistant', content: string, createdAt: Date }> = []
  let decryptedTokens = 0
  let replayToolTrace: AgentToolTraceStep[] | null = null
  let inspectedLatestAssistant = false
  for (const item of previousMessages) {
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const content = decryptSensitive(item.contentEnc, config.encryptionKey)
    decryptedDesc.push({ id: item.id, role: item.role as 'user' | 'assistant', content, createdAt: item.createdAt })
    if (!inspectedLatestAssistant && item.role === 'assistant') {
      inspectedLatestAssistant = true
      if (item.toolTraceEnc) {
        try {
          replayToolTrace = parseToolTrace(decryptSensitive(item.toolTraceEnc, config.encryptionKey))
        } catch (traceError) {
          console.warn('[chat-stream] 工具轨迹解密失败，本轮不回放:', traceError instanceof Error ? traceError.message : traceError)
          replayToolTrace = null
        }
      }
    }
    decryptedTokens += estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS
    if (decryptedTokens >= historyBudget) break
  }

  const budgetExceeded = decryptedDesc.length < previousMessages.length || decryptedTokens >= historyBudget
  const decryptedAsc = decryptedDesc.reverse()
  let replayMessages = toHistoryMessages(decryptedAsc)
  let contextSummary = savedSummary
  let summaryUptoAt = savedCursor

  if (budgetExceeded && replayMessages.length && !input.withoutRecord) {
    const plan = planCompaction(replayMessages, historyBudget, input.compactionKeepRatio)
    const boundary = plan.required ? decryptedAsc[decryptedAsc.length - plan.keepMessages.length] : undefined
    if (plan.required && boundary) {
      const compacted = await compactSessionHistory(event, {
        sessionId,
        schoolId: user.schoolId,
        ownerUserId: user.id,
        dataMode,
        summaryUptoAt,
        uptoBeforeAt: boundary.createdAt,
        previousSummary: contextSummary,
        fromAt: input.objectSince
      })
      if (compacted) {
        contextSummary = compacted.summary
        summaryUptoAt = compacted.uptoAt
        replayMessages = toHistoryMessages(decryptedAsc.filter(message => message.createdAt > compacted.uptoAt))
      }
    }
  }

  const effectiveHistoryBudget = Math.max(2000, input.historyBudgetTokens - (contextSummary ? estimateTokens(contextSummary) : 0))
  const historyWindow = selectHistoryWindow(replayMessages, effectiveHistoryBudget)
  const historyWithTrace = historyWindow.selected.map(message => ({ ...message }))
  if (replayToolTrace?.length) {
    for (let index = historyWithTrace.length - 1; index >= 0; index -= 1) {
      if (historyWithTrace[index]!.role === 'assistant') {
        (historyWithTrace[index] as AgentMessage).toolTrace = replayToolTrace
        break
      }
    }
  }
  const history = attachToolTraces(historyWithTrace)
  const outbound = (text: string) => redactOutboundText(text, dataMode)
  const messages: AgentMessage[] = history.map(message => {
    const trace = (message as AgentMessage).toolTrace
    return {
      ...message,
      content: outbound(message.content),
      ...(trace?.length ? { toolTrace: trace.map(step => ({ ...step, content: outbound(step.content) })) } : {})
    }
  })
  return { messages, contextSummary, summaryUptoAt }
}

export interface RunAssistantTurnInput {
  event: H3Event
  user: ChatStreamUser
  sessionId: string
  /** 本轮教师提问原文（未脱敏） */
  message: string
  /** 是否不引入档案 */
  withoutRecord: boolean
  /** 当前会话绑定的咨询对象（已校验归属） */
  businessContext: { type: 'student' | 'class' | 'guardian', id: string, label: string } | null
  /**
   * 本轮对象：教师本轮消息里唯一命中的学生/班级（服务端确定性识别）。
   * 只作用于本轮的记录查询；不改变会话绑定，也不进 system 段（否则每轮前缀都会分叉）。
   */
  turnContext?: { type: 'student' | 'class', id: string, label: string } | null
  /**
   * 会话中途换过咨询对象时的持续提示（由入口按会话元数据生成）：
   * 声明历史消息属于旧对象、当前对象以工具返回为准。有值后每轮都传，保持 system 前缀稳定。
   */
  contextSwitchNote?: string | null
  governance: ChatGovernanceLike
  teacherProfileText?: string
  /** 历史（不含本轮提问，已脱敏） */
  history: AgentMessage[]
  contextSummary: string | null
  lastModuleScores: Record<ModuleId, number>
  /** SSE 事件转发 */
  emit: (name: string, data: unknown) => void
  /** 客户端是否已断开：断开后不再落库、不再发事件，只记一条中断事件 */
  signal?: AbortSignal
  isAborted: () => boolean
}

/**
 * 组合发给模型的业务上下文文本（system 段的一部分）。
 *
 * 三段内容都必须是会话内稳定的：当前咨询对象指针、不带档案说明、会话中途换绑提示。
 * 换绑提示不是「只在本轮出现」——会话一旦换过对象，之后每轮都带同一段文案，
 * 否则 system 前缀会再次分叉（见 server/domain/chat-context-switch.ts）。
 */
export function buildBusinessContextText(input: {
  /** 已按数据模式脱敏的咨询对象指针；教师选择不带档案时为 null */
  recordBinding: { type: 'student' | 'class' | 'guardian', label: string } | null
  /** 本轮教师是否选择不引入档案数据 */
  withoutRecord: boolean
  /** 会话是否绑定过咨询对象（用于区分「未绑定」与「选择不带档案」） */
  hasBinding: boolean
  /** 会话中途换过咨询对象的持续提示 */
  contextSwitchNote?: string | null
}): string | null {
  const bindingText = input.recordBinding
    ? `当前咨询对象：${contextTypeLabel(input.recordBinding.type)}「${input.recordBinding.label}」。涉及该对象的具体事实（基本信息、家长关系、最近沟通、在跟方案与复盘）必须先调用 record_snapshot 工具查询，未查询时不要凭印象描述。`
    : input.hasBinding && input.withoutRecord
      ? '本轮教师选择不引入档案数据：不要查询或引用学生/班级/家长档案细节。'
      : null
  return [bindingText, input.contextSwitchNote]
    .map(item => item?.trim())
    .filter((item): item is string => Boolean(item))
    .join('\n') || null
}

/**
 * 运行一轮「回答先行」回答：装配 system 与消息 → 跑图（流式转发事件）→ 回答校验 →
 * 落库（助手消息、工具轨迹、模块占比、智能标题）→ 写模型调用与工具调用审计。
 *
 * 无产出时抛错，由入口统一转换为 error 事件（不回退其它提示词、不生成兜底回答）。
 */export async function runAssistantTurn(input: RunAssistantTurnInput): Promise<void> {
  const { event, user, sessionId, governance, emit } = input
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  const dataMode = governance.effectiveMode
  const outbound = (text: string) => redactOutboundText(text, dataMode)

  // system 静态化：只放会话内稳定的指针，档案细节由 record_snapshot 工具按需查询
  const recordBinding = input.businessContext && !input.withoutRecord
    ? { type: input.businessContext.type, id: input.businessContext.id, label: outbound(input.businessContext.label) }
    : null
  const contextText = buildBusinessContextText({
    recordBinding,
    withoutRecord: input.withoutRecord,
    hasBinding: Boolean(input.businessContext),
    contextSwitchNote: input.contextSwitchNote
  })
  const knowledgeContext = '知识检索由运行时工具完成：仅当工具返回已发布的资源片段时才可引用并标注来源；未命中时只能基于通用班主任工作方法或工具返回的资源目录回答，不得编造平台手册、量表、SOP、等级、制度、数据或来源。'
  const baseSystemPrompt = await buildAgentSystemPrompt(event, {
    knowledgeContext,
    businessContextText: contextText,
    teacherProfileText: input.teacherProfileText ? outbound(input.teacherProfileText) : input.teacherProfileText
  })
  const systemPrompt = input.contextSummary
    ? `${baseSystemPrompt}\n\n【更早对话摘要】\n${outbound(input.contextSummary)}`
    : baseSystemPrompt

  const userCtx = {
    schoolId: user.schoolId,
    userId: user.id,
    sessionId,
    teachingGrades: user.teachingGrades ?? [],
    businessContextText: contextText,
    businessContext: recordBinding,
    // 本轮对象只在未绑定会话时生效：绑定是教师的显式选择，不能被一句提及改写
    turnContext: recordBinding ? null : (input.turnContext ?? null),
    teacherProfileText: input.teacherProfileText,
    lastModuleScores: input.lastModuleScores,
    dataMode,
    withoutRecord: input.withoutRecord,
    currentQuestion: outbound(input.message),
    signal: input.signal
  }
  const agentMessages: AgentMessage[] = [
    ...sanitizeHistoryForSummary(input.history).map(message => ({ ...message })),
    { role: 'user', content: outbound(input.message) }
  ]

  // 先发 answer_start 创建助手气泡：后续 thinking/tool_call/sources/action_card/answer_delta 都挂到同一气泡
  emit('answer_start', { mode: 'agent' })
  const startedAt = Date.now()
  let firstTextMs: number | null = null
  const delivery = new AnswerDelivery(input.message, text => {
    if (!input.isAborted()) {
      firstTextMs ??= Date.now() - startedAt
      emit('answer_delta', { text })
    }
  }, () => {
    // 有个别句子被扣住、等整轮校验：通知前端在静默超过短暂时间后挂起「正在核对回答依据…」，
    // 后续句子继续流出时前端会自行撤下
    if (!input.isAborted()) emit('thinking', { phase: 'review' })
  })
  const result = await runAgentGraph(event, {
    signal: input.signal,
    messages: agentMessages,
    userCtx,
    systemPrompt,
    onEvent: (eventName: string, data: unknown) => {
      if (input.isAborted()) return
      if (eventName === 'answer_delta') delivery.push(String((data as { text?: string }).text ?? ''))
      else emit(eventName, data)
    }
  })

  // 模型调用审计：每次模型往返一行（只记元数据，不记 Prompt 与正文），失败不阻断回答
  const modelCalls = Array.isArray(result.modelCalls) ? result.modelCalls : []
  if (modelCalls.length) {
    try {
      await db.insert(schema.aiModelCalls).values(modelCalls.map(call => ({
        schoolId: user.schoolId,
        ownerUserId: user.id,
        sessionId,
        provider: 'deepseek',
        model: call.model,
        purpose: 'assistant_chat',
        status: call.status,
        latencyMs: call.latencyMs,
        promptTokens: call.promptTokens ?? null,
        completionTokens: call.completionTokens ?? null,
        cacheHitTokens: call.cacheHitTokens ?? null,
        cacheMissTokens: call.cacheMissTokens ?? null,
        errorCode: call.errorCode ?? null,
        dataMode,
        contextType: input.businessContext?.type ?? null,
        noticeVersion: governance.noticeVersion
      })))
    } catch (auditError) {
      console.warn('[chat-stream] Agent 模型调用审计写入失败:', auditError instanceof Error ? auditError.message : auditError)
    }
  }

  for (const call of result.toolCalls ?? []) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_tool_called',
      targetType: 'chat_session', targetId: sessionId,
      metadata: {
        tool: call.name,
        status: call.status || 'success',
        latencyMs: call.latencyMs ?? 0
      }
    })
  }
  const rawAnswer = typeof result?.answer === 'string' ? result.answer.trim() : ''
  if (!rawAnswer || result.exitReason === 'error' || result.exitReason === 'max_rounds') throw new Error('Agent 无回答产出')

  // 先清理内部标识，再对敏感表述执行证据校验与最多一次修正
  const inspection = inspectAgentAnswer({
    answer: rawAnswer,
    sources: result.sources,
    toolCalls: result.toolCalls
  })
  let answer = inspection.cleaned
  let repaired = false
  const evidence: AnswerEvidence[] = [
    ...teacherEvidence(input.history, outbound(input.message)),
    ...(result.evidence ?? [])
  ]
  if (delivery.requiresReview || needsEvidenceReview(answer) || inspection.violations.includes('secret_like_token')) {
    try {
      const reviewed = await reviewAssistantAnswer(event, { answer, evidence, systemPrompt, signal: input.signal,
        schoolId: user.schoolId, userId: user.id, sessionId })
      answer = reviewed.answer
      repaired = reviewed.repaired
    } catch {
      await trackProductEvent(event, { schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_blocked', metadata: { reason: 'review_failed' } })
      throw new Error('回答校验失败')
    }
  }
  const actionCards = Array.isArray(result.actionCards) ? result.actionCards : []
  const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : []
  const sources = Array.isArray(result.sources) ? result.sources : []

  // 客户端已断开：本轮不落库、不发 answer 事件，只留一条中断记录
  if (input.isAborted()) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_aborted',
      targetType: 'chat_session', targetId: sessionId,
      metadata: { reason: 'client_disconnect', tools: toolCalls.length }
    })
    return
  }

  const serializedTrace = serializeToolTrace(result.toolTrace)
  const [assistantMessage] = await db.insert(schema.chatMessages).values({
    schoolId: user.schoolId, ownerUserId: user.id, sessionId,
    role: 'assistant', contentEnc: encryptSensitive(answer, config.encryptionKey),
    toolTraceEnc: serializedTrace ? encryptSensitive(serializedTrace, config.encryptionKey) : null,
    metadata: {
      type: 'agent_answer',
      actionCards,
      toolCalls,
      sources,
      moduleProportions: result.moduleProportions,
      // 本轮对象只记类型/ID/展示名，用于回看「这次按谁回答」与统计；不含档案正文
      ...(userCtx.turnContext ? { turnObject: { type: userCtx.turnContext.type, id: userCtx.turnContext.id, label: userCtx.turnContext.label } } : {}),
      ...(inspection.violations.length ? { answerViolations: inspection.violations } : {})
    }
  }).returning({ id: schema.chatMessages.id })
  if (!assistantMessage) throw new Error('Agent 回答保存失败')

  // 观测：回答校验命中、工具调用（只记工具名/状态/耗时，不记参数与正文）
  if (inspection.violations.length) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_flagged',
      targetType: 'chat_session', targetId: sessionId,
      metadata: { kinds: inspection.violations.join(','), count: inspection.violations.length }
    })
  }
  if (result.toolConflicts?.length) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_tool_conflict',
      targetType: 'chat_session', targetId: sessionId,
      metadata: { conflicts: result.toolConflicts.join(';') }
    })
  }

  // 把本轮模块评估占比合并写回会话元数据，后续轮次模块评估与回放仍可引用。
  // 必须用 jsonb 合并（||）而不是整块覆盖：元数据里还有咨询对象换绑记录（contextSwitches）等字段。
  if (result.moduleProportions) {
    try {
      await db.update(schema.chatSessions).set({
        metadata: sql`${schema.chatSessions.metadata} || ${JSON.stringify({ moduleScores: result.moduleProportions })}::jsonb`,
        updatedAt: new Date()
      }).where(eq(schema.chatSessions.id, sessionId))
    } catch (metaError) {
      console.warn('[chat-stream] Agent 模块占比状态写回失败:', metaError instanceof Error ? metaError.message : metaError)
    }
  }

  await trackProductEvent(event, { schoolId: user.schoolId, userId: user.id, eventName: 'assistant_turn_completed', metadata: { latencyMs: Date.now() - startedAt, firstTextMs: firstTextMs ?? Date.now() - startedAt, reviewed: delivery.requiresReview, repaired } })
  emit('answer', { messageId: assistantMessage.id, text: answer, mode: 'agent' })

  // 对话推进后提炼简短智能标题（DeepSeek 不可用时降级截断法）
  try {
    const titleInput = [...input.history.filter(item => item.role === 'user').map(item => item.content).slice(-4), input.message]
    const newTitle = (await generateChatTitle(event, titleInput)) ?? buildChatTitle({ messages: titleInput })
    await db.update(schema.chatSessions).set({ title: newTitle, updatedAt: new Date() }).where(eq(schema.chatSessions.id, sessionId))
  } catch (titleError) {
    console.warn('[chat-stream] Agent 标题生成失败:', titleError instanceof Error ? titleError.message : titleError)
  }
}

/** 失败分类（只写审计的粗粒度错误码，不暴露内部错误细节）。 */
export function classifyAgentFailure(error: unknown): string {
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const text = error instanceof Error ? error.message.toLowerCase() : ''
  if (name.includes('abort') || text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (text.includes('无回答产出')) return 'no_output'
  return 'agent_error'
}

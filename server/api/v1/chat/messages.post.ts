import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { judgeClarificationNeeded, routeWithDeepSeek, semanticSafetySignals, streamClarificationRound, streamClarificationSummary } from '../../../integrations/deepseek'
import type { KnowledgeCitation } from '../../../integrations/deepseek'
import { buildAssistantBusinessContext, fetchEntityMemory } from '../../../domain/assistant-context'
import { composeClarificationSummaryHistory, sanitizeHistoryForSummary, topModuleFromScores } from '../../../domain/chat-clarification'
import { runAgentGraph } from '../../../agent/graph'
import { buildAgentSystemPrompt } from '../../../agent/prompts'
import type { AgentMessage, AgentUserContext } from '../../../agent/types'
import { buildChatTitle } from '../../../domain/chat-titles'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { embedModuleResourceQuery } from '../../../integrations/embeddings'
import { searchKnowledgeChunks } from '../../../domain/module-resource-knowledge-search'
import { sendStream } from 'h3'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { moduleMeta } from '../../../../shared/assessments'
import type { ModuleId } from '../../../../shared/contracts'

const CLARIFICATION_DONE_SIGNAL = '[DONE]'
const MAX_CLARIFICATION_ROUNDS = 3

interface ClarificationState {
  phase: 'clarifying' | 'summarizing' | 'done'
  round: number
  moduleScores: Record<string, number>
}

/**
 * runAgentGraph 返回值的入口侧视图（AGENT-A 的 graph.ts 为并行交付，实际返回以该模块为准）。
 * 兼容两种形态：扁平字段（answer/actionCards/fallbackUsed）与 AgentState 风格嵌套（output.answer/output.actionCards）。
 */
interface AgentGraphRunResult {
  answer?: string | null
  actionCards?: unknown
  fallbackUsed?: boolean
  exitReason?: string | null
  toolCalls?: Array<{ name: string; title: string; args: string }>
  sources?: Array<{ chunkId: string; documentTitle: string; heading?: string | null; excerpt?: string; module?: string | null; libraryType?: string }>
  output?: { answer?: string | null, actionCards?: unknown } | null
}

function getClarificationState(sessionMetadata: Record<string, unknown> | null | undefined): ClarificationState | null {
  if (!sessionMetadata) return null
  const cs = sessionMetadata.clarificationState as ClarificationState | undefined
  if (!cs || !cs.phase) return null
  return cs
}

/** 最小教师画像快照：只取业务所需的班主任/学科/任教年级，不含姓名电话等 PII；全空时返回 null 不注入。 */
async function buildTeacherProfileText(db: ReturnType<typeof useDb>, userId: string): Promise<string | null> {
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

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = chatMessageSchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  const teacherProfileText = (await buildTeacherProfileText(db, user.id)) ?? undefined
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  let sessionId = body.sessionId
  let sessionMetadata: Record<string, unknown> = {}
  let businessContext = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  if (sessionId) {
    const [owned] = await db.select({
      id: schema.chatSessions.id,
      status: schema.chatSessions.status,
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId,
      metadata: schema.chatSessions.metadata
    }).from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id))).limit(1)
    if (!owned) throw createError({ statusCode: 404, message: '对话不存在' })
    if (owned.status === 'archived') throw createError({ statusCode: 409, message: '对话已归档' })
    const sessionContextType = owned.contextType === 'none' ? undefined : owned.contextType
    const requestedType = body.contextType
    const requestedId = body.contextId
    if (requestedType && (requestedType !== sessionContextType || requestedId !== owned.contextId)) {
      throw createError({ statusCode: 409, message: '该对话已绑定其他咨询对象，请新建对话后切换对象' })
    }
    sessionMetadata = (owned.metadata as Record<string, unknown>) || {}
    businessContext = await buildAssistantBusinessContext(event, user, sessionContextType, owned.contextId || undefined)
  } else {
    const [session] = await db.insert(schema.chatSessions).values({
      schoolId: user.schoolId,
      ownerUserId: user.id,
      title: buildChatTitle({ messages: [body.message] }),
      contextType: businessContext?.type || 'none',
      contextId: businessContext?.id,
      metadata: { clarificationState: { phase: 'clarifying', round: 0, moduleScores: {} } }
    }).returning()
    if (!session) throw createError({ statusCode: 500, message: '对话创建失败' })
    sessionId = session.id
    sessionMetadata = { clarificationState: { phase: 'clarifying', round: 0, moduleScores: {} } }
  }
  const previousMessages = await db.select({ role: schema.chatMessages.role, contentEnc: schema.chatMessages.contentEnc })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.sessionId, sessionId),
      eq(schema.chatMessages.ownerUserId, user.id),
      // 管理员软删的消息不进入 AI 回放上下文
      isNull(schema.chatMessages.deletedAt)
    ))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(8)
  const history = previousMessages.reverse().flatMap(item => {
    if (item.role !== 'user' && item.role !== 'assistant') return []
    return [{ role: item.role as 'user' | 'assistant', content: decryptSensitive(item.contentEnc, config.encryptionKey) }]
  })

  // 跨会话实体记忆：拉取同一学生/班级/家长在其他会话中的历史对话
  let entityMemory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (businessContext) {
    const rawMemory = await fetchEntityMemory(event, user, businessContext.type, businessContext.id, sessionId, 12)
    entityMemory = rawMemory.map(m => ({ role: m.role, content: m.content }))
  }
  await db.insert(schema.chatMessages).values({
    schoolId: user.schoolId, ownerUserId: user.id, sessionId,
    role: 'user', contentEnc: encryptSensitive(body.message, config.encryptionKey)
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_question_submitted',
    targetType: 'chat_session', targetId: sessionId,
    metadata: { contextType: businessContext?.type || 'none', recordIncluded: Boolean(businessContext && !body.withoutRecord) }
  })
  if (businessContext) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_context_selected',
      targetType: businessContext.type, targetId: businessContext.id,
      metadata: { contextType: businessContext.type, recordIncluded: !body.withoutRecord }
    })
  }

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  const encoder = new TextEncoder()
  const emit = (controller: ReadableStreamDefaultController, name: string, data: unknown) => {
    controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  const ownedSessionId = sessionId
  const clarificationState = getClarificationState(sessionMetadata)

  // Agent「回答先行」灰度开关：AGENT_ENABLED 环境变量 或 runtimeConfig.agentEnabled（NUXT_AGENT_ENABLED 可运行时覆盖）
  const agentEnabled = process.env.AGENT_ENABLED === 'true' || config.agentEnabled === true

  const stream = new ReadableStream({
    async start(controller) {
      // 流式逐字输出（用于追问/总结等非 DeepSeek streaming 分支）
      // 将文本按 2 个字符切块，逐块发送 answer_delta，块间留 15ms 间隔让前端流式渲染
      const emitStreamedAnswer = async (text: string, answerPayload: Record<string, unknown>, mode = 'deepseek') => {
        emit(controller, 'answer_start', { mode })
        const chars = [...text]
        for (let i = 0; i < chars.length; i += 2) {
          emit(controller, 'answer_delta', { text: chars.slice(i, i + 2).join('') })
          await new Promise(r => setTimeout(r, 15))
        }
        emit(controller, 'answer', answerPayload)
      }

      // 知识库检索辅助：embed 用户消息 → pgvector 余弦搜索 → KnowledgeCitation[]
      // embedding 不可用或无结果时降级为 []
      const fetchKnowledgeCitations = async (query: string, module?: ModuleId): Promise<KnowledgeCitation[]> => {
        try {
          const embedding = await embedModuleResourceQuery(event, query)
          if (!embedding || embedding.length === 0) return []
          const results = await searchKnowledgeChunks(db, embedding, { module, minSimilarity: 0.45, limit: 5 })
          return results.map(r => ({
            chunkId: r.chunkId,
            documentTitle: r.documentTitle,
            heading: r.heading,
            excerpt: r.excerpt,
            knowledgeBase: r.libraryType,
            module: r.module as ModuleId,
            libraryType: r.libraryType,
          }))
        } catch {
          return []
        }
      }

      // 澄清总结（isDone / 轮数上限 / 首轮判定无需追问 / 逐轮判定无需追问 四路复用）
      const runClarificationSummary = async (input: {
        history: Array<{ role: 'user' | 'assistant', content: string }>
        citations: KnowledgeCitation[]
        includeCurrentMessage: boolean
        lastModuleScores?: Record<string, number>
      }): Promise<void> => {
        const lastScores = input.lastModuleScores || clarificationState?.moduleScores || {}
        const summaryHistory = composeClarificationSummaryHistory({
          entityMemory,
          history: input.history,
          currentMessage: body.message,
          includeCurrentMessage: input.includeCurrentMessage
        })
        emit(controller, 'answer_start', { mode: 'deepseek' })
        const summary = await streamClarificationSummary(event, {
          schoolId: user.schoolId!,
          ownerUserId: user.id,
          sessionId: ownedSessionId,
          history: summaryHistory,
          citations: input.citations,
          lastModuleScores: lastScores,
          teacherProfileText,
          onDelta: text => emit(controller, 'answer_delta', { text })
        })
        await db.update(schema.chatSessions).set({
          title: buildChatTitle({ messages: [...history.filter((h) => h.role === 'user').map((h) => h.content), body.message] }),
          metadata: { clarificationState: { phase: 'done', round: clarificationState?.round ?? 0, moduleScores: summary.data.moduleProportions } },
          updatedAt: new Date()
        }).where(eq(schema.chatSessions.id, ownedSessionId))
        const summaryText = summary.data.answer
        const [assistantMessage] = await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(summaryText, config.encryptionKey),
          metadata: { type: 'clarification_summary', answer: summary.data.answer, rationale: summary.data.rationale, primaryModule: summary.data.primaryModule, moduleProportions: summary.data.moduleProportions, suggestedActions: summary.data.suggestedActions }
        }).returning({ id: schema.chatMessages.id })
        if (assistantMessage) {
          emit(controller, 'answer', { messageId: assistantMessage.id, text: summaryText, mode: 'deepseek', suggestedActions: summary.data.suggestedActions })
        }
        emit(controller, 'clarification_summary', summary.data)
        emit(controller, 'done', { sessionId: ownedSessionId })
        controller.close()
      }

      // Agent 回退路径：复用澄清总结流程（含全部现有 emit 事件与 controller.close）
      const runAgentFallbackSummary = async () => {
        const citations = await fetchKnowledgeCitations(body.message, topModuleFromScores(clarificationState?.moduleScores))
        await runClarificationSummary({ history, citations, includeCurrentMessage: true, lastModuleScores: clarificationState?.moduleScores })
      }

      // ---- Agent（回答先行）分支：图驱动回答，SSE 事件由 onEvent 原样转发 ----
      const runAgentAnswer = async () => {
        try {
          // 复用已装载上下文：history / businessContext / entityMemory / teacherProfileText
          const businessContextText = businessContext && !body.withoutRecord
            ? `当前咨询对象：${businessContext.type} / ${businessContext.label}\n${businessContext.prompt}`
            : null
          // 知识检索由 Agent 运行时工具完成：模板知识段只承载引用边界，避免与工具检索重复
          const knowledgeContext = '知识检索由运行时工具完成：仅当工具返回已发布的资源片段时才可引用并标注来源；未命中时只能基于通用班主任工作方法回答，不得编造平台手册、量表、SOP、等级、制度、数据或来源。'
          const systemPrompt = await buildAgentSystemPrompt(event, { knowledgeContext, businessContextText, teacherProfileText })
          const userCtx: AgentUserContext = {
            schoolId: user.schoolId!,
            userId: user.id,
            sessionId: ownedSessionId,
            businessContextText,
            entityMemory,
            teacherProfileText,
            lastModuleScores: (clarificationState?.moduleScores ?? {}) as Record<ModuleId, number>
          }
          const agentMessages: AgentMessage[] = [
            ...entityMemory,
            ...sanitizeHistoryForSummary(history),
            { role: 'user', content: body.message }
          ]
          // 先发 answer_start 创建助手气泡：后续 thinking/tool_call/sources/action_card/answer_delta
          // 都能挂到同一气泡上；否则前端要等首个 answer_delta（约 1s 首 token 延迟）才建气泡，
          // 导致工具/引用事件被丢弃、量表卡先于文字出现、出现空白块。
          emit(controller, 'answer_start', { mode: 'agent' })
          const result = await runAgentGraph(event, {
            messages: agentMessages,
            userCtx,
            systemPrompt,
            onEvent: (eventName: string, data: unknown) => emit(controller, eventName, data)
          }) as unknown as AgentGraphRunResult

          if (result?.fallbackUsed === true || result?.exitReason === 'fallback') {
            await runAgentFallbackSummary()
            return
          }
          const answer = (typeof result?.answer === 'string' && result.answer.trim() ? result.answer : '')
            || (typeof result?.output?.answer === 'string' ? result.output.answer : '')
          if (!answer.trim()) throw new Error('Agent 未生成有效回答')
          const actionCards = Array.isArray(result?.actionCards)
            ? result.actionCards
            : (Array.isArray(result?.output?.actionCards) ? result.output!.actionCards : [])
          // 工具调用过程 + 知识库引用来源：随消息持久化，切换会话/刷新后仍可展示
          const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : []
          const sources = Array.isArray(result?.sources) ? result.sources : []
          const [assistantMessage] = await db.insert(schema.chatMessages).values({
            schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
            role: 'assistant', contentEnc: encryptSensitive(answer, config.encryptionKey),
            metadata: { type: 'agent_answer', actionCards, toolCalls, sources }
          }).returning({ id: schema.chatMessages.id })
          if (!assistantMessage) throw new Error('Agent 回答保存失败')
          emit(controller, 'answer', { messageId: assistantMessage.id, text: answer, mode: 'agent' })
          emit(controller, 'done', { sessionId: ownedSessionId })
          controller.close()
        } catch {
          // 图执行/回答保存抛错：回退到现有澄清总结路径（该路径自带 done 事件与 close）
          await runAgentFallbackSummary()
        }
      }

      // 从 clarificationState.moduleScores 中提取最高分模块作为知识检索过滤条件

      try {
        emit(controller, 'ack', {
          sessionId: ownedSessionId,
          context: businessContext ? { type: businessContext.type, id: businessContext.id, label: businessContext.label } : undefined,
          dataGovernance: governance,
          recordIncluded: Boolean(businessContext && !body.withoutRecord)
        })
        const localRules = detectSafetySignals(body.message)
        const matchedRules = localRules.length ? localRules : await semanticSafetySignals(event, body.message, governance.effectiveMode === 'local')
        if (matchedRules.length) {
          const referral = await createSafetyReferral(event, {
            schoolId: user.schoolId!, ownerUserId: user.id, sourceType: 'chat', sourceId: ownedSessionId,
            text: body.message, matchedRules
          })
          emit(controller, 'fuse', {
            eventId: referral.safety.id, referralId: referral.referral.id,
            guide: referral.crisisGuide, message: '检测到需要立即关注的安全信号，常规建议已暂停。'
          })
          emit(controller, 'done', { sessionId: ownedSessionId })
          controller.close()
          return
        }

        // ---- Agent（回答先行）分支：命中安全信号之后、澄清/分诊流程之前 ----
        // 开启后所有消息走 runAgentGraph；图内部 fallback 或异常时回退澄清总结路径
        if (agentEnabled) {
          await runAgentAnswer()
          return
        }

        const isDoneSignal = body.message.trim() === CLARIFICATION_DONE_SIGNAL

        // ---- 追问流程（按需追问）----
        if (clarificationState && clarificationState.phase === 'clarifying') {
          if (isDoneSignal) {
            // 用户表示没有补充了 → 进入总结阶段
            const citations = await fetchKnowledgeCitations(body.message, topModuleFromScores(clarificationState.moduleScores))
            await runClarificationSummary({ history, citations, includeCurrentMessage: false })
            return
          }

          // 追问轮次
          const nextRound = clarificationState.round + 1

          // 达到上限 → 自动进入总结阶段
          if (nextRound > MAX_CLARIFICATION_ROUNDS) {
            const citations = await fetchKnowledgeCitations(body.message, topModuleFromScores(clarificationState.moduleScores))
            await runClarificationSummary({ history, citations, includeCurrentMessage: true })
            return
          }

          const combinedHistory = [...entityMemory, ...history]
          const topModule = topModuleFromScores(clarificationState.moduleScores)
          const citations = await fetchKnowledgeCitations(body.message, topModule)

          // 按需追问（首轮）：先判定信息充分度，足够则跳过追问直接总结
          if (clarificationState.round === 0) {
            const judge = await judgeClarificationNeeded(event, {
              schoolId: user.schoolId!,
              ownerUserId: user.id,
              sessionId: ownedSessionId,
              message: body.message,
              history: combinedHistory
            })
            if (!judge.needClarification) {
              await runClarificationSummary({ history, citations, includeCurrentMessage: true })
              return
            }
          }

          emit(controller, 'answer_start', { mode: 'deepseek' })
          const result = await streamClarificationRound(event, {
            schoolId: user.schoolId!,
            ownerUserId: user.id,
            sessionId: ownedSessionId,
            message: body.message,
            history: combinedHistory,
            citations,
            clarificationRound: nextRound,
            previousModuleScores: clarificationState.moduleScores,
            teacherProfileText,
            onDelta: text => emit(controller, 'answer_delta', { text })
          })

          // 按需追问（每轮自决）：模型表示信息已足够 → 更新评分后直接总结
          if (result.data.needMoreInfo === false) {
            await db.update(schema.chatSessions).set({
              metadata: { clarificationState: { phase: 'summarizing', round: nextRound, moduleScores: result.data.moduleScores } },
              updatedAt: new Date()
            }).where(eq(schema.chatSessions.id, ownedSessionId))
            await runClarificationSummary({ history, citations, includeCurrentMessage: true, lastModuleScores: result.data.moduleScores })
            return
          }

          // 更新会话追问状态
          const newClarificationState: ClarificationState = {
            phase: 'clarifying',
            round: nextRound,
            moduleScores: result.data.moduleScores as Record<string, number>
          }
          await db.update(schema.chatSessions).set({
            metadata: { clarificationState: newClarificationState },
            updatedAt: new Date()
          }).where(eq(schema.chatSessions.id, ownedSessionId))

          // 保存 AI 追问消息
          const clarificationText = `${result.data.question}\n\n选项：${result.data.options.join('、')}`
          const [assistantMessage] = await db.insert(schema.chatMessages).values({
            schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
            role: 'assistant', contentEnc: encryptSensitive(clarificationText, config.encryptionKey),
            metadata: { type: 'clarification_round', round: result.data.round, question: result.data.question, options: result.data.options, moduleScores: result.data.moduleScores, needMoreInfo: result.data.needMoreInfo ?? true }
          }).returning({ id: schema.chatMessages.id })
          if (assistantMessage) {
            emit(controller, 'answer', { messageId: assistantMessage.id, text: result.data.question, mode: 'deepseek' })
          }
          emit(controller, 'clarification_round', result.data)
          emit(controller, 'done', { sessionId: ownedSessionId })
          controller.close()
          return
        }

        // ---- 分诊流程：AI 只推荐模块，不生成工具、方案或知识库引用 ----
        // 回放本会话历史 + 跨会话实体记忆，避免澄清完成后的新消息在模型侧失去上下文
        const route = await routeWithDeepSeek(event, body.message, user.schoolId!, [...entityMemory, ...history])
        const triageMode = governance.effectiveMode === 'local' || !useRuntimeConfig(event).deepseekApiKey ? 'local_fallback' : 'deepseek'

        // 知识库检索：基于用户消息 + 路由确定的模块检索相关文档
        const triageCitations = await fetchKnowledgeCitations(body.message, route.primaryModule)

        const identityText = teacherProfileText ? `您是${teacherProfileText}。` : ''
        const contextText = businessContext && !body.withoutRecord ? `已关联当前对象“${businessContext.label}”。` : '本次分诊未纳入具体学生、班级或家长档案。'
        const prepItems = [
          '准备最近一周或最近一次事件的具体事实。',
          '进入模块后先完成量表，系统会再做规则归因和工具匹配。',
          '若涉及自伤、伤人、虐待、失联等红线，请立即联系校内安全/心理支持。'
        ]
        const moduleTitle = moduleMeta[route.primaryModule]?.title || route.primaryModule
        const knowledgeSuffix = triageCitations.length > 0
          ? ` 以下已发布资源可作参考：${triageCitations.slice(0, 3).map(c => `《${c.documentTitle}》${c.heading ? `"${c.heading}"` : ''}`).join('、')}。`
          : ''
        const answer = `${identityText}${contextText} 我建议先进入「${moduleTitle}」模块完成评估。${route.rationale}${knowledgeSuffix} 进入前请先准备：${prepItems.join('；')}`
        emit(controller, 'answer_start', { mode: triageMode, suggestedActions: [] })
        emit(controller, 'answer_delta', { text: answer })
        const [decision] = await db.insert(schema.routingDecisions).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          primaryModule: route.primaryModule, secondaryModules: route.secondaryModules,
          confidence: Math.round(route.confidence * 100), rationale: route.rationale
        }).returning()
        if (!decision) throw new Error('路由结果保存失败')
        const baseMetadata = {
          type: 'triage_result', decisionId: decision.id, mode: triageMode,
          dataMode: governance.effectiveMode,
          noticeVersion: governance.noticeVersion,
          recordIncluded: Boolean(businessContext && !body.withoutRecord),
          context: businessContext ? { type: businessContext.type, id: businessContext.id, label: businessContext.label } : undefined,
          contextSnapshot: businessContext?.snapshot,
          studentId: businessContext?.type === 'student' ? businessContext.id : undefined,
          classId: businessContext?.type === 'class' ? businessContext.id : undefined,
          guardianId: businessContext?.type === 'guardian' ? businessContext.id : undefined,
          suggestedActions: [{
            label: '进入建议模块完成量表评估',
            type: 'open_module',
            module: route.primaryModule,
            // 带上路由关联的量表编码和教师原话，模块页据此推荐并直接定位到该量表
            instrumentCode: route.suggestedInstrumentCode,
            sourceText: body.message
          }],
          citations: triageCitations.length > 0 ? triageCitations.slice(0, 5) : undefined,
          prepItems,
          route: { primaryModule: route.primaryModule, secondaryModules: route.secondaryModules, confidence: route.confidence, rationale: route.rationale, suggestedInstrumentCode: route.suggestedInstrumentCode, decisionId: decision.id }
        }
        const [assistantMessage] = await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(answer, config.encryptionKey),
          metadata: baseMetadata
        }).returning({ id: schema.chatMessages.id })
        if (!assistantMessage) throw new Error('回答保存失败')
        await db.update(schema.chatSessions).set({ updatedAt: new Date() }).where(eq(schema.chatSessions.id, ownedSessionId))

        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answered',
          targetType: 'chat_message', targetId: assistantMessage.id,
          metadata: { mode: triageMode, dataMode: governance.effectiveMode, purpose: 'triage' }
        })
        emit(controller, 'answer', { messageId: assistantMessage.id, text: answer, mode: triageMode, suggestedActions: baseMetadata.suggestedActions })
        emit(controller, 'route', { id: decision.id, ...route })
        emit(controller, 'done', { sessionId: ownedSessionId })
      } catch (error) {
        const errorName = error instanceof Error ? error.name.toLowerCase() : ''
        const errorText = error instanceof Error ? error.message.toLowerCase() : ''
        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_failed',
          targetType: 'chat_session', targetId: ownedSessionId,
          metadata: { category: errorName.includes('abort') || errorText.includes('timeout') ? 'timeout' : 'other' }
        })
        emit(controller, 'error', { message: error instanceof Error ? error.message : '处理失败' })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })
  return sendStream(event, stream)
})

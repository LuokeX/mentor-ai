import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { routeWithDeepSeek, semanticSafetySignals, streamClarificationRound, streamClarificationSummary } from '../../../integrations/deepseek'
import type { KnowledgeCitation } from '../../../integrations/deepseek'
import { buildAssistantBusinessContext, fetchEntityMemory } from '../../../domain/assistant-context'
import { composeClarificationSummaryHistory, topModuleFromScores } from '../../../domain/chat-clarification'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { embedModuleResourceQuery } from '../../../integrations/ollama'
import { searchKnowledgeChunks } from '../../../domain/module-resource-knowledge-search'
import { sendStream } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { moduleMeta } from '../../../../shared/assessments'
import type { ModuleId } from '../../../../shared/contracts'

const CLARIFICATION_DONE_SIGNAL = '[DONE]'
const MAX_CLARIFICATION_ROUNDS = 3

interface ClarificationState {
  phase: 'clarifying' | 'summarizing' | 'done'
  round: number
  moduleScores: Record<string, number>
}

function getClarificationState(sessionMetadata: Record<string, unknown> | null | undefined): ClarificationState | null {
  if (!sessionMetadata) return null
  const cs = sessionMetadata.clarificationState as ClarificationState | undefined
  if (!cs || !cs.phase) return null
  return cs
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = chatMessageSchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  let sessionId = body.sessionId
  let sessionMetadata: Record<string, unknown> = {}
  let businessContext = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  if (sessionId) {
    const [owned] = await db.select({
      id: schema.chatSessions.id,
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId,
      metadata: schema.chatSessions.metadata
    }).from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id))).limit(1)
    if (!owned) throw createError({ statusCode: 404, message: '对话不存在' })
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
      title: body.message.slice(0, 40),
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
    .where(and(eq(schema.chatMessages.sessionId, sessionId), eq(schema.chatMessages.ownerUserId, user.id)))
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
          const results = await searchKnowledgeChunks(db, embedding, { module, minSimilarity: 0.65, limit: 5 })
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

        const isDoneSignal = body.message.trim() === CLARIFICATION_DONE_SIGNAL

        // ---- 追问流程 ----
        if (clarificationState && clarificationState.phase === 'clarifying') {
          if (isDoneSignal) {
            // 用户表示没有补充了 → 进入总结阶段
            const combinedHistory = composeClarificationSummaryHistory({
              entityMemory,
              history,
              currentMessage: body.message,
              includeCurrentMessage: false
            })
            const topModule = topModuleFromScores(clarificationState.moduleScores)
            const citations = await fetchKnowledgeCitations(body.message, topModule)
            emit(controller, 'answer_start', { mode: 'deepseek' })
            const summary = await streamClarificationSummary(event, {
              schoolId: user.schoolId!,
              ownerUserId: user.id,
              sessionId: ownedSessionId,
              history: combinedHistory,
              citations,
              lastModuleScores: clarificationState.moduleScores,
              onDelta: text => emit(controller, 'answer_delta', { text })
            })
            await db.update(schema.chatSessions).set({
              metadata: { clarificationState: { phase: 'done', round: clarificationState.round, moduleScores: summary.data.moduleProportions } },
              updatedAt: new Date()
            }).where(eq(schema.chatSessions.id, ownedSessionId))

            // 保存总结消息
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
            return
          }

          // 追问轮次
          const nextRound = clarificationState.round + 1

          // 达到上限 → 自动进入总结阶段
          if (nextRound > MAX_CLARIFICATION_ROUNDS) {
            const combinedHistory = composeClarificationSummaryHistory({
              entityMemory,
              history,
              currentMessage: body.message,
              includeCurrentMessage: true
            })
            const topModule = topModuleFromScores(clarificationState.moduleScores)
            const citations = await fetchKnowledgeCitations(body.message, topModule)
            emit(controller, 'answer_start', { mode: 'deepseek' })
            const summary = await streamClarificationSummary(event, {
              schoolId: user.schoolId!,
              ownerUserId: user.id,
              sessionId: ownedSessionId,
              history: combinedHistory,
              citations,
              lastModuleScores: clarificationState.moduleScores,
              onDelta: text => emit(controller, 'answer_delta', { text })
            })
            await db.update(schema.chatSessions).set({
              metadata: { clarificationState: { phase: 'done', round: clarificationState.round, moduleScores: summary.data.moduleProportions } },
              updatedAt: new Date()
            }).where(eq(schema.chatSessions.id, ownedSessionId))

            const [assistantMessage] = await db.insert(schema.chatMessages).values({
              schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
              role: 'assistant', contentEnc: encryptSensitive(summary.data.answer, config.encryptionKey),
              metadata: { type: 'clarification_summary', answer: summary.data.answer, rationale: summary.data.rationale, primaryModule: summary.data.primaryModule, moduleProportions: summary.data.moduleProportions, suggestedActions: summary.data.suggestedActions }
            }).returning({ id: schema.chatMessages.id })
            if (assistantMessage) {
              emit(controller, 'answer', { messageId: assistantMessage.id, text: summary.data.answer, mode: 'deepseek', suggestedActions: summary.data.suggestedActions })
            }
            emit(controller, 'clarification_summary', summary.data)
            emit(controller, 'done', { sessionId: ownedSessionId })
            controller.close()
            return
          }

          const combinedHistory = [...entityMemory, ...history]
          const topModule = topModuleFromScores(clarificationState.moduleScores)
          const citations = await fetchKnowledgeCitations(body.message, topModule)
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
            onDelta: text => emit(controller, 'answer_delta', { text })
          })

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
            metadata: { type: 'clarification_round', round: result.data.round, question: result.data.question, options: result.data.options, moduleScores: result.data.moduleScores }
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
        const route = await routeWithDeepSeek(event, body.message, user.schoolId!)
        const triageMode = governance.effectiveMode === 'local' || !useRuntimeConfig(event).deepseekApiKey ? 'local_fallback' : 'deepseek'

        // 知识库检索：基于用户消息 + 路由确定的模块检索相关文档
        const triageCitations = await fetchKnowledgeCitations(body.message, route.primaryModule)

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
        const answer = `${contextText} 我建议先进入「${moduleTitle}」模块完成评估。${route.rationale}${knowledgeSuffix} 进入前请先准备：${prepItems.join('；')}`
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

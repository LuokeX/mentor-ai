import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { semanticSafetySignals, streamAssistantResponse, extractPlanUpdates } from '../../../integrations/deepseek'
import { buildKnowledgeRetrievalQuery, retrieveKnowledge } from '../../../domain/knowledge'
import { buildAssistantBusinessContext, fetchEntityMemory } from '../../../domain/assistant-context'
import { governBusinessContext, resolveAiGovernance } from '../../../domain/ai-governance'
import { ensurePlanActions } from '../../../domain/plan-actions'
import { trackProductEvent } from '../../../domain/product-events'
import { sendStream } from 'h3'
import { and, desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = chatMessageSchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  let sessionId = body.sessionId
  let businessContext = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  if (sessionId) {
    const [owned] = await db.select({
      id: schema.chatSessions.id,
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId
    }).from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id))).limit(1)
    if (!owned) throw createError({ statusCode: 404, message: '对话不存在' })
    const sessionContextType = owned.contextType === 'none' ? undefined : owned.contextType
    const requestedType = body.contextType
    const requestedId = body.contextId
    if (requestedType && (requestedType !== sessionContextType || requestedId !== owned.contextId)) {
      throw createError({ statusCode: 409, message: '该对话已绑定其他咨询对象，请新建对话后切换对象' })
    }
    businessContext = await buildAssistantBusinessContext(event, user, sessionContextType, owned.contextId || undefined)
  } else {
    const [session] = await db.insert(schema.chatSessions).values({
      schoolId: user.schoolId,
      ownerUserId: user.id,
      title: body.message.slice(0, 40),
      contextType: businessContext?.type || 'none',
      contextId: businessContext?.id
    }).returning()
    if (!session) throw createError({ statusCode: 500, message: '对话创建失败' })
    sessionId = session.id
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
  const stream = new ReadableStream({
    async start(controller) {
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
        const knowledgeQuery = buildKnowledgeRetrievalQuery(body.message, history)
        const citations = await retrieveKnowledge(event, user.schoolId!, knowledgeQuery)
        const modelContext = body.withoutRecord ? null : governBusinessContext(businessContext, governance.effectiveMode)
        emit(controller, 'answer_start', { mode: governance.effectiveMode === 'local' || !useRuntimeConfig(event).deepseekApiKey ? 'local_fallback' : 'deepseek', suggestedActions: [] })
        const assistant = await streamAssistantResponse(event, {
          schoolId: user.schoolId!,
          ownerUserId: user.id,
          sessionId: ownedSessionId,
          message: body.message,
          history: [...entityMemory, ...history],
          citations,
          businessContext: modelContext,
          dataMode: governance.effectiveMode === 'full_context' ? 'full_context' : 'redacted',
          contextType: businessContext?.type,
          noticeVersion: governance.noticeVersion,
          forceLocal: governance.effectiveMode === 'local',
          onDelta: text => emit(controller, 'answer_delta', { text })
        })
        const route = assistant.route
        const [decision] = await db.insert(schema.routingDecisions).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          primaryModule: route.primaryModule, secondaryModules: route.secondaryModules,
          confidence: Math.round(route.confidence * 100), rationale: route.rationale
        }).returning()
        if (!decision) throw new Error('路由结果保存失败')
        const selectedSources = citations.filter(item => assistant.citationIds.includes(item.chunkId))
        const baseMetadata = {
          type: 'assistant_answer', decisionId: decision.id, mode: assistant.mode,
          dataMode: governance.effectiveMode,
          noticeVersion: governance.noticeVersion,
          recordIncluded: Boolean(businessContext && !body.withoutRecord),
          context: businessContext ? { type: businessContext.type, id: businessContext.id, label: businessContext.label } : undefined,
          contextSnapshot: businessContext?.snapshot,
          studentId: businessContext?.type === 'student' ? businessContext.id : undefined,
          classId: businessContext?.type === 'class' ? businessContext.id : undefined,
          guardianId: businessContext?.type === 'guardian' ? businessContext.id : undefined,
          citationIds: assistant.citationIds, suggestedActions: assistant.suggestedActions,
          sources: selectedSources.map(item => ({
            chunkId: item.chunkId, documentTitle: item.documentTitle,
            heading: item.heading, knowledgeBase: item.knowledgeBase
          })),
          route: { primaryModule: route.primaryModule, secondaryModules: route.secondaryModules, confidence: route.confidence, rationale: route.rationale, decisionId: decision.id }
        }
        const [assistantMessage] = await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(assistant.answer, config.encryptionKey),
          metadata: baseMetadata
        }).returning({ id: schema.chatMessages.id })
        if (!assistantMessage) throw new Error('回答保存失败')
        await db.update(schema.chatSessions).set({ updatedAt: new Date() }).where(eq(schema.chatSessions.id, ownedSessionId))

        // 模型只能提出方案更新建议；必须由教师调用确认接口后才会写入。
        const planUpdateSuggestions: Array<Record<string, unknown>> = []
        if (businessContext && assistant.mode === 'deepseek') {
          try {
            const extracted = await extractPlanUpdates(event, assistant.answer, modelContext, {
              schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
              dataMode: governance.effectiveMode, contextType: businessContext.type, noticeVersion: governance.noticeVersion
            })
            for (const update of extracted) {
              const recentPlans = Array.isArray(businessContext.snapshot.recentPlans)
                ? businessContext.snapshot.recentPlans as Array<{ id?: string, title?: string }> : []
              const referencedPlan = recentPlans.find(item => item.id && item.title && (
                item.title.includes(update.planTitle) || update.planTitle.includes(item.title)
              ))
              if (!referencedPlan?.id) continue
              const actions = await ensurePlanActions(event, referencedPlan.id, user.id)
              const action = update.actionTitle
                ? actions.find(item => item.title.includes(update.actionTitle!) || update.actionTitle!.includes(item.title))
                : undefined
              if (!action && !update.progressNote) continue
              planUpdateSuggestions.push({ ...update, planId: referencedPlan.id, actionId: action?.id, actionTitle: action?.title || update.actionTitle })
            }
            if (planUpdateSuggestions.length) {
              await db.update(schema.chatMessages).set({
                metadata: { ...baseMetadata, planUpdateSuggestions }
              }).where(eq(schema.chatMessages.id, assistantMessage.id))
              emit(controller, 'plan_update_suggestions', { messageId: assistantMessage.id, suggestions: planUpdateSuggestions })
            }
          } catch {
            // 建议提取失败不影响主要回答，也绝不能回退为自动写回。
          }
        }

        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answered',
          targetType: 'chat_message', targetId: assistantMessage.id,
          metadata: { mode: assistant.mode, dataMode: governance.effectiveMode, hasSources: selectedSources.length > 0 }
        })
        emit(controller, 'answer', { messageId: assistantMessage.id, text: assistant.answer, mode: assistant.mode, suggestedActions: assistant.suggestedActions })
        if (selectedSources.length) emit(controller, 'sources', selectedSources)
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

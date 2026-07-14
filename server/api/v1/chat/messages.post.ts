import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { generateAssistantResponse, semanticSafetySignals } from '../../../integrations/deepseek'
import { retrieveKnowledge } from '../../../domain/knowledge'
import { sendStream } from 'h3'
import { and, desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = chatMessageSchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  let sessionId = body.sessionId
  if (sessionId) {
    const [owned] = await db.select({ id: schema.chatSessions.id }).from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id))).limit(1)
    if (!owned) throw createError({ statusCode: 404, message: '对话不存在' })
  } else {
    const [session] = await db.insert(schema.chatSessions).values({
      schoolId: user.schoolId, ownerUserId: user.id, title: body.message.slice(0, 40)
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
  await db.insert(schema.chatMessages).values({
    schoolId: user.schoolId, ownerUserId: user.id, sessionId,
    role: 'user', contentEnc: encryptSensitive(body.message, config.encryptionKey)
  })

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
        emit(controller, 'ack', { sessionId: ownedSessionId })
        const localRules = detectSafetySignals(body.message)
        const matchedRules = localRules.length ? localRules : await semanticSafetySignals(event, body.message)
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
        const citations = await retrieveKnowledge(event, user.schoolId!, body.message)
        const assistant = await generateAssistantResponse(event, {
          schoolId: user.schoolId!,
          ownerUserId: user.id,
          sessionId: ownedSessionId,
          message: body.message,
          history,
          citations
        })
        const route = assistant.route
        const [decision] = await db.insert(schema.routingDecisions).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          primaryModule: route.primaryModule, secondaryModules: route.secondaryModules,
          confidence: Math.round(route.confidence * 100), rationale: route.rationale
        }).returning()
        if (!decision) throw new Error('路由结果保存失败')
        const selectedSources = citations.filter(item => assistant.citationIds.includes(item.chunkId))
        await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(assistant.answer, config.encryptionKey),
          metadata: {
            type: 'assistant_answer', decisionId: decision.id, mode: assistant.mode,
            citationIds: assistant.citationIds, suggestedActions: assistant.suggestedActions,
            sources: selectedSources.map(item => ({
              chunkId: item.chunkId, documentTitle: item.documentTitle,
              heading: item.heading, knowledgeBase: item.knowledgeBase
            }))
          }
        })
        await db.update(schema.chatSessions).set({ updatedAt: new Date() }).where(eq(schema.chatSessions.id, ownedSessionId))
        emit(controller, 'answer', { text: assistant.answer, mode: assistant.mode, suggestedActions: assistant.suggestedActions })
        if (selectedSources.length) emit(controller, 'sources', selectedSources)
        emit(controller, 'route', { id: decision.id, ...route })
        emit(controller, 'done', { sessionId: ownedSessionId })
      } catch (error) {
        emit(controller, 'error', { message: error instanceof Error ? error.message : '处理失败' })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })
  return sendStream(event, stream)
})

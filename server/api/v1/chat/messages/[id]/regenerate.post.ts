import { z } from 'zod'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { sendStream } from 'h3'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { decryptSensitive } from '../../../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../../../domain/safety'
import { buildAssistantBusinessContext } from '../../../../../domain/assistant-context'
import { resolveAiGovernance } from '../../../../../domain/ai-governance'
import { buildContextSwitchNote, readContextSwitches } from '../../../../../domain/chat-context-switch'
import { trackProductEvent } from '../../../../../domain/product-events'
import {
  buildTeacherProfileText,
  classifyAgentFailure,
  getSessionModuleScores,
  loadChatSessionContext,
  loadSessionHistoryForAgent,
  runAssistantTurn
} from '../../../../../domain/chat-stream'
import type { ModuleId } from '../../../../../../shared/contracts'

/** 重新生成时模型不可用的教师侧提示。 */
const AGENT_UNAVAILABLE_MESSAGE = 'AI 助手暂时不可用，请稍后重试。'

/** 本地数据模式提示。 */
const AI_LOCAL_MODE_MESSAGE = '当前学校设置为本地模式，AI 助手不向外部模型发送数据，暂时无法回答。'

const bodySchema = z.object({
  withoutRecord: z.boolean().optional()
})

/**
 * 重新生成一条助手回答。
 *
 * 语义：复用该回答之前的那条教师提问，把旧回答软删（chat_messages.deleted_at）后重跑一轮。
 * 为什么不删物理记录：消息属于业务档案的一部分，历史回看与审计需要保留，
 * 而装载历史时本来就过滤 deletedAt，因此软删即可让新一轮的上下文正确。
 *
 * 事件流与普通提问完全一致（ack → answer_start → … → answer → done），前端因此可以复用同一套 SSE 消费逻辑。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const messageId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse((await readBody(event).catch(() => ({}))) || {})

  const db = useDb(event)
  const config = useRuntimeConfig(event)

  const [target] = await db.select({
    id: schema.chatMessages.id,
    sessionId: schema.chatMessages.sessionId,
    createdAt: schema.chatMessages.createdAt
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.schoolId, user.schoolId),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.role, 'assistant'),
      isNull(schema.chatMessages.deletedAt)
    ))
    .limit(1)
  if (!target) throw createError({ statusCode: 404, message: '回答不存在' })

  const sessionId = target.sessionId
  const sessionContext = await loadChatSessionContext(event, { id: user.id, schoolId: user.schoolId }, sessionId)
  if (!sessionContext) throw createError({ statusCode: 404, message: '对话不存在' })

  const [session] = await db.select({
    status: schema.chatSessions.status,
    contextType: schema.chatSessions.contextType,
    contextId: schema.chatSessions.contextId
  }).from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id)))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })
  if (session.status === 'archived') throw createError({ statusCode: 409, message: '对话已归档，无法重新生成' })

  // 该回答对应的教师提问：同会话中时间早于该回答的最近一条用户消息
  const [question] = await db.select({
    id: schema.chatMessages.id,
    contentEnc: schema.chatMessages.contentEnc
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.sessionId, sessionId),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.role, 'user'),
      isNull(schema.chatMessages.deletedAt),
      lt(schema.chatMessages.createdAt, target.createdAt)
    ))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(1)
  if (!question) throw createError({ statusCode: 409, message: '找不到这条回答对应的提问，无法重新生成' })

  const questionText = (() => {
    try {
      return decryptSensitive(question.contentEnc, config.encryptionKey)
    } catch (error) {
      console.warn('[chat] 重新生成时提问解密失败:', error instanceof Error ? error.message : error)
      return ''
    }
  })()
  if (!questionText) throw createError({ statusCode: 409, message: '提问内容不可用，无法重新生成' })

  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  const businessContext = await buildAssistantBusinessContext(
    event,
    user,
    session.contextType === 'none' ? undefined : session.contextType,
    session.contextId || undefined
  )
  const teacherProfileText = await buildTeacherProfileText(event, user.id) ?? undefined
  const lastModuleScores = getSessionModuleScores(sessionContext.metadata) as Record<ModuleId, number>

  // 软删旧回答：装载历史与后续界面都不再包含它
  await db.update(schema.chatMessages)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(schema.chatMessages.id, target.id),
      eq(schema.chatMessages.ownerUserId, user.id)
    ))

  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_regenerated',
    targetType: 'chat_session', targetId: sessionId,
    metadata: { previousMessageId: target.id }
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

  let aborted = false
  const markAborted = () => { aborted = true }
  event.node.res.on('close', markAborted)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        emit(controller, 'ack', {
          sessionId,
          context: businessContext ? { type: businessContext.type, id: businessContext.id, label: businessContext.label } : undefined,
          dataGovernance: governance,
          recordIncluded: Boolean(businessContext && !body.withoutRecord),
          regenerated: true
        })

        // 安全兜底：原提问在上一轮已通过检查，这里仍用本地规则复查一次（确定性、零成本），
        // 不做语义模型复查，避免重新生成时多一次外部调用。
        const matchedRules = detectSafetySignals(questionText)
        if (matchedRules.length) {
          const referral = await createSafetyReferral(event, {
            schoolId: user.schoolId!, ownerUserId: user.id, sourceType: 'chat', sourceId: sessionId,
            text: questionText, matchedRules
          })
          emit(controller, 'fuse', {
            eventId: referral.safety.id, referralId: referral.referral.id,
            guide: referral.crisisGuide,
            helpPhone: referral.helpPhone,
            ackMinutes: referral.ackMinutes,
            escalationMinutes: referral.escalationMinutes,
            psychologistAssigned: referral.psychologistAssigned,
            message: '检测到需要重点关注的安全信号，常规建议已暂停。'
          })
          emit(controller, 'done', { sessionId })
          return
        }

        if (governance.effectiveMode === 'local') {
          emit(controller, 'error', { message: AI_LOCAL_MODE_MESSAGE })
          emit(controller, 'done', { sessionId })
          return
        }

        const history = await loadSessionHistoryForAgent({
          event,
          user: { id: user.id, schoolId: user.schoolId! },
          sessionId,
          contextSummary: sessionContext.contextSummary,
          summaryUptoAt: sessionContext.summaryUptoAt,
          historyBudgetTokens: Number(config.agentHistoryTokenBudget) || 24000,
          compactionKeepRatio: Number(config.agentCompactionKeepRatio) || 0.5,
          dataMode: governance.effectiveMode
        })

        await runAssistantTurn({
          event,
          user: { id: user.id, schoolId: user.schoolId! },
          sessionId,
          message: questionText,
          withoutRecord: Boolean(body.withoutRecord),
          businessContext: businessContext
            ? { type: businessContext.type, id: businessContext.id, label: businessContext.label }
            : null,
          // 会话换绑过对象时沿用同一段提示（与普通提问口径一致，保持 system 前缀稳定）
          contextSwitchNote: buildContextSwitchNote(readContextSwitches(sessionContext.metadata)),
          governance,
          teacherProfileText,
          history: history.messages,
          contextSummary: history.contextSummary,
          lastModuleScores,
          emit: (name, data) => emit(controller, name, data),
          isAborted: () => aborted
        })
        emit(controller, 'done', { sessionId })
      } catch (error) {
        console.error('[chat] 重新生成失败:', error instanceof Error ? error.message : error)
        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_failed',
          targetType: 'chat_session', targetId: sessionId,
          metadata: { category: classifyAgentFailure(error), phase: 'regenerate' }
        })
        if (!aborted) emit(controller, 'error', { message: AGENT_UNAVAILABLE_MESSAGE })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
    cancel() {
      markAborted()
    }
  })
  return sendStream(event, stream)
})

import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { semanticSafetySignals } from '../../../integrations/deepseek'
import { buildAssistantBusinessContext } from '../../../domain/assistant-context'
import {
  appendContextSwitch,
  buildContextSwitchNote,
  readContextLabel,
  readContextSwitches,
  toContextRef
} from '../../../domain/chat-context-switch'
import { buildChatTitle } from '../../../domain/chat-titles'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { sendStream } from 'h3'
import { and, eq } from 'drizzle-orm'
import type { ModuleId } from '../../../../shared/contracts'
import {
  buildTeacherProfileText,
  classifyAgentFailure,
  getSessionModuleScores,
  loadChatSessionContext,
  loadSessionHistoryForAgent,
  runAssistantTurn,
  type ChatSessionContext
} from '../../../domain/chat-stream'

/** Agent 自动重试后仍无产出时的教师侧提示（不暴露内部错误）。 */
const AGENT_UNAVAILABLE_MESSAGE = 'AI 助手暂时不可用，请稍后重试。'

/** 学校数据模式为 local 时的教师侧提示：本地模式不向外部模型发送任何数据。 */
const AI_LOCAL_MODE_MESSAGE = '当前学校设置为本地模式，AI 助手不向外部模型发送数据，暂时无法回答。'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = chatMessageSchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  const teacherProfileText = (await buildTeacherProfileText(event, user.id)) ?? undefined
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  let sessionId = body.sessionId
  /** 本轮请求显式指定的咨询对象（已完成归属校验）；会话分支据此判断是否需要换绑。 */
  const requestedBusinessContext = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  let businessContext = requestedBusinessContext
  /** 会话中途换过咨询对象时的持续提示（换绑后每轮都带同一段文案，保持 system 前缀稳定）。 */
  let contextSwitchNote: string | null = null
  /** 会话上下文（元数据 + 加密摘要）：新会话时为 null。 */
  let sessionContext: ChatSessionContext | null = null

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
    const boundId = owned.contextId || undefined
    // 会话内 @ 换对象：保留既有消息（不新建会话），只把会话绑定改到新对象并在元数据里留痕
    const switching = Boolean(requestedBusinessContext
      && (requestedBusinessContext.type !== sessionContextType || requestedBusinessContext.id !== boundId))
    if (switching && requestedBusinessContext) {
      await db.update(schema.chatSessions).set({
        contextType: requestedBusinessContext.type,
        contextId: requestedBusinessContext.id,
        metadata: appendContextSwitch(owned.metadata, {
          at: new Date().toISOString(),
          from: toContextRef(sessionContextType, boundId, readContextLabel(owned.metadata)),
          to: {
            type: requestedBusinessContext.type,
            id: requestedBusinessContext.id,
            label: requestedBusinessContext.label
          }
        })
      }).where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.ownerUserId, user.id)))
      await trackProductEvent(event, {
        schoolId: user.schoolId, userId: user.id, eventName: 'assistant_context_switched',
        targetType: requestedBusinessContext.type, targetId: requestedBusinessContext.id,
        metadata: { fromType: sessionContextType || 'none', fromId: boundId || null }
      })
    } else {
      // 未指定对象（或指定同一对象）时沿用会话绑定，避免前端不传参就丢掉会话上下文
      businessContext = requestedBusinessContext
        || await buildAssistantBusinessContext(event, user, sessionContextType, boundId)
    }
    sessionContext = await loadChatSessionContext(event, { id: user.id, schoolId: user.schoolId }, sessionId)
    contextSwitchNote = buildContextSwitchNote(readContextSwitches(sessionContext?.metadata))
  } else {
    const [session] = await db.insert(schema.chatSessions).values({
      schoolId: user.schoolId,
      ownerUserId: user.id,
      title: buildChatTitle({ messages: [body.message] }),
      contextType: businessContext?.type || 'none',
      contextId: businessContext?.id,
      // contextLabel 供会话列表与后续换绑引用旧对象名（历史会话可能缺失）
      metadata: { moduleScores: {}, contextLabel: businessContext?.label || null }
    }).returning()
    if (!session) throw createError({ statusCode: 500, message: '对话创建失败' })
    sessionId = session.id
    sessionContext = null
  }

  const ownedSessionId = sessionId
  const lastModuleScores = getSessionModuleScores(sessionContext?.metadata) as Record<ModuleId, number>
  const historyBudgetTokens = Number(config.agentHistoryTokenBudget) || 24000
  const compactionKeepRatio = Number(config.agentCompactionKeepRatio) || 0.5

  await db.insert(schema.chatMessages).values({
    schoolId: user.schoolId, ownerUserId: user.id, sessionId: ownedSessionId,
    role: 'user', contentEnc: encryptSensitive(body.message, config.encryptionKey)
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_question_submitted',
    targetType: 'chat_session', targetId: ownedSessionId,
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

  /** 客户端断开标记：断开后不再落库、不再发事件（由 stream.cancel 与响应 close 两处设置）。 */
  let aborted = false
  const markAborted = () => { aborted = true }
  event.node.res.on('close', markAborted)

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
        // 语义补充的失败元数据进 ai_model_calls（以前完全静默）：带上学校/教师/会话便于排查
        const matchedRules = localRules.length ? localRules : await semanticSafetySignals(
          event,
          body.message,
          governance.effectiveMode === 'local',
          { schoolId: user.schoolId, ownerUserId: user.id, sessionId: ownedSessionId }
        )
        if (matchedRules.length) {
          const referral = await createSafetyReferral(event, {
            schoolId: user.schoolId!, ownerUserId: user.id, sourceType: 'chat', sourceId: ownedSessionId,
            text: body.message, matchedRules
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
          emit(controller, 'done', { sessionId: ownedSessionId })
          return
        }

        // 本地模式：安全规则已在上面本地执行；不向外部模型发送任何数据
        if (governance.effectiveMode === 'local') {
          emit(controller, 'error', { message: AI_LOCAL_MODE_MESSAGE })
          emit(controller, 'done', { sessionId: ownedSessionId })
          return
        }

        // 历史装载（含超预算压缩与最近一轮工具轨迹回放）：放在本地模式判断之后，避免本地模式白跑一次数据库读与模型调用
        const history = await loadSessionHistoryForAgent({
          event,
          user: { id: user.id, schoolId: user.schoolId! },
          sessionId: ownedSessionId,
          contextSummary: sessionContext?.contextSummary ?? null,
          summaryUptoAt: sessionContext?.summaryUptoAt ?? null,
          historyBudgetTokens,
          compactionKeepRatio,
          dataMode: governance.effectiveMode
        })

        await runAssistantTurn({
          event,
          user: { id: user.id, schoolId: user.schoolId! },
          sessionId: ownedSessionId,
          message: body.message,
          withoutRecord: Boolean(body.withoutRecord),
          businessContext: businessContext
            ? { type: businessContext.type, id: businessContext.id, label: businessContext.label }
            : null,
          contextSwitchNote,
          governance,
          teacherProfileText,
          history: history.messages,
          contextSummary: history.contextSummary,
          lastModuleScores,
          emit: (name, data) => emit(controller, name, data),
          isAborted: () => aborted
        })
        emit(controller, 'done', { sessionId: ownedSessionId })
      } catch (error) {
        console.error('[chat] Agent 回答失败:', error instanceof Error ? error.message : error)
        const errorName = error instanceof Error ? error.name.toLowerCase() : ''
        const errorText = error instanceof Error ? error.message.toLowerCase() : ''
        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: 'assistant_answer_failed',
          targetType: 'chat_session', targetId: ownedSessionId,
          metadata: { category: errorName.includes('abort') || errorText.includes('timeout') ? 'timeout' : 'other' }
        })
        // 失败也记一行审计：便于在 AI 中心区分「无产出」与超时/网络故障
        try {
          await db.insert(schema.aiModelCalls).values({
            schoolId: user.schoolId,
            ownerUserId: user.id,
            sessionId: ownedSessionId,
            provider: 'deepseek',
            model: String(config.deepseekGeneratorModel || 'unknown'),
            purpose: 'assistant_chat',
            status: 'failed',
            errorCode: classifyAgentFailure(error),
            dataMode: governance.effectiveMode,
            contextType: businessContext?.type ?? null,
            noticeVersion: governance.noticeVersion
          })
        } catch { /* 审计写入失败不影响错误返回 */ }
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

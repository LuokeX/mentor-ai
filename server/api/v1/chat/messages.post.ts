import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { confirmedSemanticSafetySignals } from '../../../integrations/deepseek'
import { decideEntryObjectUse, resolveMentionedObject, type MentionResolution } from '../../../domain/assistant-object-mention'
import { buildAssistantBusinessContext } from '../../../domain/assistant-context'
import {
  buildContextSwitchNote,
  readContextSwitches
} from '../../../domain/chat-context-switch'
import { buildChatTitle } from '../../../domain/chat-titles'
import { bindChatSessionContext } from '../../../domain/chat-session-binding'
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
      await bindChatSessionContext(event, {
        sessionId,
        userId: user.id,
        schoolId: user.schoolId,
        target: {
          type: requestedBusinessContext.type,
          id: requestedBusinessContext.id,
          label: requestedBusinessContext.label
        },
        current: owned
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

  const [question] = await db.insert(schema.chatMessages).values({
    schoolId: user.schoolId, ownerUserId: user.id, sessionId: ownedSessionId,
    role: 'user', contentEnc: encryptSensitive(body.message, config.encryptionKey)
  }).returning({ id: schema.chatMessages.id, createdAt: schema.chatMessages.createdAt })
  if (!question) throw createError({ statusCode: 500, message: '提问保存失败' })
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

  // 本轮识别：会话未绑定对象时作为「本轮对象」；已绑定对象时只提示是否切换（两种情况都要先识别）
  const mention = body.withoutRecord || governance.effectiveMode === 'local'
    ? ({ kind: 'none' } as MentionResolution)
    : await resolveMentionedObject(event, { id: user.id, schoolId: user.schoolId }, body.message)
  const objectUse = decideEntryObjectUse({ binding: businessContext ?? null, mention })
  const turnContext = objectUse.turnContext
  if (mention.kind !== 'none') {
    const firstHit = mention.kind === 'single' ? mention.object : mention.candidates[0]
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_turn_object_resolved',
      targetType: 'chat_session', targetId: ownedSessionId,
      metadata: {
        result: mention.kind,
        objectType: firstHit?.type ?? null,
        // 只记命中数量、类型与用途，不记姓名或正文
        candidates: mention.kind === 'ambiguous' ? mention.candidates.length : 1,
        turnScoped: Boolean(objectUse.turnContext),
        switchSuggested: Boolean(objectUse.suggestedSwitch)
      }
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
  const abortController = new AbortController()
  let aborted = false
  const markAborted = () => { aborted = true; abortController.abort() }
  event.node.res.on('close', markAborted)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        emit(controller, 'ack', {
          sessionId: ownedSessionId,
          // 本条提问的消息 id：前端据此定位并删除这条消息
          userMessageId: question.id,
          context: businessContext ? { type: businessContext.type, id: businessContext.id, label: businessContext.label } : undefined,
          // 本轮对象（未绑定会话时按消息识别）：前端据此显示「本次按 X 回答」与「固定为本会话对象」
          turnObject: turnContext ? { type: turnContext.type, id: turnContext.id, label: turnContext.label } : undefined,
          turnObjectCandidates: objectUse.candidates.length
            ? objectUse.candidates.map(item => ({ type: item.type, id: item.id, label: item.label }))
            : undefined,
          // 会话已绑定对象、本轮又提到另一个唯一对象：提示是否切换，不自动切换
          suggestedContext: objectUse.suggestedSwitch
            ? { type: objectUse.suggestedSwitch.type, id: objectUse.suggestedSwitch.id, label: objectUse.suggestedSwitch.label }
            : undefined,
          dataGovernance: governance,
          recordIncluded: Boolean(businessContext && !body.withoutRecord)
        })
        // 聊天链路的安全命中只做后台预警：建风险事件 + 转介 + 通知 + 审计，
        // 不中断本轮回答、教师端不显示任何预警痕迹（2026-09-17 业务确认）。
        const localRules = detectSafetySignals(body.message)
        const semantic = localRules.length
          ? null
          : await confirmedSemanticSafetySignals(
            event,
            body.message,
            governance.effectiveMode === 'local',
            { schoolId: user.schoolId, ownerUserId: user.id, sessionId: ownedSessionId }
          )
        const matchedRules = localRules.length ? localRules : semantic?.matchedRules ?? []
        if (matchedRules.length) {
          await createSafetyReferral(event, {
            schoolId: user.schoolId!, ownerUserId: user.id, sourceType: 'chat', sourceId: ownedSessionId,
            text: body.message, matchedRules
          })
          await trackProductEvent(event, {
            schoolId: user.schoolId, userId: user.id, eventName: 'assistant_safety_alert_issued',
            targetType: 'chat_session', targetId: ownedSessionId,
            metadata: {
              rules: matchedRules.join(','),
              source: localRules.length ? 'local_rules' : 'semantic',
              review: semantic?.review ?? 'none'
            }
          })
        }

        // 本地模式：安全规则已在上面本地执行；不向外部模型发送任何数据
        if (governance.effectiveMode === 'local') {
          emit(controller, 'error', { message: AI_LOCAL_MODE_MESSAGE })
          emit(controller, 'done', { sessionId: ownedSessionId })
          return
        }

        // 历史装载（含超预算压缩与最近一轮工具轨迹回放）：放在本地模式判断之后，避免本地模式白跑一次数据库读与模型调用
        const switchAt = readContextSwitches(sessionContext?.metadata).at(-1)?.at
        const history = await loadSessionHistoryForAgent({
          before: question.createdAt,
          objectSince: switchAt ? new Date(switchAt) : undefined,
          withoutRecord: Boolean(body.withoutRecord),
          event,
          user: { id: user.id, schoolId: user.schoolId!, teachingGrades: user.teachingGrades },
          sessionId: ownedSessionId,
          contextSummary: sessionContext?.contextSummary ?? null,
          summaryUptoAt: sessionContext?.summaryUptoAt ?? null,
          historyBudgetTokens,
          compactionKeepRatio,
          dataMode: governance.effectiveMode
        })

        await runAssistantTurn({
          event,
          user: { id: user.id, schoolId: user.schoolId!, teachingGrades: user.teachingGrades },
          sessionId: ownedSessionId,
          message: body.message,
          withoutRecord: Boolean(body.withoutRecord),
          businessContext: businessContext
            ? { type: businessContext.type, id: businessContext.id, label: businessContext.label }
            : null,
          turnContext: turnContext
            ? { type: turnContext.type, id: turnContext.id, label: turnContext.label }
            : null,
          contextSwitchNote,
          governance,
          teacherProfileText,
          history: history.messages,
          contextSummary: history.contextSummary,
          lastModuleScores,
          emit: (name, data) => emit(controller, name, data),
          signal: abortController.signal,
          isAborted: () => aborted
        })
        emit(controller, 'done', { sessionId: ownedSessionId })
      } catch (error) {
        console.error('[chat] Agent 回答失败:', error instanceof Error ? error.message : error)
        const errorName = error instanceof Error ? error.name.toLowerCase() : ''
        const errorText = error instanceof Error ? error.message.toLowerCase() : ''
        await trackProductEvent(event, {
          schoolId: user.schoolId, userId: user.id, eventName: aborted ? 'assistant_answer_aborted' : 'assistant_answer_failed',
          targetType: 'chat_session', targetId: ownedSessionId,
          metadata: { qualityVersion: 1, category: errorName.includes('abort') || errorText.includes('timeout') ? 'timeout' : 'other' }
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

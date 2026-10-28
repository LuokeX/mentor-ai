import { randomUUID } from 'node:crypto'
import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { confirmedSemanticSafetySignals } from '../../../integrations/deepseek'
import { decideEntryObjectUse, resolveMentionedObjects, type MentionResolution } from '../../../domain/assistant-object-mention'
import { resolveAssistantContextRefs, type AssistantContextRef } from '../../../domain/assistant-context'
import {
  buildContextSwitchNote,
  readContextSwitches
} from '../../../domain/chat-context-switch'
import { isSameContextSet, loadSessionContexts } from '../../../domain/chat-session-contexts'
import { buildChatTitle } from '../../../domain/chat-titles'
import { bindChatSessionContext } from '../../../domain/chat-session-binding'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import {
  CEND_POINT_COSTS,
  activeMembership,
  grantTaskReward,
  recordActivity,
  refundPoints,
  reservePoints,
  settlePointsTx
} from '../../../domain/cend-points'
import { isCendSchool } from '../../../domain/cend-school'
import { trackProductEvent } from '../../../domain/product-events'
import { classifyQuestionCategory } from '../../../domain/question-category'
import { sendStream } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
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
  const mode = body.mode ?? 'chat'
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  const teacherProfileText = (await buildTeacherProfileText(event, user.id)) ?? undefined
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  let sessionId = body.sessionId
  /**
   * 本轮请求显式指定的咨询对象集（主对象在前；单对象写法 contextType/contextId 等价于一项）。
   * 已完成归属校验：任一对象越权都会在解析时抛 404。
   */
  const requestedContexts = await resolveAssistantContextRefs(
    event,
    user,
    body.contexts?.length
      ? body.contexts
      : (body.contextType && body.contextId ? [{ type: body.contextType, id: body.contextId }] : [])
  )
  /** 本轮实际生效的咨询对象集（未指定时沿用会话绑定；主对象在最前）。 */
  let businessContexts: AssistantContextRef[] = requestedContexts
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
    // 会话内 @ 换对象集：保留既有消息（不新建会话），只把会话绑定改成新的一组并在元数据里留痕
    const previous = await loadSessionContexts(event, sessionId, owned)
    const switching = requestedContexts.length > 0 && !isSameContextSet(previous, requestedContexts)
    if (switching) {
      await bindChatSessionContext(event, {
        sessionId,
        userId: user.id,
        schoolId: user.schoolId,
        targets: requestedContexts,
        current: owned
      })
      businessContexts = requestedContexts
    } else if (requestedContexts.length) {
      businessContexts = requestedContexts
    } else {
      // 未指定对象时沿用会话绑定，避免前端不传参就丢掉会话上下文；
      // 走一次归属解析以拿到有效展示名（对象被删除/越权时与原逻辑一致地抛 404）
      businessContexts = await resolveAssistantContextRefs(
        event,
        user,
        previous.map(item => ({ type: item.type, id: item.id }))
      )
    }
    sessionContext = await loadChatSessionContext(event, { id: user.id, schoolId: user.schoolId }, sessionId)
    contextSwitchNote = buildContextSwitchNote(readContextSwitches(sessionContext?.metadata))
  } else {
    // 新会话：主对象写列、其余写关联表（同一事务），与中途换绑共用同一套数据模型
    const related = businessContexts.slice(1)
    const session = await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.chatSessions).values({
        schoolId: user.schoolId!,
        ownerUserId: user.id,
        title: buildChatTitle({ messages: [body.message] }),
        contextType: businessContexts[0]?.type || 'none',
        contextId: businessContexts[0]?.id,
        // contextLabel 供会话列表与后续换绑引用旧对象名（历史会话可能缺失）
        metadata: { moduleScores: {}, contextLabel: businessContexts[0]?.label || null }
      }).returning()
      if (!created) return null
      if (related.length) {
        await tx.insert(schema.chatSessionObjects).values(related.map((item, index) => ({
          sessionId: created.id,
          schoolId: user.schoolId!,
          objectType: item.type,
          objectId: item.id,
          label: item.label,
          position: index
        })))
      }
      return created
    })
    if (!session) throw createError({ statusCode: 500, message: '对话创建失败' })
    sessionId = session.id
    sessionContext = null
  }

  const ownedSessionId = sessionId
  const lastModuleScores = getSessionModuleScores(sessionContext?.metadata) as Record<ModuleId, number>
  const historyBudgetTokens = Number(config.agentHistoryTokenBudget) || 24000
  const compactionKeepRatio = Number(config.agentCompactionKeepRatio) || 0.5

  // C 端：非会员先冻结本次问答积分；会员免扣。学校租户用户不参与积分。
  const questionId = randomUUID()
  const isCendContext = await isCendSchool(db, user.schoolId)
  let chargeId: string | null = null
  if (isCendContext) {
    const membership = await activeMembership(db, user.id)
    if (!membership) {
      const reserved = await reservePoints(db, {
        userId: user.id,
        amount: CEND_POINT_COSTS.aiQuestion,
        type: 'ai_question',
        idempotencyKey: `chat:${questionId}`,
        referenceType: 'chat_message',
        referenceId: questionId
      })
      if (!reserved.ok) {
        throw createError({
          statusCode: 402,
          statusMessage: 'POINTS_INSUFFICIENT',
          message: `积分不足，本次问答需要 ${CEND_POINT_COSTS.aiQuestion} 积分`,
          data: { required: CEND_POINT_COSTS.aiQuestion, balance: reserved.balance }
        })
      }
      chargeId = reserved.transaction.id
    }
  }

  let question: { id: string, createdAt: Date } | undefined
  try {
    ;[question] = await db.insert(schema.chatMessages).values({
      id: questionId,
      schoolId: user.schoolId, ownerUserId: user.id, sessionId: ownedSessionId,
      role: 'user', contentEnc: encryptSensitive(body.message, config.encryptionKey),
      // 模式随提问落库：重新生成时按同一种模式重跑，历史消息也能看出这轮是备课还是问答
      metadata: { mode }
    }).returning({ id: schema.chatMessages.id, createdAt: schema.chatMessages.createdAt })
  } catch (error) {
    if (chargeId) await refundPoints(db, chargeId, '提问保存失败，积分退回').catch(() => undefined)
    throw error
  }
  if (!question) throw createError({ statusCode: 500, message: '提问保存失败' })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_question_submitted',
    targetType: 'chat_session', targetId: ownedSessionId,
    metadata: {
      mode,
      contextType: businessContexts[0]?.type || 'none',
      contextCount: businessContexts.length,
      recordIncluded: Boolean(businessContexts.length && !body.withoutRecord)
    }
  })
  if (businessContexts.length) {
    const primary = businessContexts[0]!
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_context_selected',
      targetType: primary.type, targetId: primary.id,
      metadata: { contextType: primary.type, contextCount: businessContexts.length, recordIncluded: !body.withoutRecord }
    })
  }

  // 本轮识别：会话未绑定对象时作为「本轮对象」；已绑定对象时只提示是否切换（两种情况都要先识别）
  const mention = body.withoutRecord || governance.effectiveMode === 'local'
    ? ({ kind: 'none' } as MentionResolution)
    : await resolveMentionedObjects(event, { id: user.id, schoolId: user.schoolId }, body.message)
  const objectUse = decideEntryObjectUse({ binding: businessContexts, mention })
  const turnContexts = objectUse.turnObjects
  // 本轮对象记进教师提问的元数据（jsonb 合并，不覆盖其它键）：转存教师原话时同样能预填关联对象
  if (turnContexts.length) {
    const patch = {
      turnObjects: turnContexts.map(item => ({ type: item.type, id: item.id, label: item.label })),
      turnObject: { type: turnContexts[0]!.type, id: turnContexts[0]!.id, label: turnContexts[0]!.label }
    }
    await db.update(schema.chatMessages)
      .set({ metadata: sql`${schema.chatMessages.metadata} || ${JSON.stringify(patch)}::jsonb` })
      .where(and(eq(schema.chatMessages.id, question.id), eq(schema.chatMessages.ownerUserId, user.id)))
  }
  if (mention.kind !== 'none') {
    const firstHit = mention.objects[0] ?? mention.candidates[0]
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'assistant_turn_object_resolved',
      targetType: 'chat_session', targetId: ownedSessionId,
      metadata: {
        result: mention.kind,
        objectType: firstHit?.type ?? null,
        // 只记命中数量、类型与用途，不记姓名或正文
        resolvedCount: mention.objects.length,
        candidates: mention.candidates.length,
        turnScoped: turnContexts.length > 0,
        switchSuggested: objectUse.suggestedSwitch.length > 0
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
  let answerEmitted = false
  const markAborted = () => { aborted = true; abortController.abort() }
  event.node.res.on('close', markAborted)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        emit(controller, 'ack', {
          sessionId: ownedSessionId,
          // 本轮模式：前端据此在助手气泡上标注「备课」或恢复标签状态
          mode,
          // 本条提问的消息 id：前端据此定位并删除这条消息
          userMessageId: question.id,
          // context/turnObject 保留为主对象别名（兼容现有渲染）；contexts/turnObjects 为完整对象集
          context: businessContexts[0]
            ? { type: businessContexts[0].type, id: businessContexts[0].id, label: businessContexts[0].label }
            : undefined,
          contexts: businessContexts.length
            ? businessContexts.map(item => ({ type: item.type, id: item.id, label: item.label }))
            : undefined,
          // 本轮对象（未绑定会话时按消息识别，可多名）：前端据此显示「本次按 X 回答」与「固定为本会话对象」
          turnObject: turnContexts[0]
            ? { type: turnContexts[0].type, id: turnContexts[0].id, label: turnContexts[0].label }
            : undefined,
          turnObjects: turnContexts.length
            ? turnContexts.map(item => ({ type: item.type, id: item.id, label: item.label }))
            : undefined,
          turnObjectCandidates: objectUse.candidates.length
            ? objectUse.candidates.map(item => ({ type: item.type, id: item.id, label: item.label }))
            : undefined,
          // 会话已绑定对象、本轮又提到不同的一组对象：提示是否整组切换，不自动切换
          suggestedContext: objectUse.suggestedSwitch[0]
            ? {
                type: objectUse.suggestedSwitch[0].type,
                id: objectUse.suggestedSwitch[0].id,
                label: objectUse.suggestedSwitch[0].label
              }
            : undefined,
          suggestedContexts: objectUse.suggestedSwitch.length
            ? objectUse.suggestedSwitch.map(item => ({ type: item.type, id: item.id, label: item.label }))
            : undefined,
          dataGovernance: governance,
          recordIncluded: Boolean(businessContexts.length && !body.withoutRecord)
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

        // 提问分类与关键词落库（看板 W2/W3 口径）：与回答生成并行执行，不 await、不阻塞 SSE，
        // 失败只影响分类、不影响回答。必须在这里传入提问明文（body.message 仍在作用域内）——
        // 提问正文是加密列，分类与关键词只能在入口明文仍可用时落库。
        // 本地模式已在上面早退，走到这里必然可以外发，因此 localMode 传 false（规则未命中才调模型）。
        void classifyQuestionCategory(event, {
          messageId: question.id,
          text: body.message,
          schoolId: user.schoolId!,
          ownerUserId: user.id,
          sessionId: ownedSessionId,
          localMode: false
        }).catch(() => {})

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
          mode,
          withoutRecord: Boolean(body.withoutRecord),
          businessContexts,
          turnContexts,
          contextSwitchNote,
          governance,
          teacherProfileText,
          history: history.messages,
          contextSummary: history.contextSummary,
          lastModuleScores,
          emit: (name, data) => {
            if (name === 'answer' || name === 'answer_delta') answerEmitted = true
            emit(controller, name, data)
          },
          signal: abortController.signal,
          isAborted: () => aborted
        })
        if (isCendContext) {
          if (chargeId && answerEmitted && !aborted) {
            await settlePointsTx(db, chargeId).catch(() => undefined)
          } else if (chargeId) {
            await refundPoints(db, chargeId, aborted ? '用户中断，积分退回' : '回答为空，积分退回').catch(() => undefined)
          }
          if (!aborted) {
            await grantTaskReward(db, user.id, 'first_question').catch(() => undefined)
            await recordActivity(db, user.id).catch(() => undefined)
          }
        }
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
            // 多对象时只记主对象类型（审计与看板仍按主对象口径）
            contextType: businessContexts[0]?.type ?? null,
            noticeVersion: governance.noticeVersion
          })
        } catch { /* 审计写入失败不影响错误返回 */ }
        if (chargeId) {
          await refundPoints(db, chargeId, aborted ? '用户中断，积分退回' : '回答失败，积分退回').catch(() => undefined)
        }
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

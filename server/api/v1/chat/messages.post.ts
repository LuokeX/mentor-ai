import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { semanticSafetySignals, generateChatTitle } from '../../../integrations/deepseek'
import { buildAssistantBusinessContext, fetchEntityMemory } from '../../../domain/assistant-context'
import { sanitizeHistoryForSummary } from '../../../domain/chat-clarification'
import { runAgentGraph } from '../../../agent/graph'
import { buildAgentSystemPrompt } from '../../../agent/prompts'
import type { AgentMessage, AgentUserContext } from '../../../agent/types'
import { buildChatTitle } from '../../../domain/chat-titles'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { sendStream } from 'h3'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ModuleId } from '../../../../shared/contracts'

/** Agent 自动重试后仍无产出时的教师侧提示（不暴露内部错误）。 */
const AGENT_UNAVAILABLE_MESSAGE = 'AI 助手暂时不可用，请稍后重试。'

/** 读取会话内模块评估占比；兼容历史会话（旧结构在 metadata.clarificationState.moduleScores）。 */
function getSessionModuleScores(metadata: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!metadata) return {}
  const direct = metadata.moduleScores
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, number>
  const legacy = (metadata.clarificationState as { moduleScores?: Record<string, number> } | undefined)?.moduleScores
  return legacy && typeof legacy === 'object' ? legacy : {}
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
    // 一个会话始终只绑定一个咨询对象；切换对象由前端新建会话完成，此处校验不允许直接换绑
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
      metadata: { moduleScores: {} }
    }).returning()
    if (!session) throw createError({ statusCode: 500, message: '对话创建失败' })
    sessionId = session.id
    sessionMetadata = { moduleScores: {} }
  }
  const lastModuleScores = getSessionModuleScores(sessionMetadata) as Record<ModuleId, number>
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

  const stream = new ReadableStream({
    async start(controller) {
      // ---- Agent（回答先行）：所有消息走图驱动回答，SSE 事件由 onEvent 原样转发 ----
      const runAgentAnswer = async (): Promise<void> => {
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
          lastModuleScores
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
        })
        // 图内已自动重试（含传输层重试）；仍无产出时不落库、不回退其它提示词，由外层发 error 事件
        const answer = typeof result?.answer === 'string' ? result.answer.trim() : ''
        if (!answer) throw new Error('Agent 无回答产出')
        // 工具调用过程 + 知识库引用来源：随消息持久化，切换会话/刷新后仍可展示
        const actionCards = Array.isArray(result.actionCards) ? result.actionCards : []
        const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : []
        const sources = Array.isArray(result.sources) ? result.sources : []
        const [assistantMessage] = await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(answer, config.encryptionKey),
          metadata: { type: 'agent_answer', actionCards, toolCalls, sources, moduleProportions: result.moduleProportions }
        }).returning({ id: schema.chatMessages.id })
        if (!assistantMessage) throw new Error('Agent 回答保存失败')
        // 把本轮模块评估占比写回会话，后续轮次模块评估与回放仍可引用
        if (result.moduleProportions) {
          try {
            await db.update(schema.chatSessions).set({
              metadata: { moduleScores: result.moduleProportions },
              updatedAt: new Date()
            }).where(eq(schema.chatSessions.id, ownedSessionId))
          } catch (metaError) {
            // 会话状态更新为次要写入，失败不影响本轮回答主流程
            console.warn('[chat] Agent 模块占比状态写回失败:', metaError instanceof Error ? metaError.message : metaError)
          }
        }
        emit(controller, 'answer', { messageId: assistantMessage.id, text: answer, mode: 'agent' })
        // 对话推进后提炼简短智能标题（DeepSeek 不可用时降级截断法）
        try {
          const titleInput = [...history.filter((h) => h.role === 'user').map((h) => h.content), body.message]
          const newTitle = (await generateChatTitle(event, titleInput)) ?? buildChatTitle({ messages: titleInput })
          await db.update(schema.chatSessions).set({ title: newTitle, updatedAt: new Date() }).where(eq(schema.chatSessions.id, ownedSessionId))
        } catch (titleError) {
          console.warn('[chat] Agent 标题生成失败:', titleError instanceof Error ? titleError.message : titleError)
        }
      }

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
          return
        }

        await runAgentAnswer()
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
        emit(controller, 'error', { message: AGENT_UNAVAILABLE_MESSAGE })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })
  return sendStream(event, stream)
})

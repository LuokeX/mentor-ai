import { chatMessageSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive, encryptSensitive } from '../../../utils/crypto'
import { detectSafetySignals, createSafetyReferral } from '../../../domain/safety'
import { semanticSafetySignals, generateChatTitle } from '../../../integrations/deepseek'
import { buildAssistantBusinessContext } from '../../../domain/assistant-context'
import { sanitizeHistoryForSummary } from '../../../domain/chat-clarification'
import { MESSAGE_OVERHEAD_TOKENS, estimateTokens, selectHistoryWindow, toHistoryMessages } from '../../../domain/chat-history'
import { runAgentGraph } from '../../../agent/graph'
import { buildAgentSystemPrompt } from '../../../agent/prompts'
import type { AgentMessage, AgentUserContext } from '../../../agent/types'
import { buildChatTitle } from '../../../domain/chat-titles'
import { redactOutboundText, resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { sendStream } from 'h3'
import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import type { ModuleId } from '../../../../shared/contracts'
import { compactSessionHistory, planCompaction } from '../../../domain/chat-compaction'
import { attachToolTraces, parseToolTrace, serializeToolTrace } from '../../../agent/tool-trace'
import type { AgentToolTraceStep } from '../../../agent/types'

/** Agent 自动重试后仍无产出时的教师侧提示（不暴露内部错误）。 */
const AGENT_UNAVAILABLE_MESSAGE = 'AI 助手暂时不可用，请稍后重试。'

/** 历史装载的安全上限（仅防异常长会话全表读入；实际裁剪由 token 预算决定）。 */
const HISTORY_ROW_SAFETY_LIMIT = 400

/** 学校数据模式为 local 时的教师侧提示：本地模式不向外部模型发送任何数据。 */
const AI_LOCAL_MODE_MESSAGE = '当前学校设置为本地模式，AI 助手不向外部模型发送数据，暂时无法回答。'

/** 失败分类（只写审计的粗粒度错误码，不暴露内部错误细节）。 */
function classifyAgentFailure(error: unknown): string {
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const text = error instanceof Error ? error.message.toLowerCase() : ''
  if (name.includes('abort') || text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (text.includes('无回答产出')) return 'no_output'
  return 'agent_error'
}

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
  /** 会话历史摘要（P2）：非空时覆盖到 summaryUptoAt 为止的消息，不再回放原文。 */
  let contextSummary: string | null = null
  let summaryUptoAt: Date | null = null
  let businessContext = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  if (sessionId) {
    const [owned] = await db.select({
      id: schema.chatSessions.id,
      status: schema.chatSessions.status,
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId,
      metadata: schema.chatSessions.metadata,
      contextSummaryEnc: schema.chatSessions.contextSummaryEnc,
      contextSummaryUptoAt: schema.chatSessions.contextSummaryUptoAt
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
    summaryUptoAt = owned.contextSummaryUptoAt ?? null
    if (owned.contextSummaryEnc) {
      try {
        contextSummary = decryptSensitive(owned.contextSummaryEnc, config.encryptionKey)
      } catch (summaryError) {
        console.warn('[chat] 会话摘要解密失败，本轮忽略摘要:', summaryError instanceof Error ? summaryError.message : summaryError)
        contextSummary = null
        summaryUptoAt = null
      }
    }
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
  // 历史装载（P1 + P2）：按 token 预算保留尾部，不做条数滑窗；
  // 超出预算时先审一次「低频大块压缩」（把更旧的一段并进加密摘要），失败则退化为整块丢弃。
  const historyBudgetTokens = Number(config.agentHistoryTokenBudget) || 24000
  const summaryBudgetTokens = contextSummary ? estimateTokens(contextSummary) : 0
  const historyBudget = Math.max(2000, historyBudgetTokens - summaryBudgetTokens)
  const historyConditions = [
    eq(schema.chatMessages.sessionId, sessionId),
    eq(schema.chatMessages.ownerUserId, user.id),
    // 管理员软删的消息不进入 AI 回放上下文
    isNull(schema.chatMessages.deletedAt)
  ]
  // 摘要已覆盖的部分不再回放原文（含边界消息，宁可重复一次也不丢）
  if (summaryUptoAt) historyConditions.push(gte(schema.chatMessages.createdAt, summaryUptoAt))
  const previousMessages = await db.select({
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    toolTraceEnc: schema.chatMessages.toolTraceEnc,
    createdAt: schema.chatMessages.createdAt
  })
    .from(schema.chatMessages)
    .where(and(...historyConditions))
    .orderBy(desc(schema.chatMessages.createdAt))
    // 安全上限：只用于防止异常长会话把整表读进内存；实际裁剪由 token 预算决定
    .limit(HISTORY_ROW_SAFETY_LIMIT)
  // 倒序增量解密：预算已满足且再往前只会更旧时停止，避免整会话全量解密
  const decryptedDesc: Array<{ role: 'user' | 'assistant', content: string, createdAt: Date }> = []
  let decryptedTokens = 0
  /** P3：只回放最近一轮的工具轨迹（越旧的轨迹对缓存命中的边际价值越低，且会持续抬高输入） */
  let replayToolTrace: AgentToolTraceStep[] | null = null
  for (const item of previousMessages) {
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const content = decryptSensitive(item.contentEnc, config.encryptionKey)
    decryptedDesc.push({ role: item.role as 'user' | 'assistant', content, createdAt: item.createdAt })
    if (!replayToolTrace && item.role === 'assistant' && item.toolTraceEnc) {
      try {
        replayToolTrace = parseToolTrace(decryptSensitive(item.toolTraceEnc, config.encryptionKey))
      } catch (traceError) {
        console.warn('[chat] 工具轨迹解密失败，本轮不回放:', traceError instanceof Error ? traceError.message : traceError)
        replayToolTrace = null
      }
    }
    decryptedTokens += estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS
    if (decryptedTokens >= historyBudget) break
  }
  // 还有更早的消息没进本次读取 → 已超出预算，先尝试压缩
  const budgetExceeded = decryptedDesc.length < previousMessages.length || decryptedTokens >= historyBudget
  const decryptedAsc = decryptedDesc.reverse()
  let replayMessages = toHistoryMessages(decryptedAsc)
  if (budgetExceeded && replayMessages.length) {
    const plan = planCompaction(replayMessages, historyBudget, Number(config.agentCompactionKeepRatio) || 0.5)
    const boundary = plan.required ? decryptedAsc[decryptedAsc.length - plan.keepMessages.length] : undefined
    if (plan.required && boundary) {
      const compacted = await compactSessionHistory(event, {
        sessionId: sessionId!,
        schoolId: user.schoolId,
        ownerUserId: user.id,
        dataMode: governance.effectiveMode,
        summaryUptoAt,
        uptoBeforeAt: boundary.createdAt,
        previousSummary: contextSummary
      })
      if (compacted) {
        contextSummary = compacted.summary
        summaryUptoAt = compacted.uptoAt
        // 压缩后保留边界之后的原文；摘要本身占用的预算在下面重新扣除
        replayMessages = plan.keepMessages
      }
    }
  }
  const effectiveHistoryBudget = Math.max(2000, historyBudgetTokens - (contextSummary ? estimateTokens(contextSummary) : 0))
  const historyWindow = selectHistoryWindow(replayMessages, effectiveHistoryBudget)
  // P3：把最近一轮的工具轨迹挂到它所属的教师提问上，让本轮请求序列与上一轮保持一致
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
        // 外发脱敏：full_context 原样发送，redacted 过 redactPii（确定性纯函数，不影响前缀缓存）
        const dataMode = governance.effectiveMode
        const outbound = (text: string) => redactOutboundText(text, dataMode)
        // system 静态化（P1）：只放会话内稳定的指针，档案细节改由 record_snapshot 工具按需查询，
        // 避免把每轮重新查询的档案快照放在前缀最前面导致整段缓存失效。
        const recordBinding = businessContext && !body.withoutRecord
          ? { type: businessContext.type, id: businessContext.id, label: outbound(businessContext.label) }
          : null
        const businessContextText = recordBinding
          ? `当前咨询对象：${recordBinding.type === 'student' ? '学生' : recordBinding.type === 'class' ? '班级' : '家长'}「${recordBinding.label}」。涉及该对象的具体事实（基本信息、家长关系、最近沟通、在跟方案与复盘）必须先调用 record_snapshot 工具查询，未查询时不要凭印象描述。`
          : businessContext && body.withoutRecord
            ? '本轮教师选择不引入档案数据：不要查询或引用学生/班级/家长档案细节。'
            : null
        // 知识检索由 Agent 运行时工具完成：模板知识段只承载引用边界，避免与工具检索重复
        const knowledgeContext = '知识检索由运行时工具完成：仅当工具返回已发布的资源片段时才可引用并标注来源；未命中时只能基于通用班主任工作方法回答，不得编造平台手册、量表、SOP、等级、制度、数据或来源。'
        const baseSystemPrompt = await buildAgentSystemPrompt(event, {
          knowledgeContext,
          businessContextText,
          teacherProfileText: teacherProfileText ? outbound(teacherProfileText) : teacherProfileText
        })
        // P2 压缩：摘要拼在 system 末尾（内容只在压缩时变化，属于允许的前缀断裂点）
        const systemPrompt = contextSummary
          ? `${baseSystemPrompt}\n\n【更早对话摘要】\n${outbound(contextSummary)}`
          : baseSystemPrompt
        const userCtx: AgentUserContext = {
          schoolId: user.schoolId!,
          userId: user.id,
          sessionId: ownedSessionId,
          businessContextText,
          businessContext: recordBinding,
          teacherProfileText,
          lastModuleScores,
          dataMode
        }
        // 只追加前缀：实体记忆不再自动前置（改由 entity_memory 工具按需读取），
        // 历史只做确定性清洗，不做条数截断；P3 的工具轨迹随所属提问一并保留。
        const agentMessages: AgentMessage[] = [
          ...sanitizeHistoryForSummary(history).map(message => {
            const trace = (message as AgentMessage).toolTrace
            return {
              role: message.role,
              content: outbound(message.content),
              ...(trace?.length
                ? { toolTrace: trace.map(step => ({ ...step, content: outbound(step.content) })) }
                : {})
            }
          }),
          { role: 'user', content: outbound(body.message) }
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
        // 模型调用审计：每次模型往返一行（只记元数据，不记 Prompt 与正文），失败不阻断回答
        const modelCalls = Array.isArray(result.modelCalls) ? result.modelCalls : []
        if (modelCalls.length) {
          try {
            await db.insert(schema.aiModelCalls).values(modelCalls.map(call => ({
              schoolId: user.schoolId,
              ownerUserId: user.id,
              sessionId: ownedSessionId,
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
              dataMode: governance.effectiveMode,
              contextType: businessContext?.type ?? null,
              noticeVersion: governance.noticeVersion
            })))
          } catch (auditError) {
            console.warn('[chat] Agent 模型调用审计写入失败:', auditError instanceof Error ? auditError.message : auditError)
          }
        }
        const answer = typeof result?.answer === 'string' ? result.answer.trim() : ''
        if (!answer) throw new Error('Agent 无回答产出')
        // 工具调用过程 + 知识库引用来源：随消息持久化，切换会话/刷新后仍可展示
        const actionCards = Array.isArray(result.actionCards) ? result.actionCards : []
        const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : []
        const sources = Array.isArray(result.sources) ? result.sources : []
        // P3：工具轨迹加密落库（超限/为空时不落，下一轮直接不回放）
        const serializedTrace = serializeToolTrace(result.toolTrace)
        const [assistantMessage] = await db.insert(schema.chatMessages).values({
          schoolId: user.schoolId!, ownerUserId: user.id, sessionId: ownedSessionId,
          role: 'assistant', contentEnc: encryptSensitive(answer, config.encryptionKey),
          toolTraceEnc: serializedTrace ? encryptSensitive(serializedTrace, config.encryptionKey) : null,
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
          // 智能标题只用最近几条教师提问，避免把整段预算内历史都送进标题模型
          const titleInput = [...history.filter((h) => h.role === 'user').map((h) => h.content).slice(-4), body.message]
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

        // 本地模式：安全规则已在上面本地执行；不向外部模型发送任何数据
        if (governance.effectiveMode === 'local') {
          emit(controller, 'error', { message: AI_LOCAL_MODE_MESSAGE })
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
        emit(controller, 'error', { message: AGENT_UNAVAILABLE_MESSAGE })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })
  return sendStream(event, stream)
})

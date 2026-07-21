import type { H3Event } from 'h3'
import { z } from 'zod'
import { clarificationRoundSchema, clarificationSummarySchema, routeDecisionSchema, type ClarificationRound, type ClarificationSummary, type RouteDecision } from '../../shared/contracts'
import type { ModuleId } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta } from '../../shared/assessments'
import type { RuleOutput } from '../domain/rules'
import type { KnowledgeCitation } from '../domain/knowledge'
import type { AssistantBusinessContext } from '../domain/assistant-context'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { schema, useDb } from '../utils/db'

const keywordRoutes: Array<[RouteDecision['primaryModule'], RegExp]> = [
  ['home_school', /(家长|投诉|家长群|家校|沟通)/i],
  ['class_system', /(班级|纪律|班干部|班规|班风|秩序)/i],
  ['student_case', /(学生|孩子|同学|打架|情绪|不合群|走神)/i],
  ['learning_problem', /(学不|学不会|不想学|成绩|作业|考试|偏科|补习|厌学|听不懂|记不住)/i],
  ['self_growth', /(我很累|疲惫|压力|倦怠|无力|委屈|崩溃)/i]
]

export function localRoute(text: string): RouteDecision {
  const matches = keywordRoutes.filter(([, regex]) => regex.test(text)).map(([module]) => module)
  const primaryModule = matches[0] || 'self_growth'
  return {
    primaryModule,
    secondaryModules: matches.slice(1, 3).map((module, index) => ({ module, confidence: 0.55 - index * 0.1 })),
    confidence: matches.length ? 0.76 : 0.5,
    needsClarification: !matches.length,
    clarification: !matches.length ? '这件事目前最困扰您的是自己的状态、班级运行、家长沟通，还是某位学生的表现？' : undefined,
    rationale: matches.length ? '根据描述中的场景主体与困扰重点进行规则路由。' : '信息不足，建议先确认主要困扰领域。'
  }
}

const assistantResponseSchema = z.object({
  answer: z.string().trim().min(10).max(5000),
  route: routeDecisionSchema,
  suggestedActions: z.array(z.object({
    label: z.string().trim().min(2).max(80),
    type: z.enum(['clarify', 'open_module', 'record', 'tool']),
    module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']).optional()
  })).max(4).default([]),
  citationIds: z.array(z.string().uuid()).max(6).default([])
})

export type AssistantResponse = z.infer<typeof assistantResponseSchema> & { mode: 'deepseek' | 'local_fallback' }

function localAssistantResponse(text: string, citations: KnowledgeCitation[], businessContext?: AssistantBusinessContext | null): AssistantResponse {
  const route = localRoute(text)
  const objectText = businessContext ? `我已参考当前咨询对象“${businessContext.label}”的档案、沟通和历史方案摘要。` : ''
  const sourceText = citations.length
    ? `我参考了已发布的业务知识：${citations.slice(0, 2).map(item => `《${item.documentTitle}》${item.heading ? `“${item.heading}”` : ''}中与这个场景相关的片段`).join('；')}。`
    : '当前没有检索到足够相关的已发布知识，我会先基于通用班主任工作方法帮您梳理方向，不下业务分级或制度性结论。'
  const clarification = route.needsClarification && route.clarification ? ` ${route.clarification}` : ''
  return {
    answer: `${objectText}${sourceText} ${route.rationale}${clarification} 您可以先记录事实、区分情绪与诉求，再选择一个最小动作推进；如果需要等级、量表或 SOP 结论，请进入对应模块完成规则评估。`,
    route,
    suggestedActions: [{ label: '进入建议模块继续评估', type: 'open_module', module: route.primaryModule }],
    citationIds: citations.map(item => item.chunkId),
    mode: 'local_fallback'
  }
}

function buildAssistantMessages(input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
  dataMode?: 'redacted' | 'full_context'
}, outputMode: 'json' | 'text') {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。此时可以基于通用班主任工作方法进行共情、澄清、问题拆解和非制度性行动建议；不得编造平台手册、量表、SOP、等级、制度或来源。'
  const businessContextText = input.businessContext
    ? `当前咨询对象：${input.businessContext.type} / ${input.businessContext.label}\n${input.businessContext.prompt}`
    : '未指定咨询对象。'
  const formatInstruction = outputMode === 'json'
    ? '输出严格 json。JSON 格式：{"answer":"...","route":{"primaryModule":"home_school","secondaryModules":[],"confidence":0.8,"needsClarification":false,"rationale":"..."},"suggestedActions":[{"label":"...","type":"open_module","module":"home_school"}],"citationIds":["知识片段UUID"]}'
    : '直接输出给班主任看的自然语言回答，不要输出 JSON，不要输出字段名。回答控制在 500 字以内，优先给 1–3 个可执行动作。'
  return [
    {
      role: 'system',
      content: `你是“教师赋能智能平台”的统一 AI 助手，服务班主任。业务模块只有 self_growth、class_system、home_school、student_case、learning_problem。
你的职责：理解教师自然语言、进行多轮澄清、结合已审核知识和通用班主任工作方法给出当下可执行建议，并建议进入合适模块。
硬约束：
1. 不做精神、医学、法律诊断，不承诺效果，不替代心理专员、医生、警方或校方制度。
2. 不计算量表分数，不确定六色预警、四阶、P×A、L1-L3，不决定熔断；这些由代码规则执行。
3. 知识片段是业务依据，不是逐字答案。可以根据教师问题自主组织回答、做场景分析、提出澄清问题和通用建议。
4. 涉及平台规则、量表、分级、SOP、红线、校内制度、工具卡原文或“平台要求”时，必须基于下方知识片段或建议进入模块评估；知识不足时明确说明“需要进入模块或补充业务知识后确认”。
5. 不能杜撰手册、SOP、等级、数据、来源或校方制度。引用来源时只能引用下方知识片段。
6. 回答温和、简洁；需要追问时每轮最多问一个关键问题。
7. 不复述姓名、电话、邮箱等个人信息，不扩大到其他教师或学生数据。
8. 上下文中的方案(recentPlans)包含执行动作(actions)及其状态。可引用方案进度，根据教师反馈在回答中建议更新方案状态。
9. 如果提供了“当前业务对象上下文”，可以结合其中的学生/班级/家长/沟通/历史方案摘要进行分析，但不能暴露完整电话等隐私字段，不能推断上下文之外的个人信息。
10. ${formatInstruction}

已审核知识：
${knowledgeContext}

当前业务对象上下文：
${businessContextText}`
    },
    ...input.history.slice(-8).map(item => ({ role: item.role, content: sanitizeModelText(item.content, input.dataMode).slice(0, 2500) })),
    { role: 'user', content: sanitizeModelText(input.message, input.dataMode) }
  ]
}

// ---- AI 追问与分类机制 ----

function buildClarificationPrompt(input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  clarificationRound: number
  previousModuleScores?: Record<string, number>
}) {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。'
  const previousScores = input.previousModuleScores
    ? `上一轮模块相关性评分：${JSON.stringify(input.previousModuleScores)}`
    : '这是第一轮追问，暂无历史模块评分。'

  return [
    {
      role: 'system',
      content: `你是"教师赋能智能平台"的追问助手。当前处于**问题澄清阶段（第${input.clarificationRound}轮）**，你的唯一职责是通过追问帮助教师明确问题方向。

硬约束：
1. **禁止给出任何建议、诊断或解决方案**。这个阶段你只做追问和方向确认。
2. 每轮输出一个追问问题 + 至少3个选项供教师选择。选项应覆盖不同的可能方向。
3. 同时评估5个业务模块（self_growth/class_system/home_school/student_case/learning_problem）与当前问题的相关性，给出0-1的评分。
4. 模块评分应基于教师所有轮次的回答综合判断，本轮评分应在前一轮评分基础上调整。
5. 评分规则：0=无关，0.3=可能有微弱关联，0.5=中等关联，0.7=明显相关，1.0=强相关。总分不要求为1。
6. 如果本轮是第1轮，先确认教师最困扰的核心层面（自身状态/班级/学生等）；后续轮次在此基础上深入。
7. 追问语气温和、简洁，不重复教师已经明确的内容。
8. 到了第3轮之后，逐步开始总结方向，在question中体现"当前的综合判断是..."

输出严格 JSON 格式：
{"type":"clarification","round":${input.clarificationRound},"question":"追问的问题文本","options":["选项1","选项2","选项3",...],"moduleScores":{"self_growth":0.5,"class_system":0.3,"home_school":0.2,"student_case":0.7,"learning_problem":0.1}}

${previousScores}

已审核知识（仅供了解业务范围，不直接引用）：
${knowledgeContext}`
    },
    ...input.history.slice(-12).map(item => ({ role: item.role, content: item.content.slice(0, 2000) })),
    { role: 'user', content: input.message.slice(0, 2000) }
  ]
}

function buildSummaryPrompt(input: {
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
}) {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。'
  const scoresContext = input.lastModuleScores
    ? `上一轮模块评分：${JSON.stringify(input.lastModuleScores)}。请在此基础上汇总最终占比。`
    : ''

  return [
    {
      role: 'system',
      content: `你是"教师赋能智能平台"的总结助手。现在是**问题澄清结束后的总结阶段**。教师已通过多轮追问明确了问题方向，现在你需要基于所有对话历史，生成一个完整的分析回复。

你需要输出两部分核心内容：

【answer】—— 给教师的完整分析回复（500-1500字），直接对教师说话。结构如下：
1. 用1-2句话概括你理解到的教师的困扰和处境（表达共情）
2. 基于追问中收集的信息，分析问题的几个关键维度（对应各模块的方向）
3. 给出3-5条具体、可执行的建议或思路（结合知识库中的方法论，但不照搬原文）
4. 建议教师进入哪个模块做系统性评估，并简要说明为什么

【分类信息】—— 用于系统路由的元数据：
- rationale：一句话概括（50字内，仅用于系统记录）
- primaryModule：最匹配的模块ID
- moduleProportions：5个模块的最终占比，总和为1
- suggestedActions：1-4个后续建议动作（按钮）

硬约束：
1. answer 必须是一段完整的、可直接发给教师看的回复，语气温和、有共情、有实质内容
2. 不做精神、医学、法律诊断；不计算量表分数
3. 不照搬知识库原文，用自己的话组织
4. 涉及平台规则、SOP时，建议进入对应模块评估而不是自行下结论

输出严格 JSON 格式：
{"type":"summary","answer":"完整的分析回复文本（500-1500字）","rationale":"一句话概括","primaryModule":"self_growth","moduleProportions":{"self_growth":0.4,"class_system":0.2,"home_school":0.1,"student_case":0.2,"learning_problem":0.1},"suggestedActions":[{"label":"进入自我成长模块评估","type":"open_module","module":"self_growth"}]}

${scoresContext}

已审核知识（供参考方法论，不照搬原文）：
${knowledgeContext}`
    },
    ...input.history.slice(-16).map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))
  ]
}

/**
 * 流式调用 DeepSeek 进行追问，返回解析后的 ClarificationRound。
 * 输出 JSON 模式（非流式流式传输），因为追问响应较短。
 */
export async function streamClarificationRound(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  clarificationRound: number
  previousModuleScores?: Record<string, number>
}): Promise<{ data: ClarificationRound; fallback: boolean }> {
  const config = useRuntimeConfig(event)
  const defaultScores: Record<string, number> = { self_growth: 0.3, class_system: 0.3, home_school: 0.2, student_case: 0.1, learning_problem: 0.1 }
  const fallback: ClarificationRound = {
    type: 'clarification',
    round: input.clarificationRound,
    question: '根据您目前描述的情况，这件事最核心困扰您的是哪一个方面？',
    options: ['自己的状态和感受', '班级管理和秩序', '与家长的沟通', '某位学生的表现', '学生学业问题'],
    moduleScores: input.previousModuleScores || defaultScores as ClarificationRound['moduleScores']
  }

  if (!config.deepseekApiKey) return { data: fallback, fallback: true }

  const startedAt = Date.now()
  const messages = buildClarificationPrompt({
    message: input.message,
    history: input.history,
    citations: input.citations,
    clarificationRound: input.clarificationRound,
    previousModuleScores: input.previousModuleScores
  })

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.4,
        max_tokens: 600
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty model output')
    const parsed = clarificationRoundSchema.parse(JSON.parse(content))
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_round',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_round',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return { data: fallback, fallback: true }
  }
}

/**
 * 流式调用 DeepSeek 进行总结，返回解析后的 ClarificationSummary。
 */
export async function streamClarificationSummary(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
}): Promise<{ data: ClarificationSummary; fallback: boolean }> {
  const config = useRuntimeConfig(event)
  const fallback: ClarificationSummary = {
    type: 'summary',
    answer: '根据您的描述，您目前面临多方面的工作困扰。建议优先选择一个最困扰的方向进入模块评估，再通过系统性的量表和分析工具深入了解具体情况。您可以先从"自我成长"模块开始，评估当前的压力水平和应对资源，再根据评估结果决定是否需要进入其他模块。',
    rationale: '教师面临多方面困扰，建议优先自我成长模块评估。',
    primaryModule: 'self_growth',
    moduleProportions: { self_growth: 0.25, class_system: 0.2, home_school: 0.15, student_case: 0.25, learning_problem: 0.15 },
    suggestedActions: [{ label: '进入自我成长模块评估', type: 'open_module', module: 'self_growth' }]
  }

  if (!config.deepseekApiKey) return { data: fallback, fallback: true }

  const startedAt = Date.now()
  const messages = buildSummaryPrompt({
    history: input.history,
    citations: input.citations,
    lastModuleScores: input.lastModuleScores
  })

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.35,
        max_tokens: 800
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 10000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty model output')
    const parsed = clarificationSummarySchema.parse(JSON.parse(content))
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_summary',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_summary',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return { data: fallback, fallback: true }
  }
}

export async function streamAssistantResponse(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
  dataMode?: 'redacted' | 'full_context'
  contextType?: string
  noticeVersion?: string
  forceLocal?: boolean
  onDelta: (text: string) => void | Promise<void>
}): Promise<AssistantResponse> {
  const config = useRuntimeConfig(event)
  const fallback = localAssistantResponse(input.message, input.citations, input.businessContext)
  const suggestedActions = [{ label: '进入建议模块继续评估', type: 'open_module' as const, module: localRoute(input.message).primaryModule }]
  if (!config.deepseekApiKey || input.forceLocal) {
    for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) await input.onDelta(chunk)
    return fallback
  }

  const startedAt = Date.now()
  let answer = ''
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages: buildAssistantMessages(input, 'text'),
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.35,
        max_tokens: 900
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 12000)
    })
    if (!response.ok || !response.body) throw new Error(`DeepSeek ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = parsed.choices?.[0]?.delta?.content || ''
          if (!delta) continue
          answer += delta
          await input.onDelta(delta)
        }
      }
    }
    if (answer.trim().length < 10) throw new Error('Empty streamed model output')
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assistant_answer_stream',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      dataMode: input.forceLocal ? 'local' : input.dataMode,
      contextType: input.contextType,
      noticeVersion: input.noticeVersion
    }).catch(() => undefined)
    const route = localRoute(input.message)
    return {
      answer: answer.trim(),
      route,
      suggestedActions,
      citationIds: input.citations.slice(0, 4).map(item => item.chunkId),
      mode: 'deepseek'
    }
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assistant_answer_stream',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
      dataMode: input.dataMode,
      contextType: input.contextType,
      noticeVersion: input.noticeVersion
    }).catch(() => undefined)
    if (!answer) {
      for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) await input.onDelta(chunk)
      return fallback
    }
    const route = localRoute(input.message)
    return { answer: answer.trim(), route, suggestedActions, citationIds: input.citations.slice(0, 4).map(item => item.chunkId), mode: 'deepseek' }
  }
}

export async function generateAssistantResponse(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
}): Promise<AssistantResponse> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localAssistantResponse(input.message, input.citations, input.businessContext)

  const allowedCitationIds = new Set(input.citations.map(item => item.chunkId))
  const messages = buildAssistantMessages(input, 'json')

  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekGeneratorModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.25,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number, completion_tokens?: number }
      }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      const parsed = assistantResponseSchema.parse(JSON.parse(content))
      parsed.citationIds = parsed.citationIds.filter(id => allowedCitationIds.has(id))
      await useDb(event).insert(schema.aiModelCalls).values({
        schoolId: input.schoolId,
        ownerUserId: input.ownerUserId,
        sessionId: input.sessionId,
        provider: 'deepseek',
        model: config.deepseekGeneratorModel,
        purpose: 'assistant_answer',
        status: 'success',
        latencyMs: Date.now() - startedAt,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens
      }).catch(() => undefined)
      return { ...parsed, mode: 'deepseek' }
    } catch (error) {
      await useDb(event).insert(schema.aiModelCalls).values({
        schoolId: input.schoolId,
        ownerUserId: input.ownerUserId,
        sessionId: input.sessionId,
        provider: 'deepseek',
        model: config.deepseekGeneratorModel,
        purpose: 'assistant_answer',
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
      }).catch(() => undefined)
      if (attempt === 1) return localAssistantResponse(input.message, input.citations, input.businessContext)
    }
  }
  return localAssistantResponse(input.message, input.citations, input.businessContext)
}

export function redactPii(text: string) {
  return text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(/([\u4e00-\u9fa5]{1,4})(老师|同学|妈妈|爸爸|家长)/g, '[PERSON]$2')
}

function sanitizeModelText(text: string, mode: 'redacted' | 'full_context' = 'redacted') {
  const withoutContacts = text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[SYSTEM_ID]')
    .replace(/(?:密码|密钥|token|secret|totp)\s*[:：=]?\s*\S+/gi, '[SECRET]')
  return mode === 'full_context' ? withoutContacts : redactPii(withoutContacts)
}

const semanticRiskSchema = z.object({
  risks: z.array(z.enum(['suicide', 'self_harm', 'violence', 'abuse', 'threat'])).max(5)
})

const riskRuleIds: Record<z.infer<typeof semanticRiskSchema>['risks'][number], string> = {
  suicide: 'SAFE-SEMANTIC-SUICIDE',
  self_harm: 'SAFE-SEMANTIC-SELF-HARM',
  violence: 'SAFE-SEMANTIC-VIOLENCE',
  abuse: 'SAFE-SEMANTIC-ABUSE',
  threat: 'SAFE-SEMANTIC-THREAT'
}

export async function semanticSafetySignals(event: H3Event, text: string, forceLocal = false) {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || forceLocal) return []
  const redacted = redactPii(text)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekRouterModel,
          messages: [
            { role: 'system', content: '你只做安全信号辅助识别，不做诊断。只返回 JSON。' },
            { role: 'user', content: `识别文本是否明确或隐含涉及自杀、自伤、暴力、虐待或威胁。没有则 risks 为空。文本：${redacted}` }
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0, max_tokens: 160
        }),
        signal: AbortSignal.timeout(1500)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      return semanticRiskSchema.parse(JSON.parse(content)).risks.map(risk => riskRuleIds[risk])
    } catch {
      if (attempt === 1) return []
    }
  }
  return []
}

const expressionSchema = z.object({ summary: z.string().trim().min(10).max(500) })

export async function expressRuleResult(event: H3Event, module: string, result: RuleOutput) {
  const fallback = result.reasons.join('；')
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return fallback
  const facts = JSON.stringify({ module, level: result.level, reasons: result.reasons, actions: result.actions.map(item => item.title) })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekGeneratorModel,
          messages: [
            { role: 'system', content: '把确定性规则结论改写成温和、简洁、非诊断性的教师支持表达。不得改变等级、规则或行动，不得新增事实。只返回 JSON。' },
            { role: 'user', content: `${facts}\n返回格式：{"summary":"..."}` }
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0.3, max_tokens: 300
        }),
        signal: AbortSignal.timeout(1500)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      const summary = expressionSchema.parse(JSON.parse(content)).summary
      if (/(确诊|保证治愈|一定是|医学诊断)/i.test(summary)) throw new Error('Forbidden semantics')
      return summary
    } catch {
      if (attempt === 1) return fallback
    }
  }
  return fallback
}

export async function generateAssessmentReport(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  module: ModuleId
  result: RuleOutput
}): Promise<AssessmentReport> {
  const fallback = createTemplateAssessmentReport({ module: input.module, result: input.result })
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || input.result.blocked) return fallback
  const definition = assessmentDefinitions[input.module]
  const facts = {
    module: input.module,
    moduleTitle: moduleMeta[input.module].title,
    assessmentVersion: `${definition.code}@${definition.version}`,
    level: input.result.level,
    reasons: input.result.reasons,
    dimensions: input.result.dimensions,
    actions: input.result.actions,
    tools: input.result.tools,
    matchedRuleIds: input.result.matchedRuleIds
  }
  const format = JSON.stringify(assessmentReportSchema.parse({ ...fallback, printMeta: { ...fallback.printMeta, source: 'ai' } }))
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages: [
          {
            role: 'system',
            content: `你是教师赋能平台的报告撰写助手。只根据用户提供的规则事实生成正式评估报告 JSON。
硬约束：
1. 不得改变 module、level、matchedRuleIds、assessmentVersion。
2. 不做精神、医学、法律诊断，不承诺效果，不写“确诊、治疗、治愈、一定、保证、医学诊断”等表述。
3. 可优化表达和行动安排，但不得新增规则事实、风险等级或制度结论。
4. 三天行动方案每天 1-3 个动作；七天跟进必须包含观察点、复盘问题和升级信号。
5. 输出必须是严格 JSON，字段结构与示例完全一致。`
          },
          { role: 'user', content: `规则事实：${JSON.stringify(facts)}\n\nJSON结构示例：${format}` }
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.35,
        max_tokens: 2200
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number, completion_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty model output')
    const report = validateAssessmentReport(JSON.parse(content), input.module, input.result)
    report.printMeta.source = 'ai'
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assessment_report',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens
    }).catch(() => undefined)
    return report
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assessment_report',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return fallback
  }
}

export async function routeWithDeepSeek(event: H3Event, text: string): Promise<RouteDecision> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localRoute(text)
  const redacted = redactPii(text)
  const prompt = `你是教师赋能平台的路由器。只返回 json。模块只能是 self_growth、class_system、home_school、student_case、learning_problem。\nJSON示例：{"primaryModule":"home_school","secondaryModules":[],"confidence":0.86,"needsClarification":false,"rationale":"主要困扰是家长沟通"}\n教师描述：${redacted}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekRouterModel,
          messages: [{ role: 'system', content: '输出严格 json，不进行心理或医学诊断。' }, { role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.1,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      return routeDecisionSchema.parse(JSON.parse(content))
    } catch {
      if (attempt === 1) return localRoute(text)
    }
  }
  return localRoute(text)
}

const planUpdateExtractionSchema = z.object({
  updates: z.array(z.object({
    planTitle: z.string().trim().min(1).max(200),
    actionTitle: z.string().optional(),
    newStatus: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    progressNote: z.string().max(500).optional()
  })).max(5).default([])
})

export type PlanUpdateExtraction = z.infer<typeof planUpdateExtractionSchema>

/**
 * 从 AI 回复中提取方案更新意图。
 * 使用一次轻量 LLM 调用，非阻塞，失败时静默返回空数组。
 */
export async function extractPlanUpdates(
  event: H3Event,
  aiResponse: string,
  businessContext: { snapshot: Record<string, unknown> } | null | undefined,
  audit?: { schoolId: string, ownerUserId: string, sessionId: string, dataMode?: string, contextType?: string, noticeVersion?: string }
): Promise<PlanUpdateExtraction['updates']> {
  if (!businessContext?.snapshot) return []
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return []

  // 从 snapshot 中提取方案摘要供 LLM 参考
  const plansSummary = (businessContext.snapshot as any).recentPlans?.map((p: any) => ({
    title: p.title,
    status: p.status,
    actions: p.actions || []
  })) || []

  if (!plansSummary.length) return []

  const prompt = `你是教师赋能平台的方案更新提取器。根据 AI 助手的回复，提取其中明确的方案执行状态更新意图。

当前方案状态：
${JSON.stringify(plansSummary, null, 2)}

AI 助手回复：
${aiResponse.slice(0, 2000)}

规则：
1. 仅当 AI 回复中明确表达了"已完成"、"标记完成"、"更新进度"、"暂停"等意图时才提取
2. 不要猜测或推断未明确表达的更新
3. actionTitle 必须与方案中现有动作标题匹配（模糊匹配即可）
4. 如果没有明确的更新意图，返回空数组

返回严格 JSON：{"updates":[{"planTitle":"方案标题","actionTitle":"动作标题","newStatus":"completed","progressNote":"..."}]}
不得输出或猜测任何数据库 ID、UUID 或账号标识。`

  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekRouterModel,
        messages: [
          { role: 'system', content: '你只做方案更新提取，不做诊断。只返回 JSON。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 600
      }),
      signal: AbortSignal.timeout(3000)
    })
    if (!response.ok) return []
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) return []
    const parsed = planUpdateExtractionSchema.parse(JSON.parse(content))
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: audit?.schoolId, ownerUserId: audit?.ownerUserId, sessionId: audit?.sessionId, provider: 'deepseek',
      model: config.deepseekRouterModel,
      purpose: 'plan_update_extraction',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      dataMode: audit?.dataMode,
      contextType: audit?.contextType,
      noticeVersion: audit?.noticeVersion
    }).catch(() => undefined)
    return parsed.updates
  } catch {
    return []
  }
}

import type { H3Event } from 'h3'
import { z } from 'zod'
import { routeDecisionSchema, type RouteDecision } from '../../shared/contracts'
import type { ModuleId } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta } from '../../shared/assessments'
import type { RuleOutput } from '../domain/rules'
import type { KnowledgeCitation } from '../domain/knowledge'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { schema, useDb } from '../utils/db'

const keywordRoutes: Array<[RouteDecision['primaryModule'], RegExp]> = [
  ['home_school', /(家长|投诉|家长群|家校|沟通)/i],
  ['class_system', /(班级|纪律|班干部|班规|班风|秩序)/i],
  ['student_case', /(学生|孩子|同学|打架|情绪|不合群|走神)/i],
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
    module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case']).optional()
  })).max(4).default([]),
  citationIds: z.array(z.string().uuid()).max(6).default([])
})

export type AssistantResponse = z.infer<typeof assistantResponseSchema> & { mode: 'deepseek' | 'local_fallback' }

function localAssistantResponse(text: string, citations: KnowledgeCitation[]): AssistantResponse {
  const route = localRoute(text)
  const sourceText = citations.length
    ? `我参考了已发布的业务知识：${citations.slice(0, 2).map(item => `《${item.documentTitle}》${item.heading ? `“${item.heading}”` : ''}中与这个场景相关的片段`).join('；')}。`
    : '当前没有检索到足够相关的已发布知识，我会先基于通用班主任工作方法帮您梳理方向，不下业务分级或制度性结论。'
  const clarification = route.needsClarification && route.clarification ? ` ${route.clarification}` : ''
  return {
    answer: `${sourceText} ${route.rationale}${clarification} 您可以先记录事实、区分情绪与诉求，再选择一个最小动作推进；如果需要等级、量表或 SOP 结论，请进入对应模块完成规则评估。`,
    route,
    suggestedActions: [{ label: '进入建议模块继续评估', type: 'open_module', module: route.primaryModule }],
    citationIds: citations.map(item => item.chunkId),
    mode: 'local_fallback'
  }
}

export async function generateAssistantResponse(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
}): Promise<AssistantResponse> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localAssistantResponse(input.message, input.citations)

  const allowedCitationIds = new Set(input.citations.map(item => item.chunkId))
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。此时可以基于通用班主任工作方法进行共情、澄清、问题拆解和非制度性行动建议；不得编造平台手册、量表、SOP、等级、制度或来源。'
  const redactedMessage = redactPii(input.message)
  const messages = [
    {
      role: 'system',
      content: `你是“教师赋能智能平台”的统一 AI 助手，服务班主任。业务模块只有 self_growth、class_system、home_school、student_case。
你的职责：理解教师自然语言、进行多轮澄清、结合已审核知识和通用班主任工作方法给出当下可执行建议，并建议进入合适模块。
硬约束：
1. 不做精神、医学、法律诊断，不承诺效果，不替代心理专员、医生、警方或校方制度。
2. 不计算量表分数，不确定六色预警、四阶、P×A、L1-L3，不决定熔断；这些由代码规则执行。
3. 知识片段是业务依据，不是逐字答案。可以根据教师问题自主组织回答、做场景分析、提出澄清问题和通用建议。
4. 涉及平台规则、量表、分级、SOP、红线、校内制度、工具卡原文或“平台要求”时，必须基于下方知识片段或建议进入模块评估；知识不足时明确说明“需要进入模块或补充业务知识后确认”。
5. 不能杜撰手册、SOP、等级、数据、来源或校方制度。引用来源时只能引用下方知识片段。
6. 回答温和、简洁，优先给 1–3 个今天或明天能执行的动作；需要追问时每轮最多问一个关键问题。
7. 不复述姓名、电话、邮箱等个人信息，不扩大到其他教师或学生数据。
8. citationIds 只能从提供的方括号 UUID 中选择；没有真正使用对应知识片段时不要填 citationIds。输出严格 json。

已审核知识：
${knowledgeContext}

JSON 格式：{"answer":"...","route":{"primaryModule":"home_school","secondaryModules":[],"confidence":0.8,"needsClarification":false,"rationale":"..."},"suggestedActions":[{"label":"...","type":"open_module","module":"home_school"}],"citationIds":["知识片段UUID"]}`
    },
    ...input.history.slice(-8).map(item => ({ role: item.role, content: redactPii(item.content).slice(0, 2500) })),
    { role: 'user', content: redactedMessage }
  ]

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
      if (attempt === 1) return localAssistantResponse(input.message, input.citations)
    }
  }
  return localAssistantResponse(input.message, input.citations)
}

export function redactPii(text: string) {
  return text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(/([\u4e00-\u9fa5]{1,4})(老师|同学|妈妈|爸爸|家长)/g, '[PERSON]$2')
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

export async function semanticSafetySignals(event: H3Event, text: string) {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return []
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
  const prompt = `你是教师赋能平台的路由器。只返回 json。模块只能是 self_growth、class_system、home_school、student_case。\nJSON示例：{"primaryModule":"home_school","secondaryModules":[],"confidence":0.86,"needsClarification":false,"rationale":"主要困扰是家长沟通"}\n教师描述：${redacted}`

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

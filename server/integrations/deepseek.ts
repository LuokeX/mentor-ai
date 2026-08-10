import type { H3Event } from 'h3'
import { z } from 'zod'
import { routeDecisionSchema, type ClarificationRound, type ClarificationSummary, type RouteDecision } from '../../shared/contracts'
import { isValidSummaryOutput, normalizeModuleProportions, sanitizeHistoryForSummary, topModuleFromScores, type SummaryJsonMeta } from '../domain/chat-clarification'
import type { KeywordRouteEntry, ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import type { RuleOutput } from '../domain/rules'
import type { AssistantBusinessContext } from '../domain/assistant-context'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { getAiRuntimeConfig, renderPrompt } from '../domain/ai-config'
import { resolvePublishedModuleResource } from '../domain/module-resources'
import { schema, useDb } from '../utils/db'

export interface KnowledgeCitation {
  chunkId: string
  documentTitle: string
  heading?: string | null
  excerpt?: string
  knowledgeBase: string
  module?: ModuleId
  libraryType?: string
  resourceTitle?: string
  resourceVersionId?: string
}

const keywordRoutes: Array<[RouteDecision['primaryModule'], RegExp]> = [
  ['home_school', /(家长|投诉|家长群|家校|沟通)/i],
  ['class_system', /(班级|纪律|班干部|班规|班风|秩序)/i],
  ['student_case', /(学生|孩子|同学|打架|情绪|不合群|走神)/i],
  ['learning_problem', /(学不|学不会|不想学|成绩|作业|考试|偏科|补习|厌学|听不懂|记不住)/i],
  ['self_growth', /(我很累|疲惫|压力|倦怠|无力|委屈|崩溃)/i]
]
const routeModules: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

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
    ? input.citations.map(item => {
        const resourceMeta = item.module && item.libraryType
          ? `模块：${item.module}；资源类型：${item.libraryType}；资源库：${item.resourceTitle || item.knowledgeBase}${item.resourceVersionId ? `；资源版本：${item.resourceVersionId}` : ''}`
          : `知识库：${item.knowledgeBase}`
        return `[${item.chunkId}] ${resourceMeta}\n来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`
      }).join('\n\n')
    : '没有检索到已发布知识。此时可以基于通用班主任工作方法进行共情、澄清、问题拆解和非制度性行动建议；不得编造平台手册、量表、SOP、等级、制度或来源。'
  const businessContextText = input.businessContext
    ? `当前咨询对象：${input.businessContext.type} / ${input.businessContext.label}\n${input.businessContext.prompt}`
    : '未指定咨询对象。'
  const formatInstruction = outputMode === 'json'
    ? '输出严格 json。JSON 格式：{"answer":"...","route":{"primaryModule":"home_school","secondaryModules":[],"confidence":0.8,"needsClarification":false,"rationale":"..."},"suggestedActions":[{"label":"...","type":"open_module","module":"home_school"}],"citationIds":["知识片段UUID"]}'
    : '直接输出给班主任看的自然语言回答，不要输出 JSON，不要输出字段名。回答控制在 500 字以内，优先给 1–3 个可执行动作。'
  return {
    knowledgeContext,
    businessContextText,
    formatInstruction
  }
}

/** 聊天助手消息：system 提示词来自 AI 管理中心模板，history/user 由代码注入。 */
async function buildAssistantMessagesWithPrompt(event: H3Event, input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
  dataMode?: 'redacted' | 'full_context'
}, outputMode: 'json' | 'text') {
  const parts = buildAssistantMessages(input, outputMode)
  const prompt = await renderPrompt(event, 'assistant_chat', {
    formatInstruction: parts.formatInstruction,
    knowledgeContext: parts.knowledgeContext,
    businessContextText: parts.businessContextText
  })
  const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  messages.push(
    ...input.history.slice(-8).map(item => ({ role: item.role as 'user' | 'assistant', content: sanitizeModelText(item.content, input.dataMode).slice(0, 2500) })),
    { role: 'user', content: sanitizeModelText(input.message, input.dataMode) }
  )
  return messages
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
    ? `参考：上一轮内部模块评分 ${JSON.stringify(input.previousModuleScores)}（仅用于内部记录，不影响追问方向和选项设计。）`
    : '这是第一轮追问，暂无历史模块评分。'
  return { knowledgeContext, previousScores, roundNumber: String(input.clarificationRound) }
}

/** 澄清追问消息：system 提示词来自 AI 管理中心模板。 */
async function buildClarificationMessages(event: H3Event, input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  clarificationRound: number
  previousModuleScores?: Record<string, number>
}) {
  const parts = buildClarificationPrompt(input)
  const prompt = await renderPrompt(event, 'clarification_round', {
    roundNumber: parts.roundNumber,
    previousScores: parts.previousScores,
    knowledgeContext: parts.knowledgeContext
  })
  const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  messages.push(
    ...input.history.slice(-12).map(item => ({ role: item.role as 'user' | 'assistant', content: item.content.slice(0, 2000) })),
    { role: 'user', content: input.message.slice(0, 2000) }
  )
  return messages
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
  return { knowledgeContext, scoresContext }
}

/** 澄清总结消息：system 提示词来自 AI 管理中心模板。 */
async function buildSummaryMessages(event: H3Event, input: {
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
}) {
  const parts = buildSummaryPrompt(input)
  const prompt = await renderPrompt(event, 'clarification_summary', {
    scoresContext: parts.scoresContext,
    knowledgeContext: parts.knowledgeContext
  })
  const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  // 清洗历史：去掉追问轮 assistant 消息里的"选项："列表，
  // 防止模型把"问题 + 选项"格式当成输出范例继续追问
  const sanitized = sanitizeHistoryForSummary(input.history)
  messages.push(...sanitized.slice(-10).map(item => ({ role: item.role as 'user' | 'assistant', content: item.content.slice(0, 1200) })))
  return messages
}

/**
 * 流式调用 DeepSeek 进行追问，实时推送 question 内容，返回解析后的 ClarificationRound。
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
  onDelta: (text: string) => void
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

  if (!config.deepseekApiKey) {
    for (const chunk of fallback.question.match(/[\s\S]{1,18}/g) || [fallback.question]) input.onDelta(chunk)
    return { data: fallback, fallback: true }
  }

  const startedAt = Date.now()
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const messages = await buildClarificationMessages(event, {
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
        model: generatorModel,
        messages,
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.4
      }),
      signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok || !response.body) throw new Error(`DeepSeek ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const token = parsed.choices?.[0]?.delta?.content
          if (!token) continue
          fullText += token
          const sepIdx = fullText.indexOf('<!--JSON-->')
          if (sepIdx === -1) {
            input.onDelta(token)
          } else {
            const tokenStartInFull = fullText.length - token.length
            if (tokenStartInFull < sepIdx) {
              const visiblePart = token.slice(0, Math.max(0, sepIdx - tokenStartInFull))
              if (visiblePart) input.onDelta(visiblePart)
            }
          }
        } catch { /* 跳过非 JSON 行 */ }
      }
    }

    const sepIndex = fullText.indexOf('<!--JSON-->')
    let question: string
    let jsonPart: string
    if (sepIndex !== -1) {
      question = fullText.slice(0, sepIndex).trim()
      jsonPart = fullText.slice(sepIndex + '<!--JSON-->'.length).trim()
    } else {
      question = fullText.trim()
      jsonPart = ''
      const lastBrace = fullText.lastIndexOf('{')
      if (lastBrace !== -1) {
        question = fullText.slice(0, lastBrace).trim()
        jsonPart = fullText.slice(lastBrace).trim()
      }
    }

    if (!question || question.length < 4) throw new Error('模型追问内容为空或过短')

    // 防止模型把选项列表写在问题文本里（应放在 JSON 元数据中）
    // 但模型有时仍然会把选项写在"选项："后面，此时保留剥离的文本用于兜底
    let strippedOptionsText = ''
    const optionDelimIdx = question.indexOf('选项：')
    if (optionDelimIdx !== -1) {
      strippedOptionsText = question.slice(optionDelimIdx + '选项：'.length).trim()
      question = question.slice(0, optionDelimIdx).trim()
    }

    let jsonMeta: { options?: string[]; moduleScores?: Record<string, number> } = {}
    if (jsonPart) {
      // 从 jsonPart 中提取 JSON 对象，容忍模型在 JSON 后附带多余文本
      const firstBrace = jsonPart.indexOf('{')
      if (firstBrace !== -1) {
        // 从第一个 { 开始找匹配的 }
        let depth = 0
        let endIdx = -1
        for (let i = firstBrace; i < jsonPart.length; i++) {
          if (jsonPart[i] === '{') depth++
          if (jsonPart[i] === '}') depth--
          if (depth === 0) { endIdx = i; break }
        }
        if (endIdx !== -1) {
          const jsonBlock = jsonPart.slice(firstBrace, endIdx + 1)
          try { jsonMeta = JSON.parse(jsonBlock) } catch (e) {
            console.error('[clarification_round] JSON 解析失败:', e instanceof Error ? e.message : e, '\n原始 jsonBlock 前300字符:', jsonBlock.slice(0, 300), '\n完整 fullText 后500字符:', fullText.slice(-500))
          }
        } else {
          console.error('[clarification_round] JSON 括号不匹配, jsonPart 前300字符:', jsonPart.slice(0, 300), '\n完整 fullText:', fullText)
        }
      } else {
        console.error('[clarification_round] jsonPart 中未找到 JSON 对象, jsonPart 前300字符:', jsonPart.slice(0, 300), '\n完整 fullText:', fullText)
      }
    }

    // 如果 JSON 中没有 options，尝试从问题文本中剥离的"选项："部分解析
    const parseOptionsFromText = (text: string): string[] => {
      if (!text) return []
      // 按顿号、逗号或中文逗号拆分
      const raw = text.split(/[、，,\n]/).map(s => s.trim()).filter(Boolean)
      // 限制每项长度，过滤明显不是选项的片段
      return raw.filter(s => s.length >= 2 && s.length <= 60)
    }
    const textOptions = parseOptionsFromText(strippedOptionsText)

    const parsed: ClarificationRound = {
      type: 'clarification',
      round: input.clarificationRound,
      question: question.slice(0, 200),
      options: (jsonMeta.options && jsonMeta.options.length ? jsonMeta.options : textOptions.length ? textOptions : fallback.options).slice(0, 6),
      moduleScores: (jsonMeta.moduleScores || input.previousModuleScores || defaultScores) as ClarificationRound['moduleScores']
    }

    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: generatorModel,
      purpose: 'clarification_round',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    console.error('[clarification_round] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    for (const chunk of fallback.question.match(/[\s\S]{1,18}/g) || [fallback.question]) input.onDelta(chunk)
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: generatorModel,
      purpose: 'clarification_round',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return { data: fallback, fallback: true }
  }
}

/**
 * 流式调用 DeepSeek 进行总结，实时推送 answer 内容，返回解析后的 ClarificationSummary。
 */
export async function streamClarificationSummary(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
  onDelta: (text: string) => void
}): Promise<{ data: ClarificationSummary; fallback: boolean }> {
  const config = useRuntimeConfig(event)
  // 模块推荐优先沿用追问轮的有效评分，避免总结失败时丢失信息、退回固定默认值
  const topModule = (topModuleFromScores(input.lastModuleScores) || 'self_growth') as ModuleId
  const lastScoresProportions = normalizeModuleProportions(input.lastModuleScores)
  const buildFallback = (): ClarificationSummary => ({
    type: 'summary',
    answer: `从您描述的情况来看，作为教师您所承担的责任和压力是真实的，这些感受值得被认真对待。根据刚才几轮补充的信息，问题方向已经比较清晰：建议先从「${moduleMeta[topModule].title}」模块入手，用平台上的量表做一次系统评估，再结合归因结果匹配具体的应对工具，这样比凭感觉判断更稳妥。`,
    rationale: '基于对话中补充的具体情况，优先从相关度最高的模块开始系统评估。',
    primaryModule: topModule,
    moduleProportions: lastScoresProportions || { self_growth: 0.25, class_system: 0.2, home_school: 0.15, student_case: 0.25, learning_problem: 0.15 },
    suggestedActions: [{ label: `进入「${moduleMeta[topModule].title}」模块完成评估`, type: 'open_module', module: topModule }]
  })

  const fallback = buildFallback()
  if (!config.deepseekApiKey) {
    for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) input.onDelta(chunk)
    return { data: fallback, fallback: true }
  }

  const startedAt = Date.now()
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel

  // 单次调用：stream=true 时边读边推送 answer_delta；统一返回完整响应文本
  const callOnce = async (options: { stream: boolean; extraSystem?: string }): Promise<string> => {
    const messages = await buildSummaryMessages(event, {
      history: input.history,
      citations: input.citations,
      lastModuleScores: input.lastModuleScores
    })
    if (options.extraSystem) messages.unshift({ role: 'system', content: options.extraSystem })
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: generatorModel,
        messages,
        max_tokens: 4096,
        stream: options.stream,
        thinking: { type: 'disabled' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 45000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    if (!options.stream) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      return payload.choices?.[0]?.message?.content || ''
    }
    if (!response.body) throw new Error('DeepSeek 流式响应无 body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const token = parsed.choices?.[0]?.delta?.content
          if (!token) continue
          fullText += token
          // 遇到分隔符之前的内容实时推送为 answer_delta
          const sepIdx = fullText.indexOf('<!--JSON-->')
          if (sepIdx === -1) {
            input.onDelta(token)
          } else {
            const tokenStartInFull = fullText.length - token.length
            if (tokenStartInFull < sepIdx) {
              const visiblePart = token.slice(0, Math.max(0, sepIdx - tokenStartInFull))
              if (visiblePart) input.onDelta(visiblePart)
            }
          }
        } catch { /* 跳过非 JSON 行 */ }
      }
    }
    return fullText
  }

  // 从完整响应文本中提取 answer 与 JSON 元数据（容忍模型在 JSON 后附带多余文本）
  const parseFullText = (fullText: string): { answer: string; jsonMeta: SummaryJsonMeta } => {
    const sepIndex = fullText.indexOf('<!--JSON-->')
    let answer: string
    let jsonPart: string
    if (sepIndex !== -1) {
      answer = fullText.slice(0, sepIndex).trim()
      jsonPart = fullText.slice(sepIndex + '<!--JSON-->'.length).trim()
    } else {
      // 模型没有输出分隔符，把全文当 answer，尝试从末尾提取 JSON
      answer = fullText.trim()
      jsonPart = ''
      const lastBrace = fullText.lastIndexOf('{')
      if (lastBrace !== -1) {
        answer = fullText.slice(0, lastBrace).trim()
        jsonPart = fullText.slice(lastBrace).trim()
      }
    }
    let jsonMeta: SummaryJsonMeta = {}
    if (jsonPart) {
      const firstBrace = jsonPart.indexOf('{')
      if (firstBrace !== -1) {
        let depth = 0
        let endIdx = -1
        for (let i = firstBrace; i < jsonPart.length; i++) {
          if (jsonPart[i] === '{') depth++
          if (jsonPart[i] === '}') depth--
          if (depth === 0) { endIdx = i; break }
        }
        if (endIdx !== -1) {
          const jsonBlock = jsonPart.slice(firstBrace, endIdx + 1)
          try { jsonMeta = JSON.parse(jsonBlock) } catch (e) {
            console.error('[clarification_summary] JSON 解析失败:', e instanceof Error ? e.message : e, '\n原始 jsonBlock 前200字符:', jsonBlock.slice(0, 200))
          }
        } else {
          console.error('[clarification_summary] JSON 括号不匹配, jsonPart 前200字符:', jsonPart.slice(0, 200))
        }
      } else {
        console.error('[clarification_summary] jsonPart 中未找到 JSON 对象, jsonPart 前200字符:', jsonPart.slice(0, 200))
      }
    }
    return { answer, jsonMeta }
  }

  const playText = (text: string) => {
    for (const chunk of text.match(/[\s\S]{1,18}/g) || [text]) input.onDelta(chunk)
  }

  try {
    let fullText = await callOnce({ stream: true })
    let { answer, jsonMeta } = parseFullText(fullText)

    if (!isValidSummaryOutput(answer, jsonMeta)) {
      console.warn('[clarification_summary] 首次输出不符合总结要求（疑似追问/JSON 缺失），重试一次。answer 前80字符:', answer.slice(0, 80))
      fullText = await callOnce({
        stream: false,
        extraSystem: '你上一次的输出不符合要求：你需要输出的是澄清结束后的完整分析总结，而不是继续追问教师；且必须包含 <!--JSON--> 分隔符与合法 JSON 元数据。请重新输出总结。'
      })
      ;({ answer, jsonMeta } = parseFullText(fullText))
      if (!isValidSummaryOutput(answer, jsonMeta)) {
        console.warn('[clarification_summary] 重试后仍不符合总结要求，使用基于追问评分的结构化兜底。answer 前80字符:', answer.slice(0, 80))
        playText(fallback.answer)
        await useDb(event).insert(schema.aiModelCalls).values({
          schoolId: input.schoolId,
          ownerUserId: input.ownerUserId,
          sessionId: input.sessionId,
          provider: 'deepseek',
          model: generatorModel,
          purpose: 'clarification_summary',
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          errorCode: 'summary_quality_rejected'
        }).catch(() => undefined)
        return { data: fallback, fallback: true }
      }
      // 重试成功：覆盖播放修正后的总结（后续 answer 事件会用最终文本整体替换气泡）
      playText(answer)
    }

    const parsed: ClarificationSummary = {
      type: 'summary',
      answer: answer.slice(0, 2000),
      rationale: jsonMeta.rationale || fallback.rationale,
      primaryModule: (jsonMeta.primaryModule as ClarificationSummary['primaryModule']) || fallback.primaryModule,
      moduleProportions: jsonMeta.moduleProportions || fallback.moduleProportions,
      suggestedActions: (jsonMeta.suggestedActions && jsonMeta.suggestedActions.length
        ? jsonMeta.suggestedActions
        : fallback.suggestedActions).slice(0, 4) as ClarificationSummary['suggestedActions']
    }

    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: generatorModel,
      purpose: 'clarification_summary',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    console.error('[clarification_summary] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    // 失败时也用流式推送 fallback
    playText(fallback.answer)
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: generatorModel,
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
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  let answer = ''
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: generatorModel,
        messages: await buildAssistantMessagesWithPrompt(event, input, 'text'),
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 12000)
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
      model: generatorModel,
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
      model: generatorModel,
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
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const messages = await buildAssistantMessagesWithPrompt(event, input, 'json')

  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: generatorModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.25
        }),
        signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 8000)
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
        model: generatorModel,
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
        model: generatorModel,
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
  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, 'semantic_safety', { userText: redacted })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: routerModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0
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
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const prompt = await renderPrompt(event, 'rule_expression', { facts })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: generatorModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0.3
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
  result: RuleExecResult
  definition?: AssessmentDefinition
}): Promise<AssessmentReport> {
  const definition = input.definition || assessmentDefinitions[input.module]
  const outputTemplateResource = await resolvePublishedModuleResource<{ templates?: OutputTemplateEntry[] }>(event, {
    module: input.module,
    libraryType: 'output_template',
    schoolId: input.schoolId
  }).catch(() => null)
  const outputTemplates = Array.isArray(outputTemplateResource?.payload?.templates)
    ? outputTemplateResource.payload.templates
    : []
  const fallback = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || input.result.blocked) return fallback
  const facts = {
    module: input.module,
    moduleTitle: moduleMeta[input.module].title,
    assessmentVersion: `${definition.code}@${definition.version}`,
    level: input.result.level,
    levelName: input.result.levelName,
    severity: input.result.severity,
    // 归因构成只给名称、强弱和依据，不把占比小数交给模型，避免它在文案里编出百分比
    attributions: (input.result.attributions || []).map(attribution => ({
      name: attribution.name,
      strength: attribution.strength,
      reasons: attribution.reasons
    })),
    reasons: input.result.reasons,
    dimensions: input.result.dimensions,
    actions: input.result.actions,
    tools: input.result.tools,
    matchedRuleIds: input.result.matchedRuleIds
  }
  const format = JSON.stringify(assessmentReportSchema.parse({ ...fallback, printMeta: { ...fallback.printMeta, source: 'ai' } }))
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const prompt = await renderPrompt(event, 'assessment_report', {
    facts: JSON.stringify(facts),
    jsonFormat: format
  })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: generatorModel,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 8000)
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
    if (outputTemplates.length) {
      const deterministic = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
      report.profile.summary = deterministic.profile.summary
      report.risk.description = deterministic.risk.description
      if (deterministic.supportGoal) report.supportGoal = deterministic.supportGoal
      report.firstAction = deterministic.firstAction
      report.escalationConditions = deterministic.escalationConditions
      report.sevenDayFollowUp.reviewQuestions = deterministic.sevenDayFollowUp.reviewQuestions
      if (deterministic.attributionNarrative) report.attributionNarrative = deterministic.attributionNarrative
      if (deterministic.toolIntro) report.toolIntro = deterministic.toolIntro
    }
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      provider: 'deepseek',
      model: generatorModel,
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
      model: generatorModel,
      purpose: 'assessment_report',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return fallback
  }
}

function splitRouteKeywords(value?: string) {
  return (value || '')
    .split(/[,，、;；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeRouteText(value: string) {
  return value.trim().toLowerCase()
}

function routeMatchesText(route: KeywordRouteEntry, text: string) {
  const normalizedText = normalizeRouteText(text)
  if ((route.temporalValidity || 'always') !== 'always') return false
  if ((route.exclusionKeywords || []).some(keyword => normalizedText.includes(normalizeRouteText(keyword)))) return false
  if (route.matchMode === 'regex') {
    try {
      return new RegExp(route.coreKeywords, 'i').test(text)
    } catch {
      return false
    }
  }
  const keywords = route.matchMode === 'exact'
    ? splitRouteKeywords(route.coreKeywords)
    : [...splitRouteKeywords(route.coreKeywords), ...splitRouteKeywords(route.expandedKeywords)]
  return keywords.some(keyword => normalizedText.includes(normalizeRouteText(keyword)))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

async function routeWithPublishedKeywords(event: H3Event, text: string, schoolId?: string | null): Promise<RouteDecision | null> {
  const matches: Array<{ route: KeywordRouteEntry; score: number }> = []
  for (const module of routeModules) {
    const resource = await resolvePublishedModuleResource<{ routes?: KeywordRouteEntry[] }>(event, {
      module,
      libraryType: 'keyword_route',
      schoolId
    }).catch(() => null)
    const routes = Array.isArray(resource?.payload?.routes) ? resource.payload.routes : []
    for (const route of routes) {
      if (!routeMatchesText(route, text)) continue
      matches.push({
        route,
        score: (route.routeWeight ?? 0.7) + Math.max(0, 100 - route.matchPriority) / 1000
      })
    }
  }
  if (!matches.length) return null
  matches.sort((a, b) =>
    b.score - a.score || a.route.matchPriority - b.route.matchPriority || a.route.code.localeCompare(b.route.code)
  )
  const byModule = new Map<ModuleId, { route: KeywordRouteEntry; score: number }>()
  for (const match of matches) {
    const current = byModule.get(match.route.module)
    if (!current || match.score > current.score) byModule.set(match.route.module, match)
  }
  const ranked = Array.from(byModule.values()).sort((a, b) =>
    b.score - a.score || a.route.matchPriority - b.route.matchPriority || a.route.code.localeCompare(b.route.code)
  )
  const primary = ranked[0]!
  return routeDecisionSchema.parse({
    primaryModule: primary.route.module,
    secondaryModules: ranked.slice(1, 4).map(match => ({
      module: match.route.module,
      confidence: clamp(0.35 + (match.route.routeWeight ?? 0.7) * 0.4, 0.35, 0.86)
    })),
    confidence: clamp(0.55 + (primary.route.routeWeight ?? 0.7) * 0.4, 0.55, 0.95),
    needsClarification: false,
    rationale: `命中已发布关键词路由「${primary.route.semanticCategory || primary.route.code}」，建议先进入对应模块完成量表评估。`,
    // ⑨ 里业务填的「关联量表编码」，一路带到前端，让分诊能直接指向具体量表
    suggestedInstrumentCode: primary.route.linkedAssessmentCode || undefined
  })
}

export async function routeWithDeepSeek(event: H3Event, text: string, schoolId?: string | null): Promise<RouteDecision> {
  const publishedRoute = await routeWithPublishedKeywords(event, text, schoolId)
  if (publishedRoute) return publishedRoute
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localRoute(text)
  const redacted = redactPii(text)
  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, 'module_router', { userText: redacted })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: routerModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 8000)
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

  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, 'plan_update_extractor', {
    plansSummary: JSON.stringify(plansSummary, null, 2),
    aiResponse: aiResponse.slice(0, 2000)
  })
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })

  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: routerModel,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0
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
      model: routerModel,
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

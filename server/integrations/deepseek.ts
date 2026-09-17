import type { H3Event } from 'h3'
import { z } from 'zod'
import type { ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { getAiRuntimeConfig, promptAvailable, renderPrompt } from '../domain/ai-config'
import { buildTermGlossary } from '../domain/term-glossary'
import { resolvePublishedModuleResource } from '../domain/module-resources'
import type { SchoolSection } from '../../shared/school-section'
import {
  callJsonChatWithRetry,
  compactValidationError,
  type JsonChatMessage,
  type JsonChatToolSpec
} from './json-chat'

// compactValidationError 已随统一 JSON 调用层移到 json-chat.ts；
// 这里 re-export，保持既有引用（含 tests/reports.test.ts）不变。
export { compactValidationError }

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

/** 语义安全信号：1.5s 单次超时、两次尝试（本地规则先跑，这里只是补充识别）。 */
const SEMANTIC_SAFETY_TIMEOUT_MS = 1500
const SEMANTIC_SAFETY_MAX_TOKENS = 128
const SEMANTIC_SAFETY_ATTEMPTS = 2

/**
 * strict 结构化输出试点定义（仅当 AI_STRICT_JSON_PURPOSES 含 semantic_safety 时启用）。
 * 已关思考，满足 tool_choice 具名形式对思考模式的要求；不可用时自动回退 json_object。
 */
const semanticSafetyTool: JsonChatToolSpec = {
  name: 'report_safety_risks',
  description: '上报教师消息里出现的危机风险类别；没有风险时返回空数组。',
  parameters: {
    type: 'object',
    properties: {
      risks: {
        type: 'array',
        items: { type: 'string', enum: ['suicide', 'self_harm', 'violence', 'abuse', 'threat'] },
        maxItems: 5
      }
    },
    required: ['risks'],
    additionalProperties: false
  }
}

/**
 * 语义安全信号（危机识别的模型补充，不能削弱本地硬规则）。
 *
 * 2026-09 迁移到统一 JSON 调用层：失败会写 ai_model_calls（purpose=semantic_safety），
 * 不再静默无痕；输出上限显式声明；strict 试点开启时走 tool 通道。
 */
export async function semanticSafetySignals(
  event: H3Event,
  text: string,
  forceLocal = false,
  audit: { schoolId?: string | null, ownerUserId?: string | null, sessionId?: string | null } = {}
) {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || forceLocal) return []
  const redacted = redactPii(text)
  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, 'semantic_safety', { userText: redacted })
  if (!promptAvailable(prompt)) return []
  const messages: JsonChatMessage[] = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  const outcome = await callJsonChatWithRetry<string[]>({
    event,
    purpose: 'semantic_safety',
    model: routerModel,
    messages,
    // 关思考后只需回 5 个枚举值：128 token 足够，同时压掉 1.5s 超时下的长尾
    maxTokens: SEMANTIC_SAFETY_MAX_TOKENS,
    timeoutMs: SEMANTIC_SAFETY_TIMEOUT_MS,
    temperature: 0,
    thinking: 'disabled',
    attempts: SEMANTIC_SAFETY_ATTEMPTS,
    tool: semanticSafetyTool,
    audit,
    parse: content => ({
      value: semanticRiskSchema.parse(JSON.parse(content)).risks.map(risk => riskRuleIds[risk])
    })
  })
  // 两次尝试都失败：本地硬规则仍然生效，这里只降级为「无语义补充」；
  // 失败元数据已由统一调用层写入 ai_model_calls（不再静默无痕）。
  return outcome.data ?? []
}


/**
 * 报告输出上限：显式声明为思考模式的服务端默认上限（64K）。
 * 思考模式下 reasoning token 也计入 completion_tokens，按正文长度估算会误判截断；
 * 显式声明后，一旦被截断会由 finish_reason 判定为 truncated 而不是「JSON 解析失败」。
 */
const REPORT_MAX_TOKENS = 64_000

export async function generateAssessmentReport(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  module: ModuleId
  result: RuleExecResult
  definition?: AssessmentDefinition
  /** 教师任教年级折算的学段：术语片段按文档「适用学部」过滤（不传则不过滤） */
  sections?: readonly SchoolSection[] | null
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
  // 术语白话对照：报告正文里的专业词来源于归因名称与依据、行动建议、工具步骤，
  // 以及输出模板渲染出的摘要/风险说明；先去知识库检索解释，再交给模型讲成白话。
  // 失败即空片段（buildTermGlossary 内部已降级），不阻断报告生成。
  const termTexts = [
    ...(input.result.attributions || []).flatMap(attribution => [attribution.name, ...(attribution.reasons || [])]),
    ...(input.result.reasons || []),
    ...(input.result.actions || []).map(action => `${action.title}\n${action.detail}`),
    ...(input.result.tools || []).map(tool => `${tool.title}\n${tool.content}`),
    fallback.profile.summary,
    fallback.risk.description
  ].filter((text): text is string => typeof text === 'string' && Boolean(text.trim()))
  const termChunks = termTexts.length
    ? await buildTermGlossary(event, {
      schoolId: input.schoolId,
      module: input.module,
      sections: input.sections,
      texts: termTexts
    })
    : []
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
    matchedRuleIds: input.result.matchedRuleIds,
    // 术语解释片段：只用于把上面这些文本里的专业词讲成白话，不得据此新增规则/等级/结论
    termChunks: termChunks.map(chunk => ({
      term: chunk.term,
      documentTitle: chunk.documentTitle,
      heading: chunk.heading,
      content: chunk.content,
      similarity: Number(chunk.similarity.toFixed(4))
    }))
  }
  const format = (() => {
    const base = { ...fallback, printMeta: { ...fallback.printMeta, source: 'ai' as const } }
    try {
      return JSON.stringify(assessmentReportSchema.parse(base))
    } catch {
      // fallback 来自确定性模板，个别旧模板渲染内容可能越界（如工具正文超长）。
      // 降级为未校验的 JSON 示例，避免提交 500；模型输出仍会被 validate 校验，
      // 非法输出走重试、耗尽后抛错（不再回退模板）。
      return JSON.stringify(base)
    }
  })()
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const prompt = await renderPrompt(event, 'assessment_report', {
    facts: JSON.stringify(facts),
    jsonFormat: format
  })
  if (!promptAvailable(prompt)) return fallback
  const messages: JsonChatMessage[] = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  // 报告是全场最长输出，模型偶发超时/输出非法。为满足「必须输出 AI 深度报告」，失败时
  // 带反馈重试（与 tool_step_polish 的 3 次策略一致）；安全类校验（改等级/未知归因/违禁词）
  // 同样触发重试。重试耗尽仍失败时不再回退模板报告——这里抛错交给后台任务收敛为 failed，
  // 由方案页提示重新生成；只有「未配置密钥」或「高危熔断」这类「AI 不适用」场景才在函数
  // 顶部直接返回 fallback（模板报告），两者不是同一含义。
  //
  // 2026-09 迁移到统一 JSON 调用层：重试编排、逐次审计、截断判定与前缀化 error_code
  // 由 callJsonChatWithRetry 承担，这里只保留报告的解析与确定性字段覆盖。
  const MAX_REPORT_ATTEMPTS = 3
  const REPORT_RETRY_DELAY_MS = 3000
  const outcome = await callJsonChatWithRetry<AssessmentReport>({
    event,
    purpose: 'assessment_report',
    model: generatorModel,
    messages,
    // 思考模式下 reasoning token 也计入 completion_tokens：显式声明为默认上限 64K，
    // 使截断由 finish_reason 判定，而不是表现为「JSON 解析失败」
    maxTokens: REPORT_MAX_TOKENS,
    // 全局 DEEPSEEK_TIMEOUT_MS（如 30000）对生成模型偏短，实测多次 60s 超时；
    // DB 显式配置优先，其余情况不低于 360s。
    timeoutMs: rt.timeoutMs || Math.max(Number(config.deepseekTimeoutMs) || 0, 360000),
    temperature: 0.35,
    attempts: MAX_REPORT_ATTEMPTS,
    retryDelayMs: REPORT_RETRY_DELAY_MS,
    audit: { schoolId: input.schoolId, ownerUserId: input.ownerUserId },
    buildFeedback: failure =>
      `\n\n上次输出未通过校验：${failure.message}\n\n请修正后重新输出严格 JSON，字段结构必须与示例完全一致，并把未通过的字段收敛到示例允许的数量或长度。`,
    parse: (content) => {
      const report = validateAssessmentReport(JSON.parse(content), input.module, input.result)
      report.printMeta.source = 'ai'
      if (outputTemplates.length) {
        const deterministic = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
        report.profile.summary = deterministic.profile.summary
        report.risk.description = deterministic.risk.description
      }
      return { value: report }
    }
  })
  if (!outcome.ok || !outcome.data) {
    // 禁止失败回退模板：重试耗尽仍无法产出合法 AI 报告时抛错，由调用方（后台增强）收敛为
    // failed 并保留事务内已写入的确定性标准报告，教师端据此提示「深度报告暂不可用」。
    throw new Error(`AI 深度报告生成失败：已重试 ${outcome.attempts} 次仍无法产出合法报告，最后错误：${outcome.failure?.message || '未知'}`)
  }
  return outcome.data
}

/**
 * 用大模型为教师咨询对话提炼一句简短中文标题（约 12~16 字）。
 * 输入已脱敏；无 DeepSeek Key、模型不可用或解析失败时返回 null，
 * 由调用方降级到 buildChatTitle 的截断法。
 */
export async function generateChatTitle(event: H3Event, messages: string[]): Promise<string | null> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return null
  const rt = await getAiRuntimeConfig(event)
  // 标题是短输出、低风险任务：用 router 模型（更快更省），回答生成仍用 generator 模型
  const model = rt.routerModel || config.deepseekRouterModel
  const text = messages
    .map((message) => redactPii(message))
    .filter(Boolean)
    .join('\n')
    .slice(0, 400)
  if (!text.trim()) return null
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是中文对话标题助手。请为下面的教师咨询对话生成一句 12 到 16 个字的中文标题，概括对话的核心对象与问题。要求：不出现姓名、电话、邮箱等个人信息；不用引号、冒号、省略号等标点；只输出标题本身，不要任何解释或多余文字。' },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 40,
        thinking: { type: 'disabled' }
      }),
      signal: AbortSignal.timeout(rt.timeoutMs && rt.timeoutMs < 5000 ? rt.timeoutMs : 5000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) return null
    const title = content.trim().replace(/[。！？!?，,、；;：:""''“”]/g, '').slice(0, 16)
    if (title.length < 4) return null
    return title
  } catch {
    console.warn('[chat] 标题生成失败，降级截断法:', `${Date.now() - startedAt}ms`)
    return null
  }
}

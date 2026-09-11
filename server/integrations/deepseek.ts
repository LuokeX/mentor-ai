import type { H3Event } from 'h3'
import { z } from 'zod'
import type { ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { getAiRuntimeConfig, promptAvailable, renderPrompt } from '../domain/ai-config'
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

export async function semanticSafetySignals(event: H3Event, text: string, forceLocal = false) {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || forceLocal) return []
  const redacted = redactPii(text)
  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, 'semantic_safety', { userText: redacted })
  if (!promptAvailable(prompt)) return []
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
  const messages: Array<{ role: 'system' | 'user', content: string }> = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  // 报告是全场最长输出，模型偶发超时/输出非法。为满足「必须输出 AI 深度报告」，失败时
  // 带反馈重试（与 tool_step_polish 的 3 次策略一致）；安全类校验（改等级/未知归因/违禁词）
  // 同样触发重试。重试耗尽仍失败时不再回退模板报告——这里抛错交给后台任务收敛为 failed，
  // 由方案页提示重新生成；只有「未配置密钥」或「高危熔断」这类「AI 不适用」场景才在函数
  // 顶部直接返回 fallback（模板报告），两者不是同一含义。
  const MAX_REPORT_ATTEMPTS = 3
  const REPORT_RETRY_DELAY_MS = 3000
  let previousError: string | undefined
  for (let attempt = 1; attempt <= MAX_REPORT_ATTEMPTS; attempt++) {
    const startedAt = Date.now()
    const attemptMessages = [...messages]
    if (previousError) {
      attemptMessages.push({
        role: 'user',
        content: `\n\n上次输出未通过校验：${previousError}\n\n请修正后重新输出严格 JSON，字段结构必须与示例完全一致，并把超限字段（归因依据列表、单条依据长度等）收敛到示例允许的数量。`
      })
    }
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: generatorModel,
          messages: attemptMessages,
          response_format: { type: 'json_object' },
          temperature: 0.35
        }),
        // 评估报告是全场最长输出（完整报告 JSON），全局 DEEPSEEK_TIMEOUT_MS（如 30000）
        // 对生成模型偏短，实测多次 60s 超时；DB 显式配置优先，其余情况不低于 360s。
        signal: AbortSignal.timeout(rt.timeoutMs || Math.max(Number(config.deepseekTimeoutMs) || 0, 360000))
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
      previousError = error instanceof Error ? error.message : '未知错误'
      if (attempt < MAX_REPORT_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, REPORT_RETRY_DELAY_MS))
      }
    }
  }
  // 禁止失败回退模板：重试耗尽仍无法产出合法 AI 报告时抛错，由调用方（后台增强）收敛为
  // failed 并保留事务内已写入的确定性标准报告，教师端据此提示「深度报告暂不可用」。
  throw new Error(`AI 深度报告生成失败：已重试 ${MAX_REPORT_ATTEMPTS} 次仍无法产出合法报告，最后错误：${previousError || '未知'}`)
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
  const model = rt.generatorModel || config.deepseekGeneratorModel
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

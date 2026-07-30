/**
 * 「该做哪张量表」的推荐。
 *
 * 边界：LLM 决定「从哪测起」，引擎决定「测出来是什么」。
 * 归因、分级、工具匹配全程仍是确定性的，AI 只挑入口。
 *
 * LLM 的选择不可审计，所以加了三道约束：
 *   1. 只能从白名单（该模块已发布、未被门禁锁住的量表）里选，喂给它的就是这份清单
 *   2. 返回的编码必须校验存在于白名单，否则退到兜底
 *   3. DeepSeek 不可用、超时、返回非法 JSON 一律退到兜底，不阻断教师流程
 * 推荐结果带 source 标记，前端据此告诉教师这是 AI 推测还是规则兜底。
 */
import type { H3Event } from 'h3'
import type { ModuleId } from '../../shared/contracts'
import { moduleMeta } from '../../shared/assessments'
import { schema, useDb } from '../utils/db'
import { redactPii } from '../integrations/deepseek'
import {
  fallbackInstrument,
  listInstrumentOptions,
  resolveReachableInstrument,
  type InstrumentOption
} from './assessment-instruments'

export interface InstrumentRecommendation {
  /** 推荐做的量表；模块下没有任何可做量表时为 null */
  instrumentCode: string | null
  instrumentTitle: string | null
  /** 给教师看的一句话理由 */
  rationale: string
  /** ai = LLM 挑的；redirected = LLM 挑的那张被前置锁住、已改推前置；fallback = 规则兜底 */
  source: 'ai' | 'redirected' | 'fallback'
  /** 被改推时，原本想推的那张 */
  originalCode: string | null
  options: InstrumentOption[]
}

function describeForPrompt(options: InstrumentOption[]) {
  return options.map(option => ({
    code: option.code,
    title: option.title,
    questionCount: option.questionCount,
    estimatedMinutes: option.estimatedMinutes,
    isRequired: option.isRequired,
    usageTiming: option.usageTiming || undefined,
    description: option.description
  }))
}

function fallbackResult(options: InstrumentOption[], reason: string): InstrumentRecommendation {
  const picked = fallbackInstrument(options)
  return {
    instrumentCode: picked?.code ?? null,
    instrumentTitle: picked?.title ?? null,
    rationale: picked ? reason : '当前模块暂无可做的量表，请联系平台管理员检查量表库发布状态。',
    source: 'fallback',
    originalCode: null,
    options
  }
}

/**
 * 按教师描述推荐一张量表。
 * text 为空（例如教师直接点进模块而不是从对话进来）时直接走兜底，不调模型。
 */
export async function recommendInstrument(
  event: H3Event,
  input: {
    module: ModuleId
    text?: string
    user: { id: string, schoolId?: string | null }
    sessionId?: string | null
  }
): Promise<InstrumentRecommendation> {
  const options = await listInstrumentOptions(event, input.module, input.user)
  if (!options.length) return fallbackResult(options, '')

  const selectable = options.filter(option => option.status !== 'locked')
  const text = (input.text || '').trim()

  // 只有一张可做，或没有教师描述可参考 → 不必调模型
  if (!text || selectable.length <= 1) {
    return fallbackResult(options, selectable.length
      ? `${moduleMeta[input.module].title}模块当前建议先完成这张量表。`
      : '')
  }

  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) {
    return fallbackResult(options, '按量表库的必做标记推荐，未启用 AI 推荐。')
  }

  const startedAt = Date.now()
  const prompt = `你是教师赋能平台的量表分诊器。教师描述了自己的困扰，你要从给定的量表清单里挑最合适的一张。
只返回 json，不要解释。格式：{"code":"量表编码","rationale":"一句话说明为什么先做这张，40字以内"}

硬约束：
1. code 必须是清单里已有的量表编码，不得编造。
2. rationale 面向班主任，说清「为什么先做这张」，不要复述量表名称。
3. 不做任何诊断性判断，不要提及疾病、障碍等表述。

可选量表清单：${JSON.stringify(describeForPrompt(selectable))}

教师描述：${redactPii(text)}`

  const audit = (status: 'success' | 'fallback') => useDb(event).insert(schema.aiModelCalls).values({
    schoolId: input.user.schoolId || null,
    ownerUserId: input.user.id,
    sessionId: input.sessionId || null,
    provider: 'deepseek',
    model: config.deepseekGeneratorModel,
    purpose: 'instrument_recommendation',
    status,
    latencyMs: Date.now() - startedAt
  }).catch(() => undefined)

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty model output')

    const parsed = JSON.parse(content) as { code?: unknown, rationale?: unknown }
    const code = typeof parsed.code === 'string' ? parsed.code.trim() : ''
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim().slice(0, 120) : ''

    // 约束 2：编码必须真实存在。模型编造编码时不能把错误往下传。
    const resolved = code ? resolveReachableInstrument(options, code) : null
    if (!resolved) {
      await audit('fallback')
      return fallbackResult(options, '未能匹配到更合适的量表，按必做标记推荐这张。')
    }

    await audit('success')
    if (resolved.redirectedFrom) {
      return {
        instrumentCode: resolved.instrument.code,
        instrumentTitle: resolved.instrument.title,
        rationale: `你的情况更适合做「${resolved.redirectedFrom.title}」，但它需要先完成这张量表。`,
        source: 'redirected',
        originalCode: resolved.redirectedFrom.code,
        options
      }
    }
    return {
      instrumentCode: resolved.instrument.code,
      instrumentTitle: resolved.instrument.title,
      rationale: rationale || `${moduleMeta[input.module].title}模块建议先完成这张量表。`,
      source: 'ai',
      originalCode: null,
      options
    }
  } catch (error) {
    console.error('[instrument_recommendation] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    await audit('fallback')
    return fallbackResult(options, 'AI 推荐暂时不可用，按量表库的必做标记推荐这张。')
  }
}

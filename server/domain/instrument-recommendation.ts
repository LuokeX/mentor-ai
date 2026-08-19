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
import { INSTRUMENT_ROLE_LABELS } from '../../shared/contracts'
import { moduleMeta } from '../../shared/assessments'
import { schema, useDb } from '../utils/db'
import { redactPii } from '../integrations/deepseek'
import { getAiRuntimeConfig, renderPrompt } from './ai-config'
import {
  fallbackInstrument,
  filterTeacherVisibleInstruments,
  listInstrumentOptions,
  resolveReachableInstrument,
  type InstrumentOption,
  type InstrumentRef
} from './assessment-instruments'

export interface InstrumentRecommendation {
  /** 推荐做的量表；模块下没有任何可做量表时为 null */
  instrumentCode: string | null
  instrumentTitle: string | null
  /** 给教师看的一句话理由 */
  rationale: string
  /**
   * ai           LLM 挑的，且与业务触发条件不冲突
   * ai_override  LLM 挑的那张被业务触发条件标为「当前不需要」，或跳过了业务标为「建议做」的那张
   * redirected   LLM 挑的那张被前置锁住，已改推前置
   * fallback     规则兜底（无描述、只剩一张可选、或模型不可用）
   */
  source: 'ai' | 'ai_override' | 'redirected' | 'fallback'
  /** LLM 跳过了业务标为「建议做」的那张时，记录它。教师可以据此改选。 */
  overriddenSuggestion: InstrumentRef | null
  /** LLM 挑的这张被业务标为「当前不需要做」时为 true */
  pickedNotNeeded: boolean
  /** 被改推时，原本想推的那张 */
  originalCode: string | null
  options: InstrumentOption[]
}

/**
 * 喂给模型的量表清单。
 *
 * 关键：必须把业务在 ③ 里用「触发条件」表达的判断一起给模型。
 * 否则会出现逻辑倒置——DeepSeek 关掉时业务规则生效，开着时反而被忽略。
 * 确定性规则应该约束 AI，而不是 AI 一开就绕过规则。
 */
function describeForPrompt(options: InstrumentOption[]) {
  return options.map(option => ({
    code: option.code,
    title: option.title,
    questionCount: option.questionCount,
    estimatedMinutes: option.estimatedMinutes,
    role: option.role ? INSTRUMENT_ROLE_LABELS[option.role] : undefined,
    isRequired: option.isRequired,
    usageTiming: option.usageTiming || undefined,
    description: option.description,
    // 业务侧的确定性判断，由 ③ 的「触发条件」按该教师历史作答算出
    businessAdvice: option.status === 'suggested'
      ? '业务规则判定：现在该做这张'
      : option.status === 'not_needed'
        ? '业务规则判定：当前还不需要做这张'
        : option.status === 'completed'
          ? '该教师已经做过这张'
          : '无特定条件，随时可做',
    businessAdviceReason: option.triggerConditionNote || undefined,
    lastLevel: option.lastLevelName || option.lastLevel || undefined
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
    overriddenSuggestion: null,
    pickedNotNeeded: false,
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
    /** 提交前预演：本次作答覆盖该量表的历史提交后再算推荐与状态 */
    overrideLatest?: { code: string, answers: Record<string, number> }
  }
): Promise<InstrumentRecommendation> {
  // 红线检查量表只对教师和 LLM 在「高危阈值已命中」时可见，详见该函数注释
  const options = filterTeacherVisibleInstruments(await listInstrumentOptions(event, input.module, input.user, input.overrideLatest))
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
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const prompt = await renderPrompt(event, 'instrument_recommendation', {
    instrumentOptions: JSON.stringify(describeForPrompt(selectable)),
    userText: redactPii(text)
  })

  const audit = (status: 'success' | 'fallback') => useDb(event).insert(schema.aiModelCalls).values({
    schoolId: input.user.schoolId || null,
    ownerUserId: input.user.id,
    sessionId: input.sessionId || null,
    provider: 'deepseek',
    model: generatorModel,
    purpose: 'instrument_recommendation',
    status,
    latencyMs: Date.now() - startedAt
  }).catch(() => undefined)

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: generatorModel,
        messages: [{ role: 'user', content: prompt.user || '' }],
        response_format: { type: 'json_object' },
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(rt.timeoutMs || Number(config.deepseekTimeoutMs) || 8000)
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
        overriddenSuggestion: null,
        pickedNotNeeded: false,
        options
      }
    }

    // LLM 的选择与业务触发条件冲突时要留痕：要么它挑了业务标为「当前不需要」的，
    // 要么业务标了「该做这张」而它挑了别的。两种都记成 ai_override，前端会标注出来。
    const businessSuggestion = options.find(option => option.status === 'suggested') || null
    const pickedNotNeeded = resolved.instrument.status === 'not_needed'
    const skippedSuggestion = Boolean(businessSuggestion) && businessSuggestion!.code !== resolved.instrument.code
    const overridden = pickedNotNeeded || skippedSuggestion

    return {
      instrumentCode: resolved.instrument.code,
      instrumentTitle: resolved.instrument.title,
      rationale: rationale || `${moduleMeta[input.module].title}模块建议先完成这张量表。`,
      source: overridden ? 'ai_override' : 'ai',
      originalCode: null,
      // 只在「业务另有建议」时才填，指向业务建议的那张，供教师一键改选。
      // 之前这里在没有业务建议时错填成了推荐的那张本身，导致提示语说反。
      overriddenSuggestion: skippedSuggestion && businessSuggestion
        ? { code: businessSuggestion.code, title: businessSuggestion.title }
        : null,
      pickedNotNeeded,
      options
    }
  } catch (error) {
    console.error('[instrument_recommendation] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    await audit('fallback')
    return fallbackResult(options, 'AI 推荐暂时不可用，按量表库的必做标记推荐这张。')
  }
}

/**
 * 专业术语抽取（后台调用，供方案改写与深度报告两条链路共用）。
 *
 * 目标：先从「要改写的正文」里找出教师可能看不懂的专业词（例如「先跟后带」
 * 「73855 法则」「意义换框」），再由 term-glossary 逐词去向量知识库检索解释片段。
 * 本文件只负责「抽词」，不检索、不解释、不写库。
 *
 * 设计要点：
 *  - 单次小调用：temperature 0、关闭思考、输出上限小（只要一个词表）；
 *  - 防编造：模型给出的每个词都必须是输入文本的子串，否则丢弃；再按长度、去重、上限过滤；
 *  - 全程降级：未配置密钥、提示词未发布、调用失败、输出非法一律返回空数组，
 *    由调用方按「没有术语片段」继续，绝不阻断方案生成。
 */
import type { H3Event } from 'h3'
import { z } from 'zod'
import { getAiRuntimeConfig, isPromptPublished, promptAvailable, renderPrompt } from './ai-config'
import { callJsonChat, type JsonChatMessage } from '../integrations/json-chat'

/** 单次最多抽取的术语数（与 term-glossary 的检索上限一致）。 */
export const MAX_TERMS = 8
/** 单个术语的长度上限（trim 后超过即丢弃）。 */
export const MAX_TERM_LENGTH = 20
/** 单段输入文本的截断长度。 */
const TEXT_SLICE_MAX = 1200
/** 拼接后的输入总长上限（避免提示词过大）。 */
const INPUT_TOTAL_MAX = 6000
const TERM_MAX_TOKENS = 2048
const TERM_TIMEOUT_MIN_MS = 5_000
const TERM_TIMEOUT_MAX_MS = 30_000
const TERM_TIMEOUT_DEFAULT_MS = 20_000

const termOutputSchema = z.object({ terms: z.array(z.string()).max(50) })

/**
 * 术语清洗（纯函数，供单测）：只保留「来自输入文本、长度合规、不重复」的词，
 * 最多 max 个，保持模型输出顺序。
 */
export function normalizeTerms(terms: unknown, sourceText: string, max = MAX_TERMS): string[] {
  if (!Array.isArray(terms)) return []
  const source = typeof sourceText === 'string' ? sourceText : ''
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of terms) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (!term || term.length > MAX_TERM_LENGTH) continue
    // 防编造：词必须原样出现在输入文本里
    if (!source.includes(term)) continue
    if (seen.has(term)) continue
    seen.add(term)
    result.push(term)
    if (result.length >= max) break
  }
  return result
}

/**
 * 从给定文本里抽取专业术语。任何失败都返回空数组，调用方无需兜底。
 */
export async function extractTerms(event: H3Event, input: { texts: string[] }): Promise<string[]> {
  try {
    const config = useRuntimeConfig(event)
    if (!config.deepseekApiKey) return []
    if (!(await isPromptPublished(event, 'term_extraction'))) return []

    const texts = (Array.isArray(input.texts) ? input.texts : [])
      .filter(text => typeof text === 'string' && text.trim())
      .map(text => text.trim().slice(0, TEXT_SLICE_MAX))
    if (!texts.length) return []
    const joined = texts.join('\n').slice(0, INPUT_TOTAL_MAX)

    const prompt = await renderPrompt(event, 'term_extraction', {
      facts: joined,
      jsonFormat: JSON.stringify({ terms: ['先跟后带', '73855 法则'] })
    })
    if (!promptAvailable(prompt)) return []

    const rt = await getAiRuntimeConfig(event)
    const model = rt.generatorModel || config.deepseekGeneratorModel
    const timeoutMs = Math.max(
      TERM_TIMEOUT_MIN_MS,
      Math.min(rt.timeoutMs || Number(config.deepseekTimeoutMs) || TERM_TIMEOUT_DEFAULT_MS, TERM_TIMEOUT_MAX_MS)
    )

    const messages: JsonChatMessage[] = []
    if (prompt.system) messages.push({ role: 'system', content: prompt.system })
    if (prompt.user) messages.push({ role: 'user', content: prompt.user })

    const outcome = await callJsonChat<{ terms: string[] }>({
      event,
      purpose: 'term_extraction',
      model,
      messages,
      maxTokens: TERM_MAX_TOKENS,
      timeoutMs,
      temperature: 0,
      // 抽词是简单任务：关闭思考，避免 reasoning token 挤占输出上限、拖长耗时
      thinking: 'disabled',
      parse: (content) => ({ value: termOutputSchema.parse(JSON.parse(content)) })
    })
    if (!outcome.ok || !outcome.data) return []
    return normalizeTerms(outcome.data.terms, joined)
  } catch (error) {
    console.warn('[term-extraction] 术语抽取失败，跳过:', error instanceof Error ? error.message : error)
    return []
  }
}

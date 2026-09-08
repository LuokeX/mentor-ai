// 工具步骤内容的 AI 加工（同步调用，fire-on-request）
//
// 目标：把工具库匹配出的结构化步骤（"1. 标题: 说明 + 提示/话术/达标" 机械条目）
// 改写成「人话版」——教师看了能直接照着执行的口语化内容，工具名与步骤
// 数量/顺序/关键事实不变；当没有匹配工具但知识库向量检索有命中间接指导时，
// 改为依据 knowledgeChunks 生成 1..MAX_GENERATED_TOOLS 条新建议（title 为
// AI 自拟，与模式 A 的 title 必须来自输入不同）。
//
// 设计要点：
//   - 同步调用：发生在 submit 链路中写库（事务）之前，教师提交时等待一次
//     DeepSeek 调用，写进 result.tools 的即是加工后正文；AI 失败时逐项回退
//     三库原文，不阻塞方案生成（与无密钥时行为完全一致）。
//   - 双模式：模式 A（expected 非空）把已有工具改写成人话版；模式 B（expected
//     为空、无工具）依据检索片段生成新建议，title/content 由 AI 自拟并经
//     独立校验（见 parsePolishOutput）。
//   - 重试：格式类一过性错误（JSON 解析失败、结构校验不过）最多重试 3 次
//     （含首次），重试时把上次输出与校验错误附给模型修正；耗尽后模式 A
//     逐项回退、模式 B 保留各尝试中通过校验的生成项（上限 MAX_GENERATED_TOOLS）。
//   - 解析/合并/重试循环均为纯函数（parsePolishOutput / mergePolishResults /
//     runPolishWithRetry / runGeneratedPolishRetry），可直接单测；
//     真实网络调用封装在 polishToolSteps。
import type { H3Event } from 'h3'
import { z } from 'zod'
import type { ModuleId, Severity } from '../../shared/contracts'
import { moduleMeta } from '../../shared/assessments'
import { getAiRuntimeConfig, renderPrompt } from './ai-config'
import { embedModuleResourceQuery } from '../integrations/embeddings'
import { searchKnowledgeChunks, type KnowledgeSearchResult } from './module-resource-knowledge-search'
import { schema, useDb } from '../utils/db'

export type PolishTool = { title: string, content: string, code?: string }

export interface ToolPolishInput {
  schoolId: string
  ownerUserId: string
  module: ModuleId
  severity?: Severity
  /** 归因只给名称/强弱/原因，不传占比小数，避免模型在其文里编造数字 */
  attributions?: Array<{ name: string, strength: string, reasons?: string[] }>
  tools: PolishTool[]
  /** 知识库检索词（不含 PII），由调用方传入；非空且 embedding 可用时先做向量检索，片段并入 facts */
  knowledgeQuery?: string
}

export const MAX_TOOL_POLISH_ATTEMPTS = 3
export const MAX_TOOL_POLISH_CONTENT = 4000
/** 无工具（模式 B）时单次最多生成的条数；0 条或超出都视为非法触发重试 */
export const MAX_GENERATED_TOOLS = 3
/** 模式 B 生成 title 的长度上限（trim 后） */
export const MAX_GENERATED_TITLE_LENGTH = 30
/** 单个知识片段并入 facts 前的内容截断长度 */
export const KNOWLEDGE_CHUNK_MAX_LENGTH = 600
const RETRY_DELAY_MS = 1000
/** 加工内容远小于深度报告（全场最长输出），单次 30s 足够 */
const SINGLE_ATTEMPT_TIMEOUT_FLOOR_MS = 30_000

const toolPolishOutputSchema = z.object({
  tools: z.array(z.object({
    title: z.string(),
    content: z.string()
  }))
})

export interface PolishAttemptResult {
  /** 本次尝试中通过校验的工具（title → 加工后 content） */
  matched: Map<string, string>
  /** 校验错误摘要；为空表示本次尝试全部通过 */
  errors: string[]
  /** 本次尝试的原始输出（重试时反馈给模型修正） */
  raw?: string
}

/**
 * 解析模型输出并逐项关联回输入工具（纯函数，双模式）：
 *  - 模式 A（expected 非空）：改写已有工具——数量必须与输入一致、title 必须
 *    匹配输入工具、content 非空且 ≤ MAX_TOOL_POLISH_CONTENT。
 *  - 模式 B（expected 为空）：无工具生成——不存在「输入中没有的工具名」概念，
 *    title 为 AI 自拟，需 trim 后非空且 ≤ MAX_GENERATED_TITLE_LENGTH、不得
 *    重复；content 非空且 ≤ MAX_TOOL_POLISH_CONTENT；数量限制 1..MAX_GENERATED_TOOLS
 *    （0 条或超出都计入 errors）。
 * 任何一项不合法都进入 errors（触发重试），合法的部分仍通过 matched 保留，
 * 供所有尝试耗尽时做「合法的保留 AI 版、非法的回退/丢弃」的合并。
 */
export function parsePolishOutput(rawText: string, expected: Array<{ title: string }>): PolishAttemptResult {
  const matched = new Map<string, string>()
  const errors: string[] = []
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    return { matched, errors: ['模型输出不是合法 JSON'] }
  }
  const parsed = toolPolishOutputSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5)
      .map(issue => `${issue.path.join('.') || 'root'} ${issue.message}`)
      .join('；')
    return { matched, errors: [`输出结构校验失败：${issues}`] }
  }
  const outputTools = parsed.data.tools
  // 模式 B：expected 为空（无工具生成场景），title 全部为 AI 自拟
  const generating = expected.length === 0
  const expectedTitles = new Set(expected.map(item => item.title.trim()).filter(Boolean))
  if (generating) {
    if (outputTools.length < 1 || outputTools.length > MAX_GENERATED_TOOLS) {
      errors.push(`输出 tools 数量 ${outputTools.length}，应为 1-${MAX_GENERATED_TOOLS}`)
    }
  } else if (outputTools.length !== expected.length) {
    errors.push(`输出 tools 数量 ${outputTools.length}，应为 ${expected.length}`)
  }
  const seen = new Set<string>()
  for (const item of outputTools) {
    const title = item.title.trim()
    if (generating) {
      if (!title) {
        errors.push('存在标题为空的工具项')
        continue
      }
      if (title.length > MAX_GENERATED_TITLE_LENGTH) {
        errors.push(`title「${title.slice(0, MAX_GENERATED_TITLE_LENGTH + 10)}」过长（${title.length} 字，上限 ${MAX_GENERATED_TITLE_LENGTH}）`)
        continue
      }
    } else if (!expectedTitles.has(title)) {
      errors.push(`出现输入中没有的工具名「${title.slice(0, 40)}」`)
      continue
    }
    const content = item.content.trim()
    if (!content) {
      errors.push(`工具「${title.slice(0, 40)}」内容为空`)
      continue
    }
    if (content.length > MAX_TOOL_POLISH_CONTENT) {
      errors.push(`工具「${title.slice(0, 40)}」内容过长（${content.length} 字符，上限 ${MAX_TOOL_POLISH_CONTENT}）`)
      continue
    }
    if (seen.has(title)) {
      errors.push(`工具「${title.slice(0, 40)}」重复输出`)
      continue
    }
    seen.add(title)
    matched.set(title, content)
  }
  if (!generating) {
    for (const item of expected) {
      const title = item.title.trim()
      if (title && !matched.has(title)) errors.push(`缺少工具「${title.slice(0, 40)}」`)
    }
  }
  return { matched, errors }
}

/** 合并加工结果：through 校验的工具用 AI 版，其余保留三库原文（纯函数）。 */
export function mergePolishResults<T extends PolishTool>(inputTools: T[], matched: Map<string, string>): T[] {
  return inputTools.map(tool => {
    const polished = matched.get(tool.title.trim())
    return polished ? { ...tool, content: polished } : tool
  })
}

export type PolishCallFn = (attempt: number, previous?: PolishAttemptResult) => Promise<PolishAttemptResult>

/**
 * 带重试的加工循环（纯编排，可注入调用器直接单测）：
 * 最多 MAX_TOOL_POLISH_ATTEMPTS 次尝试；任一次全部通过立即返回；
 * 耗尽后按「已通过项用 AI 版、其余回退原文」合并返回。
 */
export async function runPolishWithRetry<T extends PolishTool>(
  inputTools: T[],
  callOnce: PolishCallFn
): Promise<{ tools: T[], attempts: number }> {
  const cumulative = new Map<string, string>()
  let previous: PolishAttemptResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= MAX_TOOL_POLISH_ATTEMPTS; attempt++) {
    attempts = attempt
    const result = await callOnce(attempt, previous)
    for (const [title, content] of result.matched) cumulative.set(title, content)
    if (!result.errors.length) return { tools: mergePolishResults(inputTools, cumulative), attempts }
    previous = result
    if (attempt < MAX_TOOL_POLISH_ATTEMPTS) await sleep(RETRY_DELAY_MS)
  }
  return { tools: mergePolishResults(inputTools, cumulative), attempts }
}

/**
 * 带重试的「无工具生成」循环（纯编排，可注入调用器直接单测）。
 * 与 runPolishWithRetry 语义一致（最多 MAX_TOOL_POLISH_ATTEMPTS 次、失败带
 * 反馈重试、间隔 1s），差异只在装配：模式 B 没有可回退的三库原文，成功即返回
 * 本次全过校验的生成项；耗尽时返回各尝试累计且通过校验的生成项（先到先得，
 * 并按 MAX_GENERATED_TOOLS 截断），无通过项则返回空数组。
 */
export async function runGeneratedPolishRetry(
  callOnce: PolishCallFn
): Promise<{ tools: PolishTool[], attempts: number }> {
  const cumulative = new Map<string, string>()
  let previous: PolishAttemptResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= MAX_TOOL_POLISH_ATTEMPTS; attempt++) {
    attempts = attempt
    const result = await callOnce(attempt, previous)
    for (const [title, content] of result.matched) cumulative.set(title, content)
    if (!result.errors.length) {
      const tools = [...result.matched].map(([title, content]) => ({ title, content }))
      return { tools, attempts }
    }
    previous = result
    if (attempt < MAX_TOOL_POLISH_ATTEMPTS) await sleep(RETRY_DELAY_MS)
  }
  const tools = [...cumulative.entries()]
    .slice(0, MAX_GENERATED_TOOLS)
    .map(([title, content]) => ({ title, content }))
  return { tools, attempts }
}

/**
 * 同步入口：对工具库匹配结果做 AI 加工（模式 A）；无匹配工具时依据知识库检索
 * 片段生成新建议（模式 B）。
 *  - 无 deepseekApiKey：原样返回（与现状一致，调用方无需区分）。
 *  - knowledgeQuery 非空且 embedding 可用：先做向量检索（最多 5 段），片段与
 *    tools 共同并入 facts；检索不可用（未启用/向量为空/任何异常）一律降级为
 *    空片段，不抛错。
 *  - 无工具且无检索命中：直接返回 []（不调 AI）。
 *  - 有工具：模式 A，最多 3 次尝试，全部失败逐项回退原文；无工具但有知识命中：
 *    模式 B 生成 1..MAX_GENERATED_TOOLS 条，耗尽时保留通过校验的生成项。
 * 全程不抛出、不阻塞方案生成。
 */
export async function polishToolSteps<T extends PolishTool>(
  event: H3Event,
  input: ToolPolishInput & { tools: T[] }
): Promise<T[]> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return input.tools

  // 知识库向量检索（模式 A 的常规步骤，模式 B 无工具时同样执行）。
  // 任何失败都降级为空片段，避免检索故障阻断主流程。
  let chunks: KnowledgeSearchResult[] = []
  const knowledgeQuery = input.knowledgeQuery?.trim()
  if (knowledgeQuery && config.embeddingEnabled) {
    try {
      const embedding = await embedModuleResourceQuery(event, knowledgeQuery)
      if (embedding && embedding.length > 0) {
        chunks = await searchKnowledgeChunks(useDb(event), embedding, {
          module: input.module,
          minSimilarity: 0.45,
          limit: 5
        })
      }
    } catch (error) {
      console.warn('[tool-step-polish] 知识库向量检索不可用，跳过知识片段：',
        error instanceof Error ? error.message : error)
      chunks = []
    }
  }
  // 无工具且知识库无命中：没有可改写也没有可生成的内容，直接返回（不调 AI）
  if (input.tools.length === 0 && chunks.length === 0) return []

  const rt = await getAiRuntimeConfig(event)
  const model = rt.generatorModel || config.deepseekGeneratorModel
  const facts = {
    module: input.module,
    moduleTitle: moduleMeta[input.module].title,
    severity: input.severity,
    attributions: input.attributions || [],
    tools: input.tools.map(tool => ({ title: tool.title, content: tool.content })),
    knowledgeChunks: chunks.map(chunk => ({
      documentTitle: chunk.documentTitle,
      heading: chunk.heading,
      content: chunk.content.slice(0, KNOWLEDGE_CHUNK_MAX_LENGTH),
      similarity: Number(chunk.similarity.toFixed(4))
    }))
  }
  const jsonFormat = JSON.stringify(toolPolishFormatExample())

  const timeoutMs = rt.timeoutMs || Math.max(Number(config.deepseekTimeoutMs) || 0, SINGLE_ATTEMPT_TIMEOUT_FLOOR_MS)
  const callOnce: PolishCallFn = async (attempt, previous) => {
    const startedAt = Date.now()
    try {
      const feedback = previous
        ? `\n\n上次输出校验未通过：${previous.errors.join('；')}\n上次输出原文（请修正后重新输出）：\n${previous.raw || ''}`
        : ''
      const prompt = await renderPrompt(event, 'tool_step_polish', {
        facts: JSON.stringify(facts),
        jsonFormat,
        feedback
      })
      const messages: Array<{ role: 'system' | 'user', content: string }> = []
      if (prompt.system) messages.push({ role: 'system', content: prompt.system })
      if (prompt.user) messages.push({ role: 'user', content: prompt.user })
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.35
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number, completion_tokens?: number }
      }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      const parsed = parsePolishOutput(content, input.tools)
      await recordToolPolishCall(event, input, model, parsed.errors.length === 0 ? 'success' : 'failed', Date.now() - startedAt, json.usage?.prompt_tokens, json.usage?.completion_tokens)
      return { ...parsed, raw: content }
    } catch (error) {
      await recordToolPolishCall(event, input, model, 'failed', Date.now() - startedAt, undefined, undefined, error instanceof Error ? error.message.slice(0, 80) : 'unknown')
      return { matched: new Map(), errors: [error instanceof Error ? error.message : '未知错误'], raw: undefined }
    }
  }

  // 模式 A（有工具）：改写 + 原文回退（原逻辑）；模式 B（无工具）：知识生成
  if (input.tools.length === 0) {
    const { tools } = await runGeneratedPolishRetry(callOnce)
    // 本分支调用方传入的是空工具数组，T 的运行时形状即 PolishTool；生成的
    // { title, content } 完全满足 PolishTool，窄化仅为满足泛型签名。
    return tools as T[]
  }
  const { tools } = await runPolishWithRetry(input.tools, callOnce)
  return tools
}

function toolPolishFormatExample() {
  return {
    tools: [
      {
        title: '结构化沟通三步法',
        content: '先让两个孩子分开，各自冷静几分钟，等两个人都平静下来再聊。你可以这样开口：“我们先停一下，喝口水，过会儿再聊。”\n然后分别问问他俩刚才发生了什么，注意只听、不评判。\n最后跟他们约好：下次再有争执，先来找你，等双方情绪平稳后再商量。'
      }
    ]
  }
}

/** 每次尝试各记一条审计（与 assessment_report 同模式：失败不阻断调用链）。 */
async function recordToolPolishCall(
  event: H3Event,
  input: ToolPolishInput,
  model: string,
  status: 'success' | 'failed',
  latencyMs: number,
  promptTokens?: number,
  completionTokens?: number,
  errorCode?: string
) {
  await useDb(event).insert(schema.aiModelCalls).values({
    schoolId: input.schoolId,
    ownerUserId: input.ownerUserId,
    provider: 'deepseek',
    model,
    purpose: 'tool_step_polish',
    status,
    latencyMs,
    promptTokens,
    completionTokens,
    errorCode
  }).catch(() => undefined)
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
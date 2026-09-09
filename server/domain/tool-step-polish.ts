// 工具步骤 / 归因行动的 AI 加工（后台调用，由 plan-action-enhancement 编排）
//
// 目标：把工具库匹配出的结构化步骤（"1. 标题: 说明 + 提示/话术/达标" 机械条目）
// 与归因建议行动改写成「人话版」——教师看了能直接照着执行的口语化内容，工具名与
// 步骤数量/顺序/关键事实不变；当没有匹配工具但知识库向量检索有命中间接指导时，
// 改为依据 knowledgeChunks 生成 1..MAX_GENERATED_TOOLS 条新建议（title 为
// AI 自拟，与模式 A 的 title 必须来自输入不同）。
//
// 设计要点：
//   - 后台调用：由 plan-action-enhancement 在提交事务返回后执行，教师端进方案页
//     等待（ai_actions_status=pending），完成后回写正文；本函数本身不写 plans。
//   - 全覆盖（complete）：模式 A 要求每个工具、每条行动都被 AI 改写命中，模式 B
//     要求行动全部命中且（有知识片段时）生成了工具；任一条目未被覆盖即
//     complete=false，调用方不得写入部分结果，也不再用三库原文兜底。
//   - 双模式：模式 A（expected 非空）把已有工具改写成人话版；模式 B（expected
//     为空、无工具）依据检索片段生成新建议，title/content 由 AI 自拟并经
//     独立校验（见 parsePolishOutput）。
//   - actions 同车加工：归因建议行动（actions，title/条数来自输入，detail 为
//     一句话建议）与 tools 在一次调用内共同输出，逐条改写为可执行步骤；
//     校验违规计入同一 errors 并触发重试。
//   - 重试：格式类一过性错误（JSON 解析失败、结构校验不过）最多重试 3 次
//     （含首次），重试时把上次输出与校验错误附给模型修正；耗尽后仍未覆盖的
//     条目只影响 complete 标记，不写入原文兜底。
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
  /** 归因建议行动：标题如「针对「意义感流失」」，detail 为一句建议；与 tools 一起
   * 交 AI 逐条改写，加工后 title 不变、content 为可执行步骤，失败回退原文 detail */
  actions?: Array<{ title: string, detail: string, code?: string }>
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
const RETRY_DELAY_MS = 3000
/**
 * 单次尝试的超时下限。实测单次提交含 9-13 个工具 + 建议 + 知识片段时耗时 26-30s，
 * 恰在 30s 上限边缘，导致高频超时回退原文；提高到 60s 与实测波动匹配（不再依赖
 * DEEPSEEK_TIMEOUT_MS=30000 的全局值——该值经 Math.max 参与计算，floor 提高后
 * 本调用点取 60s，不影响报告（360s 下限）/澄清（小超时固定）等其他调用点）。
 */
const SINGLE_ATTEMPT_TIMEOUT_FLOOR_MS = 60_000

// tools 保持必填：缺 tools 字段时按「结构校验失败」处理（历史语义，见单测）；
// actions 与 tools 同构但可选（输出可只有 tools，actions 缺省为空数组）。
const toolPolishOutputSchema = z.object({
  tools: z.array(z.object({
    title: z.string(),
    content: z.string()
  })),
  actions: z.array(z.object({
    title: z.string(),
    content: z.string()
  })).optional().default([])
})

export interface PolishAttemptResult {
  /** 本次尝试中通过校验的工具（title → 加工后 content） */
  matched: Map<string, string>
  /** 本次尝试中通过校验的 actions（title → 加工后 content）；parsePolishOutput
   *  未收到 expectedActions 时返回空 Map，外部注入的尝试结果可缺省（按空 Map 处理） */
  actionsMatched?: Map<string, string>
  /**
   * actions 按输入顺序的加工结果（仅保留通过校验的条目，顺序与输入一致）。
   * 用于支持同名多条 action（如分级干预「按「…」干预」）——标题匹配会因重名
   * 相互覆盖/判重复，这里按位置对号，配套 parsePolishOutput/runPolishWithRetry
   * 返回有序结果。未收到 expectedActions 时缺省。
   */
  actionContents?: Array<{ title: string, content: string }>
  /** 校验错误摘要（tools 与 actions 违规计入同一数组）；为空表示本次尝试全部通过 */
  errors: string[]
  /** 本次尝试的原始输出（重试时反馈给模型修正） */
  raw?: string
}

/**
 * 解析模型输出并逐项关联回输入（纯函数，工具双模式 + 可选 actions 加工）：
 *  - 模式 A（expected 非空）：改写已有工具——数量必须与输入一致、title 必须
 *    匹配输入工具、content 非空且 ≤ MAX_TOOL_POLISH_CONTENT。
 *  - 模式 B（expected 为空、options.generateTools 非 false）：无工具生成——不存在
 *    「输入中没有的工具名」概念，title 为 AI 自拟，需 trim 后非空且
 *    ≤ MAX_GENERATED_TITLE_LENGTH、不得重复；content 非空且 ≤ MAX_TOOL_POLISH_CONTENT；
 *    数量限制 1..MAX_GENERATED_TOOLS（0 条或超出都计入 errors）。
 *  - options.generateTools === false（expected 必须为空）：只改写行动，tools 必须
 *    输出空数组（无匹配工具且知识库无可检索片段时使用）。
 *  - actions 加工（仅当 expectedActions 传入时启用）：数量必须等于输入、title
 *    必须匹配输入 action、content 非空且 ≤ MAX_TOOL_POLISH_CONTENT；违规与
 *    tools 计入同一 errors（错误文案风格与工具侧一致）。第三参缺省时完全不
 *    处理 actions（返回空 actionsMatched），tools 行为与之前完全一致。
 * 任何一项不合法都进入 errors（触发重试），合法的部分仍通过 matched /
 * actionsMatched 保留，供调用方按覆盖率决定是否采用。
 */
export function parsePolishOutput(
  rawText: string,
  expected: Array<{ title: string }>,
  expectedActions?: Array<{ title: string }>,
  options?: { generateTools?: boolean }
): PolishAttemptResult {
  const matched = new Map<string, string>()
  const actionsMatched = new Map<string, string>()
  const actionContents: Array<{ title: string, content: string }> = []
  const errors: string[] = []
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    return { matched, actionsMatched, errors: ['模型输出不是合法 JSON'] }
  }
  const parsed = toolPolishOutputSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5)
      .map(issue => `${issue.path.join('.') || 'root'} ${issue.message}`)
      .join('；')
    return { matched, actionsMatched, errors: [`输出结构校验失败：${issues}`] }
  }
  const outputTools = parsed.data.tools
  const outputActions = parsed.data.actions
  // 模式 B：expected 为空时默认按「无工具生成」处理（title 全部 AI 自拟）；
  // 调用方明确传 generateTools: false 时退化为「只改写行动、tools 必须输出空数组」，
  // 用于「无匹配工具且知识库无可检索片段」的场景。
  const generating = options?.generateTools ?? (expected.length === 0)
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
  // actions 逐条校验：仅当调用方提供 expectedActions 时启用；缺省时完全不
  // 处理 actions，保持既有 tools-only 语义不变。
  // 匹配按「位置对号」（非标题）：同一等级可能有多条同名动作（如分级干预
  // 「按「…」干预」），按标题匹配会因重名相互覆盖/判重复。模型被要求保持
  // 条数与顺序一致（见提示词 2a），这里校验 outputActions[i] 的标题必须等于
  // expectedActions[i] 的标题、内容非空且 ≤ MAX_TOOL_POLISH_CONTENT。
  if (expectedActions) {
    if (outputActions.length !== expectedActions.length) {
      errors.push(`actions 数量 ${outputActions.length}，应为 ${expectedActions.length}`)
    }
    for (let index = 0; index < expectedActions.length; index++) {
      const expectedAction = expectedActions[index]
      const output = outputActions[index]
      if (!expectedAction || !output) continue
      const expectedTitle = expectedAction.title.trim()
      const title = output.title.trim()
      if (title !== expectedTitle) {
        errors.push(`第 ${index + 1} 条 action「${title.slice(0, 40)}」标题与输入不一致（应为「${expectedTitle.slice(0, 40)}」）`)
        continue
      }
      const content = output.content.trim()
      if (!content) {
        errors.push(`action「${title.slice(0, 40)}」内容为空`)
        continue
      }
      if (content.length > MAX_TOOL_POLISH_CONTENT) {
        errors.push(`action「${title.slice(0, 40)}」内容过长（${content.length} 字符，上限 ${MAX_TOOL_POLISH_CONTENT}）`)
        continue
      }
      actionContents.push({ title, content })
      actionsMatched.set(title, content)
    }
  }
  return { matched, actionsMatched, actionContents, errors }
}

/** 合并加工结果：through 校验的工具用 AI 版，其余保留三库原文（纯函数）。 */
export function mergePolishResults<T extends PolishTool>(inputTools: T[], matched: Map<string, string>): T[] {
  return inputTools.map(tool => {
    const polished = matched.get(tool.title.trim())
    return polished ? { ...tool, content: polished } : tool
  })
}

/** 合并 actions 加工结果：through 校验的 action 用 AI 版映射到 detail，其余保留原文（与 mergePolishResults 同构，纯函数）。 */
export function mergeActionResults<T extends { title: string, detail: string }>(
  inputActions: T[],
  matched: Map<string, string>
): T[] {
  return inputActions.map(action => {
    const polished = matched.get(action.title.trim())
    return polished ? { ...action, detail: polished } : action
  })
}

export type PolishCallFn = (attempt: number, previous?: PolishAttemptResult) => Promise<PolishAttemptResult>

/** 把通过校验的 actions（title → content）按 Map 顺序转成输出数组。 */
function matchedToActions(matched: Map<string, string>): Array<{ title: string, content: string }> {
  return [...matched.entries()].map(([title, content]) => ({ title, content }))
}

/**
 * 带重试的加工循环（纯编排，可注入调用器直接单测）：
 * 最多 MAX_TOOL_POLISH_ATTEMPTS 次尝试；任一次全部通过立即返回——「全部通过」
 * 指 tools 与 actions 的校验错误都为空（两者计入同一 errors）；尝试的 matched
 * 与 actionsMatched 都会累计，耗尽后按「已通过项用 AI 版、其余保留输入原文」
 * 合并返回，并额外返回累计命中的标题集合（matchedTitles / matchedActionTitles），
 * 供调用方判断是否「全覆盖」（inputTools 为空时等价于纯 actions 场景）。
 */
export async function runPolishWithRetry<T extends PolishTool>(
  inputTools: T[],
  callOnce: PolishCallFn
): Promise<{
  tools: T[],
  actions: Array<{ title: string, content: string }>,
  attempts: number,
  matchedTitles: Set<string>,
  matchedActionTitles: Set<string>
}> {
  const cumulative = new Map<string, string>()
  const cumulativeActions = new Map<string, string>()
  let previous: PolishAttemptResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= MAX_TOOL_POLISH_ATTEMPTS; attempt++) {
    attempts = attempt
    const result = await callOnce(attempt, previous)
    for (const [title, content] of result.matched) cumulative.set(title, content)
    for (const [title, content] of result.actionsMatched ?? new Map()) cumulativeActions.set(title, content)
    // errors 同时覆盖 tools 与 actions 的校验结果，为空即两者全部通过
    if (!result.errors.length) {
      return {
        tools: mergePolishResults(inputTools, cumulative),
        // 优先取按输入顺序的加工结果（支持同名多条 action）；外部注入未提供时回到标题 map
        actions: result.actionContents ?? matchedToActions(result.actionsMatched ?? new Map()),
        attempts,
        matchedTitles: new Set(cumulative.keys()),
        matchedActionTitles: new Set(cumulativeActions.keys())
      }
    }
    previous = result
    if (attempt < MAX_TOOL_POLISH_ATTEMPTS) await sleep(RETRY_DELAY_MS)
  }
  return {
    tools: mergePolishResults(inputTools, cumulative),
    actions: matchedToActions(cumulativeActions),
    attempts,
    matchedTitles: new Set(cumulative.keys()),
    matchedActionTitles: new Set(cumulativeActions.keys())
  }
}

/**
 * 带重试的「无工具生成」循环（纯编排，可注入调用器直接单测）。
 * 与 runPolishWithRetry 语义一致（最多 MAX_TOOL_POLISH_ATTEMPTS 次、失败带
 * 反馈重试、间隔 3s），差异只在装配：模式 B 没有可回退的三库原文，成功即返回
 * 本次全过校验的生成项；耗尽时返回各尝试累计且通过校验的生成项（先到先得，
 * 并按 MAX_GENERATED_TOOLS 截断），无通过项则返回空数组。tools 与 actions 在
 * 同一次调用中产出（「通过」指两者的校验错误都为空），actions 累计不截断——
 * 条数由输入决定，无 AI 自拟数量上限。返回的 matchedTitles / matchedActionTitles
 * 为累计命中集合，供调用方判断 actions 是否全覆盖。
 */
export async function runGeneratedPolishRetry(
  callOnce: PolishCallFn
): Promise<{
  tools: PolishTool[],
  actions: Array<{ title: string, content: string }>,
  attempts: number,
  matchedTitles: Set<string>,
  matchedActionTitles: Set<string>
}> {
  const cumulative = new Map<string, string>()
  const cumulativeActions = new Map<string, string>()
  let previous: PolishAttemptResult | undefined
  let attempts = 0
  for (let attempt = 1; attempt <= MAX_TOOL_POLISH_ATTEMPTS; attempt++) {
    attempts = attempt
    const result = await callOnce(attempt, previous)
    for (const [title, content] of result.matched) cumulative.set(title, content)
    for (const [title, content] of result.actionsMatched ?? new Map()) cumulativeActions.set(title, content)
    if (!result.errors.length) {
      const tools = [...result.matched].map(([title, content]) => ({ title, content }))
      // actionContents 为按输入顺序的加工结果（支持同名多条 action）；未提供时回到标题 map
      const actions = result.actionContents ?? matchedToActions(result.actionsMatched ?? new Map())
      return {
        tools,
        actions,
        attempts,
        matchedTitles: new Set(result.matched.keys()),
        matchedActionTitles: new Set(result.actionsMatched?.keys() ?? [])
      }
    }
    previous = result
    if (attempt < MAX_TOOL_POLISH_ATTEMPTS) await sleep(RETRY_DELAY_MS)
  }
  const tools = [...cumulative.entries()]
    .slice(0, MAX_GENERATED_TOOLS)
    .map(([title, content]) => ({ title, content }))
  const actions = matchedToActions(cumulativeActions)
  return {
    tools,
    actions,
    attempts,
    matchedTitles: new Set(cumulative.keys()),
    matchedActionTitles: new Set(cumulativeActions.keys())
  }
}

/**
 * 同步入口：对工具库匹配结果做 AI 加工（模式 A）；无匹配工具时依据知识库检索
 * 片段生成新建议（模式 B）；归因建议行动（actions，title/条数来自输入）与 tools
 * 在同一次调用中加工，两种模式（tools 空/非空）下都被处理。
 *  - 无 deepseekApiKey：原样返回（tools 保持原文，actions 用原文 detail 填充
 *    content），complete=true（AI 未启用，无重试意义）。
 *  - knowledgeQuery 非空且 embedding 可用：先做向量检索（最多 5 段），片段与
 *    tools、actions 共同并入 facts；检索不可用（未启用/向量为空/任何异常）一律
 *    降级为空片段，不抛错。
 *  - tools、actions、知识片段皆空：不调 AI，返回空 tools 与空 actions，
 *    complete=true（没有需要 AI 输出的条目）。
 *  - 有工具：模式 A，最多 3 次尝试；无工具但有知识命中或待加工 actions：模式 B。
 *  - complete：模式 A 要求每个工具、每条行动都被 AI 改写命中；模式 B 要求行动
 *    全部命中且（有知识片段时）生成了工具。未全覆盖时调用方不得写入部分结果。
 * 返回 { tools, actions, complete }：actions 的 content 为 AI 改写后的可执行步骤，
 * title 与输入一致（未命中项由调用方按 complete 决定是否采用）。全程不抛出。
 */
export async function polishToolSteps<T extends PolishTool>(
  event: H3Event,
  input: ToolPolishInput & { tools: T[] }
): Promise<{ tools: T[], actions: Array<{ title: string, content: string }>, complete: boolean }> {
  const config = useRuntimeConfig(event)
  const inputActions = input.actions ?? []
  // 无密钥：原样返回（AI 未启用，没有可等待的改写）
  if (!config.deepseekApiKey) {
    return {
      tools: input.tools,
      actions: inputActions.map(action => ({ title: action.title, content: action.detail })),
      complete: true
    }
  }

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
  // tools、actions、知识片段全空：没有可改写也没有可生成的内容，直接返回（不调 AI）
  if (input.tools.length === 0 && inputActions.length === 0 && chunks.length === 0) {
    return {
      tools: input.tools,
      actions: inputActions.map(action => ({ title: action.title, content: action.detail })),
      complete: true
    }
  }

  const rt = await getAiRuntimeConfig(event)
  const model = rt.generatorModel || config.deepseekGeneratorModel
  // 只有检索到知识片段才让模型自拟新工具；既无匹配工具也无片段时退化为
  // 「只改写行动、tools 输出空数组」，避免模型凭空编造工具。
  const generateTools = input.tools.length === 0 && chunks.length > 0
  const facts = {
    module: input.module,
    moduleTitle: moduleMeta[input.module].title,
    severity: input.severity,
    attributions: input.attributions || [],
    tools: input.tools.map(tool => ({ title: tool.title, content: tool.content })),
    actions: inputActions.map(action => ({ title: action.title, content: action.detail })),
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
      // actions 为空时第三参传 undefined：不启用 actions 校验，行为与之前一致
      const parsed = parsePolishOutput(
        content,
        input.tools,
        inputActions.length > 0 ? inputActions : undefined,
        { generateTools }
      )
      await recordToolPolishCall(event, input, model, parsed.errors.length === 0 ? 'success' : 'failed', Date.now() - startedAt, json.usage?.prompt_tokens, json.usage?.completion_tokens)
      return { ...parsed, raw: content }
    } catch (error) {
      await recordToolPolishCall(event, input, model, 'failed', Date.now() - startedAt, undefined, undefined, error instanceof Error ? error.message.slice(0, 80) : 'unknown')
      return { matched: new Map(), actionsMatched: new Map(), errors: [error instanceof Error ? error.message : '未知错误'], raw: undefined }
    }
  }

  // 模式 A（有工具）：改写已有工具；模式 B（无工具）：知识生成 + actions 加工。
  // 两种模式下 actions 都在同一次调用内校验并累计；complete 标记是否全部覆盖，
  // 未覆盖的条目由调用方按 complete 决定是否采用（此处不再回退三库原文）。
  let polishedTools: T[]
  let polishedActions: Array<{ title: string, content: string }>
  let complete: boolean
  if (input.tools.length === 0) {
    const { tools, actions, matchedActionTitles } = await runGeneratedPolishRetry(callOnce)
    // 本分支调用方传入的是空工具数组，T 的运行时形状即 PolishTool；生成的
    // { title, content } 完全满足 PolishTool，窄化仅为满足泛型签名。
    polishedTools = tools as T[]
    polishedActions = actions
    // 模式 B 的 tools 由 AI 生成、不存在「覆盖输入」问题：只要待加工行动全部命中，
    // 且确实处于「生成工具」模式时生成了工具，即视为完整。
    complete = inputActions.every(action => matchedActionTitles.has(action.title.trim()))
      && (!generateTools || polishedTools.length > 0)
  } else {
    const { tools, actions, matchedTitles, matchedActionTitles } = await runPolishWithRetry(input.tools, callOnce)
    polishedTools = tools
    polishedActions = actions
    complete = input.tools.every(tool => matchedTitles.has(tool.title.trim()))
      && inputActions.every(action => matchedActionTitles.has(action.title.trim()))
  }
  return { tools: polishedTools, actions: polishedActions, complete }
}

function toolPolishFormatExample() {
  return {
    tools: [
      {
        title: '结构化沟通三步法',
        content: '先让两个孩子分开，各自冷静几分钟，等两个人都平静下来再聊。你可以这样开口：“我们先停一下，喝口水，过会儿再聊。”\n然后分别问问他俩刚才发生了什么，注意只听、不评判。\n最后跟他们约好：下次再有争执，先来找你，等双方情绪平稳后再商量。'
      }
    ],
    actions: [
      {
        title: '针对「意义感流失」',
        content: '每周五下班前用 10 分钟做一次周复盘：写下这周最有成就感的 1 件事和当时的做法，存进手机备忘录。\n连续 4 周后把重复出现的做法提炼成自己的「能量清单」，状态低落时直接照做。\n如果连续 2 周找不到任何有成就感的事，找一次你信任的同事聊聊，把感受说出来。'
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
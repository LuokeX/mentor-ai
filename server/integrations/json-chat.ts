/**
 * 「让模型输出 JSON」的统一调用层。
 *
 * 背景（2026-09 审查）：评估报告、工具步骤改写、量表推荐、语义安全四处各自手写
 * fetch + 解析 + 重试 + 审计，行为随迭代分叉——有的不查 finish_reason、有的不设
 * 输出上限、语义安全失败完全静默、error_code 格式各不相同（无法按原因聚合重试）。
 * 本文件把这层收敛到一处：JSON Output、显式 max_tokens、截断判定、前缀化错误码、
 * 调用审计统一交由此处处理。
 *
 * 事实依据（DeepSeek 官方 Chat Completions 文档，2026-09 核对）：
 *   - response_format 只有 text | json_object，没有 OpenAI 的 json_schema，
 *     所以「把 schema 交给 API 强制」在这家模型上不存在；
 *   - 用 json_object 时必须自己通过 system/user 消息指示模型输出 JSON，
 *     否则模型可能一直吐空白直到 token 上限（本文件对提示词缺 "json" 字样只告警）；
 *   - finish_reason=length 表示输出被 max_tokens 截断，content 可能不完整，
 *     必须单独判定，否则会被当成「JSON 结构不对」误导排查与重试方向；
 *   - 思考模式下 temperature 无效，reasoning token 也计入 completion_tokens，
 *     因此 max_tokens 不能按正文长度估算；
 *   - tools[].function.strict（Beta）是唯一能锁 JSON Schema 的通道，但 tool_choice 的
 *     required/具名形式在思考模式下直接 400，必须先关思考。
 *
 * 默认通道与既有行为一致（json_object）；strict 通道是显式可回退的试点，由
 * AI_STRICT_JSON_PURPOSES 按 purpose 开启，strict 不可用时自动回退 json_object。
 */
import type { H3Event } from 'h3'
import { z } from 'zod'
import { schema, useDb } from '../utils/db'

/** ai_model_calls.error_code 列宽 80：前缀 + 摘要在此截断。 */
const ERROR_CODE_MAX = 80

/**
 * 校验失败信息：Zod 报错只保留「原因 + 字段路径 + 上限」，路径排在前面。
 *
 * 背景：error_code 列宽 80，原先写的是 `error.message`（整段 Zod issues JSON），
 * 被截断后只剩一段花括号，2026-08 的报告生成失败因此一直查不出是哪个字段超限。
 * 同样的字符串也会作为「上次输出未通过校验」回喂给模型重试，结构化短文本比 JSON 更好修。
 * 导出供测试固定格式：路径必须排在截断之前的位置。
 */
export function compactValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 3).map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)'
      const limit = 'maximum' in issue && typeof issue.maximum === 'number' ? ` max=${issue.maximum}`
        : 'minimum' in issue && typeof issue.minimum === 'number' ? ` min=${issue.minimum}`
          : ''
      return `${issue.code} ${path}${limit}`
    }).join('; ')
  }
  return error instanceof Error ? error.message : 'unknown'
}

export type JsonChatChannel = 'json_object' | 'strict_tool'

/**
 * 失败分类（同时决定 error_code 前缀，供 AI 中心按原因聚合）：
 *   timeout / http / empty / truncated / parse / schema / strict
 */
export type JsonChatFailureKind = 'timeout' | 'http' | 'empty' | 'truncated' | 'parse' | 'schema' | 'strict'

export interface JsonChatFailure {
  kind: JsonChatFailureKind
  /** 前缀化短码，直接写入 ai_model_calls.error_code */
  errorCode: string
  /** 人类可读说明；也会作为重试反馈回喂模型 */
  message: string
  httpStatus?: number
}

export interface JsonChatTokenUsage {
  promptTokens?: number
  completionTokens?: number
}

export interface JsonChatMessage {
  role: 'system' | 'user'
  content: string
}

/**
 * strict 结构化输出通道（DeepSeek Beta）。parameters 为 JSON Schema，
 * strict 模式要求 additionalProperties:false 且所有字段列入 required。
 */
export interface JsonChatToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface JsonChatParseResult<T> {
  value: T
  /** 非空表示本次输出不合格：触发重试，审计状态默认记 failed */
  errors?: string[]
  /** 覆盖审计状态（量表推荐用它区分 success / fallback） */
  auditStatus?: 'success' | 'failed' | 'fallback'
}

export interface JsonChatAuditContext {
  schoolId?: string | null
  ownerUserId?: string | null
  sessionId?: string | null
}

export interface CallJsonChatOptions<T> {
  event: H3Event
  /** ai_model_calls.purpose，同时作为 strict 试点开关的匹配键 */
  purpose: string
  model: string
  messages: JsonChatMessage[]
  /** 显式输出上限（思考模式下含 reasoning token，不能按正文长度估算） */
  maxTokens: number
  timeoutMs: number
  temperature?: number
  /** 不传即沿用服务端默认（思考开启）；strict 通道要求显式 disabled */
  thinking?: 'enabled' | 'disabled'
  /** strict 通道定义；仅当该 purpose 在 AI_STRICT_JSON_PURPOSES 中时才实际启用 */
  tool?: JsonChatToolSpec
  /** 解析与校验；缺省时 data 为原始文本 */
  parse?: (content: string) => JsonChatParseResult<T>
  audit?: JsonChatAuditContext
}

export interface JsonChatOutcome<T> {
  ok: boolean
  /** 解析结果；校验未通过（errors 非空）时仍可能带值，供调用方累积使用 */
  data?: T
  failure?: JsonChatFailure
  usage?: JsonChatTokenUsage
  finishReason?: string | null
  channel: JsonChatChannel
}

export interface CallJsonChatWithRetryOptions<T> extends CallJsonChatOptions<T> {
  /** 总尝试次数（含首次） */
  attempts: number
  retryDelayMs?: number
  /** 失败后的反馈消息（只作用于下一次尝试，不落库、不进历史） */
  buildFeedback?: (failure: JsonChatFailure, attempt: number) => string | null
}

export interface JsonChatRetryOutcome<T> {
  ok: boolean
  data?: T
  attempts: number
  failure?: JsonChatFailure
  usage?: JsonChatTokenUsage
  channel: JsonChatChannel
}

/** 单次响应里我们用到的字段（其余由 DeepSeek 决定，不做校验）。 */
interface ChatCompletionChoice {
  finish_reason?: string | null
  message?: {
    content?: string | null
    tool_calls?: Array<{ function?: { name?: string, arguments?: string } }>
  }
}

interface ChatCompletionPayload {
  choices?: ChatCompletionChoice[]
  usage?: { prompt_tokens?: number, completion_tokens?: number }
}

/** error_code 前缀化：`<kind>:<detail>`，超长在此截断。 */
export function buildJsonChatErrorCode(kind: JsonChatFailureKind, detail: string): string {
  const text = detail.replace(/\s+/g, ' ').trim()
  return `${kind}:${text}`.slice(0, ERROR_CODE_MAX)
}

/**
 * strict tool calling 试点开关：AI_STRICT_JSON_PURPOSES 为逗号分隔的 purpose 列表。
 * 空（默认）＝ 全部走 json_object，与既有行为完全一致；列出的 purpose 才尝试 strict。
 */
export function strictJsonPurposes(event: H3Event): string[] {
  const config = useRuntimeConfig(event)
  const raw = typeof config.aiStrictJsonPurposes === 'string' ? config.aiStrictJsonPurposes : ''
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

export function isStrictJsonPurpose(event: H3Event, purpose: string): boolean {
  return strictJsonPurposes(event).includes(purpose)
}

/** strict 通道不可用时是否值得回退 json_object：协议不支持（400/404/422）或模型没按工具调用。 */
function shouldFallbackFromStrict(failure?: JsonChatFailure): boolean {
  if (!failure) return false
  if (failure.kind === 'strict') return true
  return failure.kind === 'http' && [400, 404, 422].includes(failure.httpStatus ?? 0)
}

function classifyFetchError(error: unknown, timeoutMs: number): JsonChatFailure {
  const name = error instanceof Error ? error.name : ''
  const text = error instanceof Error ? error.message : String(error)
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|aborted/i.test(text)) {
    return {
      kind: 'timeout',
      errorCode: buildJsonChatErrorCode('timeout', `${timeoutMs}ms`),
      message: `模型调用超时（${timeoutMs}ms）`
    }
  }
  return {
    kind: 'http',
    errorCode: buildJsonChatErrorCode('http', text || 'fetch failed'),
    message: `模型调用失败：${text || '网络错误'}`
  }
}

/** json_object 模式的前置条件（官方要求消息里自行指示输出 JSON）：缺失只告警不改行为。 */
function warnIfPromptLacksJson<T>(options: CallJsonChatOptions<T>) {
  const joined = options.messages.map(item => item.content).join('\n')
  if (!/json/i.test(joined)) {
    console.warn(`[json-chat] ${options.purpose} 提示词里没有出现 "json" 字样，json_object 模式可能返回空白流`)
  }
}

/** 单次尝试（不做重试、不跨通道回退）。 */
async function performJsonChat<T>(options: CallJsonChatOptions<T> & { channel: JsonChatChannel }): Promise<JsonChatOutcome<T>> {
  const config = useRuntimeConfig(options.event)
  const startedAt = Date.now()
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.35
  }
  if (options.thinking) body.thinking = { type: options.thinking }

  if (options.channel === 'strict_tool' && options.tool) {
    body.tools = [{
      type: 'function',
      function: {
        name: options.tool.name,
        description: options.tool.description,
        parameters: options.tool.parameters,
        strict: true
      }
    }]
    body.tool_choice = { type: 'function', function: { name: options.tool.name } }
  } else {
    body.response_format = { type: 'json_object' }
    warnIfPromptLacksJson(options)
  }

  const record = async (
    status: 'success' | 'failed' | 'fallback',
    failure?: JsonChatFailure,
    usage?: JsonChatTokenUsage
  ) => {
    await useDb(options.event).insert(schema.aiModelCalls).values({
      schoolId: options.audit?.schoolId ?? null,
      ownerUserId: options.audit?.ownerUserId ?? null,
      sessionId: options.audit?.sessionId ?? null,
      provider: 'deepseek',
      model: options.model,
      purpose: options.purpose,
      status,
      latencyMs: Date.now() - startedAt,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      errorCode: failure?.errorCode
    }).catch(() => undefined)
  }

  const fail = async (failure: JsonChatFailure, usage?: JsonChatTokenUsage, finishReason?: string | null): Promise<JsonChatOutcome<T>> => {
    await record('failed', failure, usage)
    return { ok: false, failure, usage, finishReason, channel: options.channel }
  }

  let response: Response
  try {
    response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs)
    })
  } catch (error) {
    return fail(classifyFetchError(error, options.timeoutMs))
  }

  if (!response.ok) {
    const failure: JsonChatFailure = {
      kind: 'http',
      errorCode: buildJsonChatErrorCode('http', String(response.status)),
      message: `DeepSeek ${response.status}`,
      httpStatus: response.status
    }
    return fail(failure)
  }

  let payload: ChatCompletionPayload
  try {
    payload = await response.json() as ChatCompletionPayload
  } catch (error) {
    return fail({
      kind: 'http',
      errorCode: buildJsonChatErrorCode('http', `bad body ${response.status}`),
      message: `模型响应无法解析（HTTP ${response.status}）：${compactValidationError(error)}`,
      httpStatus: response.status
    })
  }

  const choice = payload.choices?.[0]
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  const usage: JsonChatTokenUsage = {
    promptTokens: payload.usage?.prompt_tokens,
    completionTokens: payload.usage?.completion_tokens
  }

  // strict 通道：输出在 tool_calls[0].function.arguments 里；模型没调工具即通道不可用。
  let content = ''
  if (options.channel === 'strict_tool') {
    const args = choice?.message?.tool_calls?.[0]?.function?.arguments
    if (!args) {
      return fail({
        kind: 'strict',
        errorCode: buildJsonChatErrorCode('strict', 'no_tool_call'),
        message: 'strict 通道下模型没有返回工具调用'
      }, usage, finishReason)
    }
    content = args
  } else {
    content = choice?.message?.content ?? ''
    if (!content) {
      return fail({
        kind: 'empty',
        errorCode: buildJsonChatErrorCode('empty', finishReason ? `finish=${finishReason}` : 'no content'),
        message: '模型返回了空内容'
      }, usage, finishReason)
    }
  }

  // 截断必须单独判定：content 恰好仍是合法 JSON 时，只按解析结果会漏掉「内容不全」。
  if (finishReason === 'length') {
    return fail({
      kind: 'truncated',
      errorCode: buildJsonChatErrorCode('truncated', `max_tokens=${options.maxTokens}`),
      message: `输出被 max_tokens（${options.maxTokens}）截断，请精简长度后重新输出`
    }, usage, finishReason)
  }

  if (!options.parse) {
    await record('success', undefined, usage)
    return { ok: true, data: content as unknown as T, usage, finishReason, channel: options.channel }
  }

  let parsed: JsonChatParseResult<T>
  try {
    parsed = options.parse(content)
  } catch (error) {
    // SyntaxError = JSON.parse 失败（输出不是合法 JSON）；其余按结构/业务校验失败处理。
    const kind: JsonChatFailureKind = error instanceof SyntaxError ? 'parse' : 'schema'
    const detail = compactValidationError(error)
    return fail({
      kind,
      errorCode: buildJsonChatErrorCode(kind, detail),
      message: `${kind === 'parse' ? '输出不是合法 JSON' : '输出未通过校验'}：${detail}`
    }, usage, finishReason)
  }

  const errors = parsed.errors?.filter(Boolean) ?? []
  if (errors.length) {
    const detail = errors.join('；')
    const failure: JsonChatFailure = {
      kind: 'schema',
      errorCode: buildJsonChatErrorCode('schema', detail),
      message: detail
    }
    await record(parsed.auditStatus ?? 'failed', failure, usage)
    return { ok: false, data: parsed.value, failure, usage, finishReason, channel: options.channel }
  }

  await record(parsed.auditStatus ?? 'success', undefined, usage)
  return { ok: true, data: parsed.value, usage, finishReason, channel: options.channel }
}

/**
 * 单次 JSON 调用（含 strict 试点与自动回退）。不做重试编排，重试由调用方
 * （callJsonChatWithRetry 或各自的纯函数循环）决定。
 */
export async function callJsonChat<T = string>(options: CallJsonChatOptions<T>): Promise<JsonChatOutcome<T>> {
  const wantStrict = Boolean(options.tool) && isStrictJsonPurpose(options.event, options.purpose)
  if (!wantStrict) return performJsonChat({ ...options, channel: 'json_object' })

  const strictOutcome = await performJsonChat({ ...options, channel: 'strict_tool' })
  if (strictOutcome.ok || !shouldFallbackFromStrict(strictOutcome.failure)) return strictOutcome
  // strict 是 Beta：协议不支持或模型没按工具调用时回退 json_object，回退结果只写一条审计
  console.warn(`[json-chat] ${options.purpose} strict 通道不可用（${strictOutcome.failure?.errorCode}），回退 json_object`)
  return performJsonChat({ ...options, channel: 'json_object' })
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * 带反馈重试的 JSON 调用（每次重试只带最近一次失败的反馈，不累积）。
 * 全部尝试失败时返回最后一次的失败信息；解析已产出数据时仍带在 data 上。
 */
export async function callJsonChatWithRetry<T = string>(
  options: CallJsonChatWithRetryOptions<T>
): Promise<JsonChatRetryOutcome<T>> {
  const attempts = Math.max(1, Math.floor(options.attempts))
  let last: JsonChatOutcome<T> | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const messages = [...options.messages]
    if (attempt > 1 && last?.failure && options.buildFeedback) {
      const feedback = options.buildFeedback(last.failure, attempt)
      if (feedback) messages.push({ role: 'user', content: feedback })
    }
    last = await callJsonChat<T>({ ...options, messages })
    if (last.ok) {
      return { ok: true, data: last.data, attempts: attempt, usage: last.usage, channel: last.channel }
    }
    if (attempt < attempts && options.retryDelayMs) await sleep(options.retryDelayMs)
  }
  return {
    ok: false,
    data: last?.data,
    attempts,
    failure: last?.failure,
    usage: last?.usage,
    channel: last?.channel ?? 'json_object'
  }
}

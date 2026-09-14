/**
 * Agent 化改造（P0）模型接入层。
 *
 * 与 deepseek.ts 同源读取运行时配置：apiKey / baseURL / 超时均来自
 * useRuntimeConfig(event) 的 deepseek* 字段（nuxt.config.ts runtimeConfig），
 * 模型名与超时同样取环境变量默认值（getAiRuntimeConfig 现在恒为「无覆盖」，
 * 数据库 ai_runtime_settings 已弃用）。不输出 thinking 参数，与现有 deepseek.ts 行为一致。
 */
import { ChatOpenAI } from '@langchain/openai'
import type { H3Event } from 'h3'
import { getAiRuntimeConfig } from '../domain/ai-config'

/**
 * 创建 agent 图使用的 DeepSeek ChatOpenAI 实例。
 *
 * 说明：getAiRuntimeConfig 是异步的（保留 async 签名以便将来扩展），因此本函数为 async；
 * 调用方需要 llm 时直接 await 即可。bindTools 由工具层（createReactAgent）负责，
 * 本函数只负责模型实例，不绑定工具。
 */
export async function createAgentLlm(
  event: H3Event,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<ChatOpenAI> {
  const config = useRuntimeConfig(event)
  const rt = await getAiRuntimeConfig(event)
  const model = rt.generatorModel || String(config.deepseekGeneratorModel || '')
  // 无库内覆盖时回落环境变量 DEEPSEEK_TIMEOUT_MS，仍为空给 45s。
  const timeoutMs = rt.timeoutMs ?? (Number(config.deepseekTimeoutMs) || 45000)
  // 输出上限：缺省取运行时配置 AI_AGENT_MAX_OUTPUT_TOKENS（默认 4096），防止长思考链无界计费。
  const maxTokens = opts.maxTokens ?? (Number(config.agentMaxOutputTokens) || 4096)
  return new ChatOpenAI({
    model,
    apiKey: String(config.deepseekApiKey || ''),
    configuration: { baseURL: String(config.deepseekBaseUrl || 'https://api.deepseek.com') },
    // 注意：DeepSeek 思考模式下 temperature 会被静默忽略（默认思考模式开启、effort=high）。
    // 这里保留参数以便将来显式切到非思考模式时生效；当前不发送 thinking/reasoning_effort，
    // 即沿用服务端默认行为（思考开启）。若要降本，应先评估回答质量再显式关闭或降低 effort。
    temperature: opts.temperature ?? 0.35,
    maxTokens,
    streaming: true,
    timeout: timeoutMs,
    // 传输层自动重试（网络抖动、429、5xx）：Agent 无法自愈的临时故障在 SDK 内重试
    maxRetries: 2
  })
}
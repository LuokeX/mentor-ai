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
  return new ChatOpenAI({
    model,
    apiKey: String(config.deepseekApiKey || ''),
    configuration: { baseURL: String(config.deepseekBaseUrl || 'https://api.deepseek.com') },
    temperature: opts.temperature ?? 0.35,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    streaming: true,
    timeout: timeoutMs
  })
}
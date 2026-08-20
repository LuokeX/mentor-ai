import type { H3Event } from 'h3'
import { requestOllamaEmbeddings } from './ollama'
import { requestDashScopeEmbeddings } from './dashscope'

export type EmbeddingProvider = 'ollama' | 'dashscope'

export interface EmbeddingProviderConfig {
  provider: EmbeddingProvider
  model: string
  baseUrl: string
  apiKey: string
  timeoutMs: number
}

// 单次请求的文本数上限：ollama 无硬限制取 32；百炼兼容模式单请求上限 10 条
const BATCH_SIZE: Record<EmbeddingProvider, number> = { ollama: 32, dashscope: 10 }

function resolveConfig(event: H3Event): EmbeddingProviderConfig {
  const config = useRuntimeConfig(event)
  const provider = (String(config.embeddingProvider || 'ollama') === 'dashscope' ? 'dashscope' : 'ollama') as EmbeddingProvider
  return {
    provider,
    model: String(config.embeddingModel || ''),
    baseUrl: provider === 'dashscope'
      ? String(config.dashscopeBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1')
      : String(config.ollamaBaseUrl || 'http://127.0.0.1:11434'),
    apiKey: String(config.dashscopeApiKey || ''),
    timeoutMs: Number(config.embeddingTimeoutMs) || 8000
  }
}

/**
 * 按供应商分片向量化：单批失败置 null 继续，不拖垮整批。
 * 供服务端调用（event 解析配置）与脚本（显式 config）复用。
 */
export async function requestProviderEmbeddings(config: EmbeddingProviderConfig, input: string[]) {
  if (!input.length) return []
  const batchSize = BATCH_SIZE[config.provider]
  const result: (number[] | null)[] = new Array(input.length).fill(null)
  for (let offset = 0; offset < input.length; offset += batchSize) {
    const batch = input.slice(offset, offset + batchSize)
    try {
      const embeddings = config.provider === 'dashscope'
        ? await requestDashScopeEmbeddings({ baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey, timeoutMs: config.timeoutMs }, batch)
        : await requestOllamaEmbeddings({ baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs }, batch)
      for (let i = 0; i < batch.length; i++) result[offset + i] = embeddings[i] || null
    } catch {
      // 该批失败，其余批次继续
    }
  }
  return result
}

export async function embedModuleResourceChunks(event: H3Event, input: string[]) {
  const config = useRuntimeConfig(event)
  if (!config.embeddingEnabled) return null
  return requestProviderEmbeddings(resolveConfig(event), input)
}

export async function embedModuleResourceQuery(event: H3Event, query: string) {
  const config = useRuntimeConfig(event)
  if (!config.embeddingEnabled) return null
  const instruction = `Instruct: 检索与教师赋能业务模块资源最相关的片段\nQuery: ${query}`
  const embeddings = await requestProviderEmbeddings(resolveConfig(event), [instruction])
  return embeddings[0] || null
}
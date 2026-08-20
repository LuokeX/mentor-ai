import { z } from 'zod'
import { EMBEDDING_DIMENSIONS } from './ollama'

export interface DashScopeEmbeddingOptions {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
}

// OpenAI 兼容模式的 embedding 响应；显式请求 dimensions=1024 与 pgvector 列保持一致。
const dashscopeResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS) }))
})

export async function requestDashScopeEmbeddings(options: DashScopeEmbeddingOptions, input: string[]) {
  if (!input.length) return []
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      model: options.model,
      input,
      // 百炼 text-embedding-v3/v4 支持显式维度；与 vector(1024) 列一致，避免数据库迁移
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float'
    }),
    signal: AbortSignal.timeout(options.timeoutMs)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`DashScope embedding ${response.status}: ${detail.slice(0, 200)}`)
  }
  const parsed = dashscopeResponseSchema.parse(await response.json())
  if (parsed.data.length !== input.length) throw new Error('DashScope embedding count mismatch')
  return parsed.data.map(item => item.embedding)
}
import { z } from 'zod'

export const EMBEDDING_DIMENSIONS = 1024
export const DEFAULT_EMBEDDING_MODEL = 'qwen3-embedding:0.6b'

const embeddingResponseSchema = z.object({
  model: z.string().min(1),
  embeddings: z.array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS))
})

export interface OllamaEmbeddingOptions {
  baseUrl: string
  model: string
  timeoutMs: number
}

export async function requestOllamaEmbeddings(options: OllamaEmbeddingOptions, input: string[]) {
  if (!input.length) return []
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: options.model, input, truncate: true }),
    signal: AbortSignal.timeout(options.timeoutMs)
  })
  if (!response.ok) throw new Error(`Ollama embedding ${response.status}`)
  const parsed = embeddingResponseSchema.parse(await response.json())
  if (parsed.embeddings.length !== input.length) throw new Error('Ollama embedding count mismatch')
  return parsed.embeddings
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '../server/integrations/ollama'
import { requestDashScopeEmbeddings } from '../server/integrations/dashscope'
import { requestProviderEmbeddings, type EmbeddingProviderConfig } from '../server/integrations/embeddings'

afterEach(() => vi.unstubAllGlobals())

const dashscopeConfig = (overrides: Partial<EmbeddingProviderConfig> = {}): EmbeddingProviderConfig => ({
  provider: 'dashscope',
  model: 'text-embedding-v4',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-test',
  timeoutMs: 1000,
  ...overrides
})

function makeEmbedding(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS)
}

describe('dashscope embedding provider', () => {
  it('requests explicit 1024 dimensions in OpenAI-compatible format', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: makeEmbedding() }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestDashScopeEmbeddings({ ...dashscopeConfig(), apiKey: 'sk-test' }, ['问题'])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/embeddings')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('text-embedding-v4')
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS)
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
  })

  it('rejects a non-1024 dimensional response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2] }]
    }), { status: 200 })))
    await expect(requestDashScopeEmbeddings({ ...dashscopeConfig(), apiKey: 'sk-test' }, ['问题']))
      .rejects.toThrow()
  })

  it('surfaces provider HTTP errors with detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid api key', { status: 401 })))
    await expect(requestDashScopeEmbeddings({ ...dashscopeConfig(), apiKey: 'sk-bad' }, ['问题']))
      .rejects.toThrow(/DashScope embedding 401/)
  })
})

describe('requestProviderEmbeddings batching', () => {
  it('splits a large batch into chunks of 10 for dashscope', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] }
      return new Response(JSON.stringify({
        data: body.input.map(() => ({ embedding: makeEmbedding() }))
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const input = Array.from({ length: 25 }, (_, index) => `文本${index}`)
    const result = await requestProviderEmbeddings(dashscopeConfig(), input)

    expect(result).toHaveLength(25)
    expect(result.every(item => item !== null)).toBe(true)
    // 25 条 → 3 批（10/10/5）
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps null placeholders for failed batches instead of failing everything', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] }
      if (body.input.some(text => text.includes('坏文本'))) {
        return new Response('server error', { status: 500 })
      }
      return new Response(JSON.stringify({
        data: body.input.map(() => ({ embedding: makeEmbedding() }))
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // 第一批（0-9）全部含坏文本 → 整体失败；第二批（10-11）正常
    const input = [
      ...Array.from({ length: 10 }, (_, index) => `坏文本${index}`),
      '好文本1', '好文本2'
    ]
    const result = await requestProviderEmbeddings(dashscopeConfig(), input)

    expect(result[0]).toBeNull()
    expect(result[9]).toBeNull()
    expect(result[10]).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result[11]).toHaveLength(EMBEDDING_DIMENSIONS)
  })
})
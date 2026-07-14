import { afterEach, describe, expect, it, vi } from 'vitest'
import { knowledgeBaseCreateSchema, knowledgeDocumentImportSchema } from '../shared/contracts'
import { buildKnowledgeRetrievalQuery, chunkKnowledgeDocument, checksumKnowledgeContent } from '../server/domain/knowledge'
import { EMBEDDING_DIMENSIONS, requestOllamaEmbeddings } from '../server/integrations/ollama'

afterEach(() => vi.unstubAllGlobals())

describe('knowledge ingestion', () => {
  it('chunks markdown while retaining headings and bounded content', () => {
    const content = `# 家校沟通\n\n${'家长情绪激动时先确认感受，再澄清需求和边界。'.repeat(100)}\n\n## 投诉处理\n\n先记录事实，再按照学校流程升级。`
    const chunks = chunkKnowledgeDocument(content, 300)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(item => item.content.length <= 300)).toBe(true)
    expect(chunks.some(item => item.heading === '投诉处理')).toBe(true)
  })

  it('produces stable checksums and rejects imports without privacy confirmation', () => {
    expect(checksumKnowledgeContent('同一内容')).toBe(checksumKnowledgeContent('同一内容'))
    expect(knowledgeDocumentImportSchema.safeParse({
      title: '业务手册', sourceType: 'markdown', content: '这是足够长的业务知识内容。', confirmNoPersonalData: false
    }).success).toBe(false)
  })

  it('requires a school for school-scoped knowledge', () => {
    expect(knowledgeBaseCreateSchema.safeParse({ name: '校本制度', scope: 'school' }).success).toBe(false)
    expect(knowledgeBaseCreateSchema.safeParse({ name: '平台手册', scope: 'global' }).success).toBe(true)
  })

  it('builds retrieval queries from recent user context only', () => {
    const query = buildKnowledgeRetrievalQuery('我应该先怎么回应？', [
      { role: 'user', content: '很早以前的问题' },
      { role: 'assistant', content: '这段助手回答不应该进入检索' },
      { role: 'user', content: '家长在群里公开质疑我' },
      { role: 'user', content: '我担心沟通升级' },
      { role: 'user', content: '对方要求马上解释' }
    ])
    expect(query).toContain('家长在群里公开质疑我')
    expect(query).toContain('我应该先怎么回应？')
    expect(query).not.toContain('很早以前的问题')
    expect(query).not.toContain('助手回答')
  })

  it('accepts a batch of validated 1024-dimensional Ollama embeddings', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: 'qwen3-embedding:0.6b', embeddings: [embedding, embedding] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestOllamaEmbeddings({ baseUrl: 'http://ollama:11434', model: 'qwen3-embedding:0.6b', timeoutMs: 1000 }, ['问题', '知识'])
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects vectors with an unexpected dimension', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'qwen3-embedding:0.6b', embeddings: [[0.1, 0.2]] }), { status: 200 })))
    await expect(requestOllamaEmbeddings({ baseUrl: 'http://ollama:11434', model: 'qwen3-embedding:0.6b', timeoutMs: 1000 }, ['问题']))
      .rejects.toThrow()
  })
})

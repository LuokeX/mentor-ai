import { afterEach, describe, expect, it, vi } from 'vitest'
import { attributionConfigSchema, moduleResourceDocumentImportSchema } from '../shared/contracts'
import { chunkModuleResourceDocument, checksumModuleResourceContent } from '../server/domain/module-resource-documents'
import { EMBEDDING_DIMENSIONS, requestOllamaEmbeddings } from '../server/integrations/ollama'

afterEach(() => vi.unstubAllGlobals())

describe('module resource document ingestion', () => {
  it('chunks markdown while retaining headings and bounded content', () => {
    const content = `# 家校沟通\n\n${'家长情绪激动时先确认感受，再澄清需求和边界。'.repeat(100)}\n\n## 投诉处理\n\n先记录事实，再按照学校流程升级。`
    const chunks = chunkModuleResourceDocument(content, 300)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(item => item.content.length <= 300)).toBe(true)
    expect(chunks.some(item => item.heading === '投诉处理')).toBe(true)
  })

  it('produces stable checksums and rejects imports without privacy confirmation', () => {
    expect(checksumModuleResourceContent('同一内容')).toBe(checksumModuleResourceContent('同一内容'))
    expect(moduleResourceDocumentImportSchema.safeParse({
      versionId: '550e8400-e29b-41d4-a716-446655440000',
      title: '业务手册', sourceType: 'markdown', content: '这是足够长的业务知识内容。', confirmNoPersonalData: false
    }).success).toBe(false)
  })

  it('validates attribution library branches for deterministic plan generation', () => {
    const parsed = attributionConfigSchema.parse({
      module: 'home_school',
      version: '1.0.0',
      computed: { conflict: 'MAX(scores)' },
      attributionItems: [{
        code: 'HS_AT_CONFLICT',
        name: '家校沟通升级',
        module: 'home_school',
        toolTags: ['conflict', 'follow-up']
      }],
      evidences: [{
        attributionCode: 'HS_AT_CONFLICT',
        assessmentCode: 'HS_SCALE_A',
        evidenceCode: 'HS_EV_01',
        condition: 'conflict >= 4',
        description: '家校互动中出现高冲突信号'
      }],
      gradingRules: [{
        ruleId: 'home-school-high-conflict',
        pri: 999,
        level: 'high',
        severity: 'high',
        blocked: false
      }]
    })
    expect(parsed.attributionItems[0]?.name).toBe('家校沟通升级')
    expect(parsed.evidences[0]?.attributionCode).toBe('HS_AT_CONFLICT')
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

import { describe, expect, it } from 'vitest'
import { knowledgeBaseCreateSchema, knowledgeDocumentImportSchema } from '../shared/contracts'
import { chunkKnowledgeDocument, checksumKnowledgeContent } from '../server/domain/knowledge'

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
})

import { z } from 'zod'
import { embedModuleResourceQuery } from '../../integrations/embeddings'
import { searchKnowledgeChunks } from '../../domain/module-resource-knowledge-search'
import { useDb } from '../../utils/db'
import type { AgentTool, AgentToolContext } from '../types'

const knowledgeSearchSchema = z.object({
  query: z.string().trim().min(1).max(200).describe('检索问题，如「个别学生课堂走神怎么处理」'),
  module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']).optional()
    .describe('限定检索的模块（不传则全模块检索）')
})

function truncateText(text: string, max = 300): string {
  const value = (text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 知识库检索（只读）：embedModuleResourceQuery + searchKnowledgeChunks
 * （limit 5，minSimilarity 0.45，可选 module 过滤）。
 * 向量检索不可用（未启用 embedding/查询向量为空）或任何异常时返回 []，不向上抛错。
 */
export const knowledgeSearchTool: AgentTool = {
  name: 'knowledge_search',
  description: '在已发布业务知识库中检索与当前问题相关的操作建议片段（每次最多 5 段），返回片段来源与相似度；无命中或检索不可用时返回空列表。',
  schema: knowledgeSearchSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = knowledgeSearchSchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:knowledge_search] 参数无效:', parsed.error.issues[0]?.message)
      return []
    }
    const { query, module } = parsed.data
    try {
      const embedding = await embedModuleResourceQuery(ctx.event, query)
      if (!embedding || embedding.length === 0) {
        console.warn('[agent:knowledge_search] 向量检索未启用或查询向量为空，返回空结果')
        return []
      }
      const db = useDb(ctx.event)
      const results = await searchKnowledgeChunks(db, embedding, { module, minSimilarity: 0.45, limit: 5 })
      return results.map(item => ({
        chunkId: item.chunkId,
        documentId: item.documentId,
        documentTitle: item.documentTitle,
        heading: item.heading,
        content: truncateText(item.content),
        excerpt: truncateText(item.content),
        module: item.module || null,
        libraryType: item.libraryType,
        similarity: Math.round(item.similarity * 10000) / 10000
      }))
    } catch (error) {
      console.error('[agent:knowledge_search] 检索失败，返回空结果:', error instanceof Error ? error.message : error)
      return []
    }
  }
}
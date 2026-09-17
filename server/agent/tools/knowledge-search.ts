import { z } from 'zod'
import { embedModuleResourceQuery } from '../../integrations/embeddings'
import { searchKnowledgeChunksHybrid } from '../../domain/module-resource-knowledge-search'
import { readPublishedResourceCatalog } from '../../domain/assistant-readers'
import { viewerSchoolSections } from '../../utils/stage-filter'
import { budgetText } from '../tool-output'
import { trackProductEvent } from '../../domain/product-events'
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
 * 知识库检索（只读）：混合召回（向量 + pg_trgm 关键词，RRF 融合），
 * limit 5、minSimilarity 0.45、可选 module 过滤，关键词分支在向量不可用时独立生效。
 *
 * 零命中时返回已发布资源目录（catalog）而不是空数组：让模型能说明「平台里有这些资源、
 * 进入模块可查看」，既不编造内容，也不止步于「没查到」。
 * 检索异常一律返回空结果，不向上抛错——工具失败要由模型自愈，不能打断整轮回答。
 */
export const knowledgeSearchTool: AgentTool = {
  name: 'knowledge_search',
  description: '在已发布业务知识库中检索与当前问题相关的操作建议片段（每次最多 5 段），返回片段来源与相似度；未命中时返回该模块已发布资源目录（量表/归因/工具的名称与摘要），可据此说明平台有哪些资源，但不得编造资源正文。回答涉及班主任具体做法、平台量表/工具/SOP/制度之前应先调用一次，命中什么就按什么说。',
  schema: knowledgeSearchSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = knowledgeSearchSchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:knowledge_search] 参数无效:', parsed.error.issues[0]?.message)
      return { items: [], catalog: [], message: '检索参数无效，请提供检索问题文本。' }
    }
    const { query, module } = parsed.data
    // 学段：按教师任教年级折算，只检索本学段适用的知识片段（未标注学部的文档始终可见）
    const sections = viewerSchoolSections(ctx.event, ctx.user.teachingGrades)
    try {
      const embedding = await embedModuleResourceQuery(ctx.event, query)
      const db = useDb(ctx.event)
      const results = await searchKnowledgeChunksHybrid(db, query, embedding, { schoolId: ctx.user.schoolId, module, minSimilarity: 0.45, limit: 5, sections })
      if (results.length) {
        return {
          status: 'success',
          items: results.map(item => ({
            versionId: item.versionId,
            version: item.version,
            chunkId: item.chunkId,
            documentId: item.documentId,
            documentTitle: item.documentTitle,
            heading: item.heading,
            content: budgetText(item.content, 2000).text,
            truncated: budgetText(item.content, 2000).truncated,
            excerpt: truncateText(item.content),
            module: item.module || null,
            libraryType: item.libraryType,
            similarity: Math.round(item.similarity * 10000) / 10000
          }))
        }
      }
      await trackProductEvent(ctx.event, {
        schoolId: ctx.user.schoolId, userId: ctx.user.userId,
        eventName: 'assistant_knowledge_gap', metadata: { module: module ?? 'all', reason: 'no_match' }
      })
      // 零命中：退到「已发布资源目录」，让回答能落到真实存在的资源上
      const catalog = await readPublishedResourceCatalog(ctx.event, {
        schoolId: ctx.user.schoolId,
        module,
        sections
      }).catch(() => [])
      return {
        status: 'empty',
        items: [],
        catalog,
        message: catalog.length
          ? '未检索到相关片段；以下为该模块已发布资源的名称与摘要，可据此说明平台有哪些资源，但不要编造其正文、等级或结论。'
          : '未检索到相关片段，也没有可用的已发布资源；请基于通用班主任工作方法回答，不要编造平台手册、量表、SOP、等级、制度或来源。'
      }
    } catch (error) {
      console.error('[agent:knowledge_search] 检索失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error', items: [], catalog: [], message: '知识检索失败，请基于通用班主任工作方法回答，不要编造平台内容或来源。' }
    }
  }
}

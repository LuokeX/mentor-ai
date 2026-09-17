/**
 * 术语白话对照（后台调用，供方案改写与深度报告两条链路共用）。
 *
 * 链路：extractTerms 抽词 → 批量向量化 → 逐词 searchKnowledgeChunks
 *      → 按 chunkId 合并去重 → filterKnowledgeChunks 过滤内部规则/红线词/内部编码
 *      → 取前 MAX_TERM_CHUNKS 段作为 facts.termChunks。
 *
 * 与「工具名检索」的区别：那一路用工具名当检索词、解决「这个工具怎么做」；
 * 这一路用正文里出现的专业词当检索词、解决「这个词是什么意思」，两者互补。
 *
 * 降级：未启用 embedding、抽词为空、向量化失败、检索异常一律返回空数组，
 * 调用方按「没有术语片段」继续，绝不阻断方案生成。
 */
import type { H3Event } from 'h3'
import type { ModuleId } from '../../shared/contracts'
import type { SchoolSection } from '../../shared/school-section'
import { useDb } from '../utils/db'
import { embedModuleResourceQueries } from '../integrations/embeddings'
import { searchKnowledgeChunks } from './module-resource-knowledge-search'
import { filterKnowledgeChunks } from './knowledge-text-guard'
import { extractTerms, MAX_TERMS } from './term-extraction'

/** 单次最多抽取的术语数（定义在 term-extraction，这里再导出以保持调用口径统一）。 */
export { MAX_TERMS }
/** 每个术语最多取几段知识片段。 */
export const TERM_CHUNK_LIMIT = 2
/** 术语片段总数上限（与工具名检索的 5 段共同构成 facts 的知识输入）。 */
export const MAX_TERM_CHUNKS = 6
/** 术语检索的最低相似度（略高于工具名检索，避免把泛泛相关内容当术语解释）。 */
export const TERM_CHUNK_MIN_SIMILARITY = 0.5
/** 单段术语片段进入 facts 前的截断长度（与 tool-step-polish 的片段口径一致）。 */
export const TERM_CHUNK_MAX_LENGTH = 600

export interface TermGlossaryEntry {
  /** 触发这条片段的术语（模型据此知道该片段在解释哪个词） */
  term: string
  chunkId: string
  documentTitle: string
  heading: string | null
  content: string
  similarity: number
}

/**
 * 依据给定正文文本构建术语白话对照片段。任何失败返回空数组。
 */
export async function buildTermGlossary(
  event: H3Event,
  input: {
    schoolId: string
    module: ModuleId
    sections?: readonly SchoolSection[] | null
    texts: string[]
  }
): Promise<TermGlossaryEntry[]> {
  try {
    const config = useRuntimeConfig(event)
    if (!config.embeddingEnabled) return []

    const terms = await extractTerms(event, { texts: input.texts })
    if (!terms.length) return []

    const vectors = await embedModuleResourceQueries(event, terms)
    if (!vectors || !vectors.length) return []

    const db = useDb(event)
    const merged = new Map<string, TermGlossaryEntry>()
    for (let index = 0; index < terms.length; index++) {
      const term = terms[index]!
      const vector = vectors[index]
      if (!vector || !vector.length) continue
      const chunks = await searchKnowledgeChunks(db, vector, {
        schoolId: input.schoolId,
        module: input.module,
        minSimilarity: TERM_CHUNK_MIN_SIMILARITY,
        limit: TERM_CHUNK_LIMIT,
        sections: input.sections
      })
      for (const chunk of chunks) {
        const existing = merged.get(chunk.chunkId)
        // 同一片段被多个词命中：保留相似度最高的一次（term 也随之取更相关的那个词）
        if (existing && existing.similarity >= chunk.similarity) continue
        merged.set(chunk.chunkId, {
          term,
          chunkId: chunk.chunkId,
          documentTitle: chunk.documentTitle,
          heading: chunk.heading,
          // 先截断再过滤：截断后不会外发的部分不参与判定，避免为不可见内容白丢片段
          content: chunk.content.slice(0, TERM_CHUNK_MAX_LENGTH),
          similarity: chunk.similarity
        })
      }
    }
    if (!merged.size) return []

    const { kept, dropped, reasons } = filterKnowledgeChunks([...merged.values()])
    if (dropped) {
      console.warn(`[term-glossary] 术语片段过滤丢弃 ${dropped} 段（${reasons.join('、') || '未知'}）`)
    }
    return kept.slice(0, MAX_TERM_CHUNKS)
  } catch (error) {
    console.warn('[term-glossary] 术语检索不可用，跳过:',
      error instanceof Error ? error.message : error)
    return []
  }
}

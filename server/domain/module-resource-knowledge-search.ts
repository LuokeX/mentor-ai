import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../db/schema'
import type { ModuleId } from '../../shared/contracts'

export type DrizzleDB = NodePgDatabase<typeof schema>

export interface KnowledgeSearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  heading: string | null
  content: string
  excerpt: string
  module: string
  libraryType: string
  sourceType?: string
  sourceRef?: string
  similarity: number
}

/**
 * 使用 pgvector 余弦相似度检索知识库 chunk。
 *
 * @param db          Drizzle 数据库实例
 * @param embedding   查询向量（1024 维 float32）
 * @param filters     检索过滤条件
 */
export async function searchKnowledgeChunks(
  db: DrizzleDB,
  embedding: number[],
  filters?: {
    module?: ModuleId
    minSimilarity?: number
    limit?: number
  },
): Promise<KnowledgeSearchResult[]> {
  const module = filters?.module
  const minSimilarity = filters?.minSimilarity ?? 0.45
  const limit = filters?.limit ?? 5

  // 构建 pgvector 向量字符串: '[1.2,3.4,...]'
  const vectorStr = `[${embedding.join(',')}]`

  const result = await db.execute<{
    chunk_id: string
    document_id: string
    heading: string | null
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }>(sql`
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.heading,
      c.content,
      c.metadata,
      1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
    FROM module_resource_chunks c
    WHERE c.embedding IS NOT NULL
      ${module ? sql`AND c.metadata->>'module' = ${module}` : sql``}
      AND 1 - (c.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const metadata = row.metadata || {}
    const content = row.content || ''
    return {
      chunkId: String(row.chunk_id),
      documentId: String(row.document_id),
      documentTitle: String(metadata.documentTitle || ''),
      heading: row.heading,
      content,
      excerpt: content.length > 300 ? content.slice(0, 300) + '...' : content,
      module: String(metadata.module || ''),
      libraryType: String(metadata.libraryType || 'knowledge'),
      sourceType: typeof metadata.sourceType === 'string' ? metadata.sourceType : undefined,
      sourceRef: typeof metadata.sourceRef === 'string' ? metadata.sourceRef : undefined,
      similarity: Number(row.similarity),
    }
  })
}

/** 关键词提取的停用词（2 字窗口里高频但无检索价值的片段）。 */
const KEYWORD_STOPWORDS = new Set([
  '怎么', '如何', '什么', '为什', '这个', '那个', '一下', '可以', '应该', '需要', '我们', '他们',
  '就是', '还是', '但是', '因为', '所以', '如果', '现在', '已经', '一直', '总是', '老师', '学生',
  '孩子', '家长', '问题', '情况', '一个', '有点', '很多', '比较', '非常', '想要', '觉得'
])

/**
 * 从查询文本里抽关键词：CJK 连续串取 2 字滑窗，去停用词与重复，最多 4 个。
 * 仅供 pg_trgm 关键词分支使用；抽不到关键词时返回空数组（调用方退化为纯向量检索）。
 */
export function extractSearchKeywords(queryText: string, maxKeywords = 4): string[] {
  const text = (queryText || '').trim()
  if (!text) return []
  const keywords: string[] = []
  const seen = new Set<string>()
  for (const run of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      const keyword = run.slice(index, index + 2)
      if (KEYWORD_STOPWORDS.has(keyword) || seen.has(keyword)) continue
      seen.add(keyword)
      keywords.push(keyword)
      if (keywords.length >= maxKeywords) return keywords
    }
  }
  return keywords
}

/**
 * 倒数排名融合（Reciprocal Rank Fusion）：把多路召回结果按 1/(k+rank) 累加后排序去重。
 *
 * 向量路擅长语义相近、关键词路擅长术语与标题命中，两路分数不可直接比较，
 * 所以只按排名融合。同一 key 在多路出现时分数累加，天然把「两路都命中」的片段排到前面。
 * 导出供单测使用（纯函数）。
 */
export function mergeRankedLists<T>(lists: T[][], keyOf: (item: T) => string, k = 60): T[] {
  const merged = new Map<string, { item: T, score: number }>()
  for (const list of lists) {
    list.forEach((item, index) => {
      const key = keyOf(item)
      const weight = 1 / (k + index + 1)
      const existing = merged.get(key)
      if (existing) existing.score += weight
      else merged.set(key, { item, score: weight })
    })
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).map(entry => entry.item)
}

/**
 * 关键词召回分支（pg_trgm + ILIKE）。
 *
 * 只用来补向量检索的短板：向量对平台自有术语、量表/工具名称、量表编码这类精确词不敏感，
 * 关键词命中能显著改善「问某个专有名词却没检索到」的情况。
 * 命中数优先、标题相似度次之；不做分词依赖，纯 2 字窗口 + 参数化 ILIKE。
 */
async function searchKeywordChunks(
  db: DrizzleDB,
  keywords: string[],
  queryText: string,
  filters: { module?: ModuleId, limit: number, similarity?: number[] | null }
): Promise<KnowledgeSearchResult[]> {
  if (!keywords.length) return []
  const module = filters.module
  const hitPredicates = keywords.map(keyword => sql`c.content ILIKE ${`%${keyword}%`}`)
  const hitScore = sql.join(
    keywords.map(keyword => sql`(CASE WHEN c.content ILIKE ${`%${keyword}%`} THEN 1 ELSE 0 END)`),
    sql` + `
  )
  const similarityExpr = filters.similarity?.length
    ? sql`, coalesce(1 - (c.embedding <=> ${`[${filters.similarity.join(',')}]`}::vector), 0) AS similarity`
    : sql`, 0 AS similarity`

  const result = await db.execute<{
    chunk_id: string
    document_id: string
    heading: string | null
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }>(sql`
    SELECT
      c.id AS chunk_id,
      c.document_id,
      c.heading,
      c.content,
      c.metadata,
      (${hitScore}) AS hit_score,
      similarity(coalesce(c.heading, ''), ${queryText}) AS heading_score
      ${similarityExpr}
    FROM module_resource_chunks c
    WHERE ${module ? sql`c.metadata->>'module' = ${module}` : sql`TRUE`}
      AND (${sql.join(hitPredicates, sql` OR `)})
    ORDER BY hit_score DESC, heading_score DESC
    LIMIT ${filters.limit}
  `)

  return result.rows.map(row => {
    const metadata = row.metadata || {}
    const content = row.content || ''
    return {
      chunkId: String(row.chunk_id),
      documentId: String(row.document_id),
      documentTitle: String(metadata.documentTitle || ''),
      heading: row.heading,
      content,
      excerpt: content.length > 300 ? content.slice(0, 300) + '...' : content,
      module: String(metadata.module || ''),
      libraryType: String(metadata.libraryType || 'knowledge'),
      sourceType: typeof metadata.sourceType === 'string' ? metadata.sourceType : undefined,
      sourceRef: typeof metadata.sourceRef === 'string' ? metadata.sourceRef : undefined,
      similarity: Number(row.similarity) || 0,
    }
  })
}

/**
 * 混合召回：向量分支（语义）+ 关键词分支（pg_trgm 与 ILIKE），按 RRF 融合后取前 limit 条。
 *
 * 设计取舍：
 *  - 两路各自粗召回（默认 12 条），融合去重后再截断到 limit（默认 5），
 *    这样「向量没命中但关键词命中」的片段不会因为向量分支的 0.45 阈值被直接丢掉；
 *  - 向量不可用（未启用 embedding、查询向量为空）时自动退化为纯关键词检索，不抛错；
 *  - 不新增索引与迁移：pg_trgm 扩展已在 0001 迁移启用，试点规模下按 hit_score 排序即可，
 *    后续数据量上来再补 content 的 GIN 索引。
 */
export async function searchKnowledgeChunksHybrid(
  db: DrizzleDB,
  queryText: string,
  embedding: number[] | null | undefined,
  filters?: {
    module?: ModuleId
    minSimilarity?: number
    limit?: number
  }
): Promise<KnowledgeSearchResult[]> {
  const limit = filters?.limit ?? 5
  const coarseLimit = Math.max(limit * 2, 12)
  const keywords = extractSearchKeywords(queryText)
  const hasEmbedding = Boolean(embedding && embedding.length)

  const [vectorHits, keywordHits] = await Promise.all([
    hasEmbedding
      ? searchKnowledgeChunks(db, embedding as number[], {
        module: filters?.module,
        minSimilarity: filters?.minSimilarity ?? 0.45,
        limit: coarseLimit
      })
      : Promise.resolve([] as KnowledgeSearchResult[]),
    keywords.length
      ? searchKeywordChunks(db, keywords, queryText, {
        module: filters?.module,
        limit: coarseLimit,
        similarity: hasEmbedding ? embedding as number[] : null
      })
      : Promise.resolve([] as KnowledgeSearchResult[])
  ])

  return mergeRankedLists([vectorHits, keywordHits], item => item.chunkId).slice(0, limit)
}
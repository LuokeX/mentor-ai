import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../db/schema'
import type { ModuleId } from '../../shared/contracts'
import type { SchoolSection } from '../../shared/school-section'

export type DrizzleDB = NodePgDatabase<typeof schema>

export interface KnowledgeSearchResult {
  versionId?: string
  version?: string
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
 * 所有召回分支共享的可见性条件（与 JOIN 一起使用）：
 *  - 独立知识库文档（平台后台「知识库」导入，不挂三库版本，`c.version_id IS NULL`）：
 *    只要求文档 `ready`，属于平台级知识，对所有学校可见；
 *  - 挂在三库版本上的文档：版本必须已发布，并按库 scope（全局 / 本校）裁定。
 * 未提供学校时读不到校级资源（只能读全局资源与独立知识库文档）。
 */
export function publishedVisibility(schoolId?: string) {
  return sql`d.status = 'ready'
    AND (c.version_id IS NULL
      OR (v.status = 'published'
        AND ((l.scope = 'global' AND l.school_id IS NULL)
          OR (l.scope = 'school' AND l.school_id = ${schoolId ?? null}))))`
}

/**
 * 文档关联与库关联（两个召回分支共用）：
 *  - 文档：按 id 关联，版本/库归属做 NULL 安全比较（独立知识库文档两侧都是 NULL）；
 *  - 版本与库：LEFT JOIN —— 独立知识库文档没有版本和库，仍需参与召回。
 */
const documentAndLibraryJoins = sql`
    JOIN module_resource_documents d ON d.id = c.document_id
      AND (d.version_id = c.version_id OR (d.version_id IS NULL AND c.version_id IS NULL))
      AND (d.library_id = c.library_id OR (d.library_id IS NULL AND c.library_id IS NULL))
    LEFT JOIN module_resource_versions v ON v.id = c.version_id AND v.library_id = c.library_id
    LEFT JOIN module_resource_libraries l ON l.id = v.library_id`

/** 模块判定：优先取三库库的 module，独立知识库文档回退到切块 metadata.module。 */
const resourceModuleExpr = sql`COALESCE(l.module, c.metadata->>'module')`

/**
 * 学段可见性：文档/切块标了具体学部时只有命中查看者学段才可见；
 * 未标注（老数据）或标 all 的始终可见；未传学段（教师没填任教年级）时不过滤。
 * 口径与三库资源一致，见 shared/school-section.ts。
 */
export function schoolSectionVisibility(sections?: readonly SchoolSection[] | null) {
  if (!sections?.length) return sql`TRUE`
  const values = sql.join(sections.map(section => sql`${section}`), sql`, `)
  return sql`(c.metadata->>'applicableSchoolSection' IS NULL
    OR c.metadata->>'applicableSchoolSection' IN ('', 'all')
    OR c.metadata->>'applicableSchoolSection' IN (${values}))`
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
    schoolId?: string
    module?: ModuleId
    minSimilarity?: number
    limit?: number
    /** 查看者学段：按文档「适用学部」过滤，未标注的始终可见 */
    sections?: readonly SchoolSection[] | null
  },
): Promise<KnowledgeSearchResult[]> {
  const module = filters?.module
  const minSimilarity = filters?.minSimilarity ?? 0.45
  const limit = filters?.limit ?? 5

  // 构建 pgvector 向量字符串: '[1.2,3.4,...]'
  const vectorStr = `[${embedding.join(',')}]`

  const result = await db.execute<{
    version_id: string
    resource_version: string
    document_title: string
    resource_module: string
    library_type: string
    chunk_id: string
    document_id: string
    heading: string | null
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }>(sql`
    SELECT
      v.id AS version_id,
      v.version AS resource_version,
      d.title AS document_title,
      ${resourceModuleExpr} AS resource_module,
      COALESCE(l.library_type, c.metadata->>'libraryType', 'knowledge') AS library_type,
      c.id AS chunk_id,
      c.document_id,
      c.heading,
      c.content,
      c.metadata,
      1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
    FROM module_resource_chunks c
    ${documentAndLibraryJoins}
    WHERE c.embedding IS NOT NULL
      AND ${publishedVisibility(filters?.schoolId)}
      AND ${schoolSectionVisibility(filters?.sections)}
      ${module ? sql`AND ${resourceModuleExpr} = ${module}` : sql``}
      AND 1 - (c.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const metadata = row.metadata || {}
    const content = row.content || ''
    return {
      versionId: row.version_id ? String(row.version_id) : undefined,
      version: row.resource_version ? String(row.resource_version) : undefined,
      chunkId: String(row.chunk_id),
      documentId: String(row.document_id),
      documentTitle: String(row.document_title || ''),
      heading: row.heading,
      content,
      excerpt: content.length > 300 ? content.slice(0, 300) + '...' : content,
      module: String(row.resource_module || ''),
      libraryType: String(row.library_type || 'knowledge'),
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
  filters: { schoolId?: string, module?: ModuleId, limit: number, similarity?: number[] | null, sections?: readonly SchoolSection[] | null }
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
    version_id: string
    resource_version: string
    document_title: string
    resource_module: string
    library_type: string
    chunk_id: string
    document_id: string
    heading: string | null
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }>(sql`
    SELECT
      v.id AS version_id,
      v.version AS resource_version,
      d.title AS document_title,
      ${resourceModuleExpr} AS resource_module,
      COALESCE(l.library_type, c.metadata->>'libraryType', 'knowledge') AS library_type,
      c.id AS chunk_id,
      c.document_id,
      c.heading,
      c.content,
      c.metadata,
      (${hitScore}) AS hit_score,
      similarity(coalesce(c.heading, ''), ${queryText}) AS heading_score
      ${similarityExpr}
    FROM module_resource_chunks c
    ${documentAndLibraryJoins}
    WHERE ${publishedVisibility(filters.schoolId)}
      AND ${schoolSectionVisibility(filters.sections)}
      AND ${module ? sql`${resourceModuleExpr} = ${module}` : sql`TRUE`}
      AND (${sql.join(hitPredicates, sql` OR `)})
    ORDER BY hit_score DESC, heading_score DESC
    LIMIT ${filters.limit}
  `)

  return result.rows.map(row => {
    const metadata = row.metadata || {}
    const content = row.content || ''
    return {
      versionId: row.version_id ? String(row.version_id) : undefined,
      version: row.resource_version ? String(row.resource_version) : undefined,
      chunkId: String(row.chunk_id),
      documentId: String(row.document_id),
      documentTitle: String(row.document_title || ''),
      heading: row.heading,
      content,
      excerpt: content.length > 300 ? content.slice(0, 300) + '...' : content,
      module: String(row.resource_module || ''),
      libraryType: String(row.library_type || 'knowledge'),
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
    schoolId?: string
    module?: ModuleId
    minSimilarity?: number
    limit?: number
    /** 查看者学段：按文档「适用学部」过滤，未标注的始终可见 */
    sections?: readonly SchoolSection[] | null
  }
): Promise<KnowledgeSearchResult[]> {
  const limit = filters?.limit ?? 5
  const coarseLimit = Math.max(limit * 2, 12)
  const keywords = extractSearchKeywords(queryText)
  const hasEmbedding = Boolean(embedding && embedding.length)

  const [vectorHits, keywordHits] = await Promise.all([
    hasEmbedding
      ? searchKnowledgeChunks(db, embedding as number[], {
        schoolId: filters?.schoolId,
        module: filters?.module,
        minSimilarity: filters?.minSimilarity ?? 0.45,
        limit: coarseLimit,
        sections: filters?.sections
      })
      : Promise.resolve([] as KnowledgeSearchResult[]),
    keywords.length
      ? searchKeywordChunks(db, keywords, queryText, {
        schoolId: filters?.schoolId,
        module: filters?.module,
        limit: coarseLimit,
        similarity: hasEmbedding ? embedding as number[] : null,
        sections: filters?.sections
      })
      : Promise.resolve([] as KnowledgeSearchResult[])
  ])

  return mergeRankedLists([vectorHits, keywordHits], item => item.chunkId).slice(0, limit)
}
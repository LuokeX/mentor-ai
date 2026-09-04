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
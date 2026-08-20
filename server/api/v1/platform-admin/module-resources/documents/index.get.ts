import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'

const VALID_LIBRARY_TYPES = ['assessment', 'attribution', 'tool', 'output_template', 'keyword_route', 'knowledge'] as const

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const module = typeof query.module === 'string' ? moduleIdSchema.optional().parse(query.module) : undefined
  const libraryType = typeof query.libraryType === 'string' && VALID_LIBRARY_TYPES.includes(query.libraryType as any)
    ? query.libraryType
    : undefined
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined
  const embeddingStatus = typeof query.embeddingStatus === 'string' ? query.embeddingStatus : undefined
  const status = typeof query.status === 'string' ? query.status : undefined
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const offset = Math.max(Number(query.offset) || 0, 0)

  const db = useDb(event)

  const conditions = []
  // knowledge 文档 libraryId=null，按 metadata 过滤；三库文档按 libraries 表过滤
  if (libraryType === 'knowledge') {
    conditions.push(isNull(schema.moduleResourceDocuments.libraryId))
  } else if (libraryType) {
    conditions.push(eq(schema.moduleResourceLibraries.libraryType, libraryType))
  }
  // module 过滤需同时覆盖两类：三库文档（libraries.module）与未关联库的知识文档（metadata.module）。
  // 否则只选模块（类型=全部）时，libraryId=null 的知识文档会被 join 过滤漏掉。
  if (module) {
    conditions.push(or(
      eq(schema.moduleResourceLibraries.module, module),
      sql`${schema.moduleResourceDocuments.libraryId} IS NULL AND ${schema.moduleResourceDocuments.metadata}->>'module' = ${module}`
    ))
  }
  if (status) conditions.push(eq(schema.moduleResourceDocuments.status, status))
  if (search) {
    conditions.push(or(
      ilike(schema.moduleResourceDocuments.title, `%${search}%`),
      ilike(schema.moduleResourceDocuments.content, `%${search}%`)
    ))
  }

  // embedding status 存储在 metadata JSONB 中
  let embeddingFilter = ''
  if (embeddingStatus) {
    embeddingFilter = embeddingStatus
  }

  const baseQuery = db.select({
    id: schema.moduleResourceDocuments.id,
    libraryId: schema.moduleResourceDocuments.libraryId,
    versionId: schema.moduleResourceDocuments.versionId,
    title: schema.moduleResourceDocuments.title,
    sourceType: schema.moduleResourceDocuments.sourceType,
    originalFilename: schema.moduleResourceDocuments.originalFilename,
    status: schema.moduleResourceDocuments.status,
    metadata: schema.moduleResourceDocuments.metadata,
    createdAt: schema.moduleResourceDocuments.createdAt,
    module: sql<string>`COALESCE(${schema.moduleResourceLibraries.module}, ${schema.moduleResourceDocuments.metadata}->>'module')`,
    libraryType: sql<string>`COALESCE(${schema.moduleResourceLibraries.libraryType}, ${schema.moduleResourceDocuments.metadata}->>'libraryType')`,
    libraryName: schema.moduleResourceLibraries.name,
    versionLabel: schema.moduleResourceVersions.version
  })
    .from(schema.moduleResourceDocuments)
    .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
    .leftJoin(schema.moduleResourceVersions, eq(schema.moduleResourceDocuments.versionId, schema.moduleResourceVersions.id))
    .where(conditions.length ? and(...conditions) : undefined)

  const [countResult, statusCounts, rows] = await Promise.all([
    db.select({ count: schema.moduleResourceDocuments.id }).from(schema.moduleResourceDocuments)
      .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .then(r => r.length),
    // 全量向量状态统计（与列表同口径，但不受 embeddingStatus 过滤影响，保证四张卡片始终展示全量）
    db.select({
      status: sql<string>`${schema.moduleResourceDocuments.metadata}->>'embeddingStatus'`,
      count: sql<number>`count(${schema.moduleResourceDocuments.id})`
    }).from(schema.moduleResourceDocuments)
      .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(sql`${schema.moduleResourceDocuments.metadata}->>'embeddingStatus'`),
    baseQuery
      .orderBy(desc(schema.moduleResourceDocuments.createdAt))
      .limit(limit)
      .offset(offset)
  ])

  const stats = { ready: 0, pending: 0, disabled: 0, partial: 0, unknown: 0 }
  for (const row of statusCounts) {
    const key = (row.status || 'unknown') as keyof typeof stats
    const count = Number(row.count) || 0
    if (key in stats) stats[key] += count
    else stats.unknown += count
  }

  // 为每条文档补充 chunk 统计
  const documents = await Promise.all(rows.map(async (doc) => {
    const [chunkStats] = await db.select({
      totalChunks: schema.moduleResourceChunks.id,
      embeddedChunks: schema.moduleResourceChunks.embedding
    }).from(schema.moduleResourceChunks)
      .where(eq(schema.moduleResourceChunks.documentId, doc.id))

    return {
      ...doc,
      chunkCount: (doc.metadata as Record<string, unknown>)?.chunkCount ?? 0,
      embeddedChunkCount: (doc.metadata as Record<string, unknown>)?.embeddedChunkCount ?? 0,
      embeddingStatus: (doc.metadata as Record<string, unknown>)?.embeddingStatus ?? 'unknown'
    }
  }))

  // embeddingStatus 过滤（JSONB 字段需要后处理）
  const filtered = embeddingFilter
    ? documents.filter(d => d.embeddingStatus === embeddingFilter)
    : documents

  return {
    total: embeddingFilter ? filtered.length : countResult,
    offset,
    limit,
    documents: filtered,
    stats
  }
})
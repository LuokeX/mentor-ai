import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [document] = await db.select({
    id: schema.moduleResourceDocuments.id,
    libraryId: schema.moduleResourceDocuments.libraryId,
    versionId: schema.moduleResourceDocuments.versionId,
    title: schema.moduleResourceDocuments.title,
    sourceType: schema.moduleResourceDocuments.sourceType,
    originalFilename: schema.moduleResourceDocuments.originalFilename,
    mimeType: schema.moduleResourceDocuments.mimeType,
    checksum: schema.moduleResourceDocuments.checksum,
    status: schema.moduleResourceDocuments.status,
    content: schema.moduleResourceDocuments.content,
    metadata: schema.moduleResourceDocuments.metadata,
    createdBy: schema.moduleResourceDocuments.createdBy,
    createdAt: schema.moduleResourceDocuments.createdAt,
    updatedAt: schema.moduleResourceDocuments.updatedAt,
    module: sql<string>`COALESCE(${schema.moduleResourceLibraries.module}, ${schema.moduleResourceDocuments.metadata}->>'module')`,
    libraryType: sql<string>`COALESCE(${schema.moduleResourceLibraries.libraryType}, ${schema.moduleResourceDocuments.metadata}->>'libraryType')`,
    libraryName: schema.moduleResourceLibraries.name,
    versionLabel: schema.moduleResourceVersions.version
  })
    .from(schema.moduleResourceDocuments)
    .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
    .leftJoin(schema.moduleResourceVersions, eq(schema.moduleResourceDocuments.versionId, schema.moduleResourceVersions.id))
    .where(eq(schema.moduleResourceDocuments.id, id))
    .limit(1)

  if (!document) throw createError({ statusCode: 404, message: '文档不存在' })

  const chunks = await db.select({
    id: schema.moduleResourceChunks.id,
    chunkIndex: schema.moduleResourceChunks.chunkIndex,
    heading: schema.moduleResourceChunks.heading,
    content: schema.moduleResourceChunks.content,
    tokenEstimate: schema.moduleResourceChunks.tokenEstimate,
    embeddingModel: schema.moduleResourceChunks.embeddingModel,
    embeddedAt: schema.moduleResourceChunks.embeddedAt,
    metadata: schema.moduleResourceChunks.metadata
  })
    .from(schema.moduleResourceChunks)
    .where(eq(schema.moduleResourceChunks.documentId, id))
    .orderBy(schema.moduleResourceChunks.chunkIndex)

  const chunksWithStatus = chunks.map(chunk => ({
    ...chunk,
    hasEmbedding: chunk.embeddingModel !== null
  }))

  const hasAllEmbeddings = chunksWithStatus.every(c => c.hasEmbedding)
  const hasAnyEmbedding = chunksWithStatus.some(c => c.hasEmbedding)

  return {
    ...document,
    contentPreview: document.content.slice(0, 500),
    contentCharCount: document.content.length,
    chunks: chunksWithStatus,
    chunkCount: chunks.length,
    embeddingSummary: {
      totalChunks: chunks.length,
      embeddedChunks: chunksWithStatus.filter(c => c.hasEmbedding).length,
      status: hasAllEmbeddings ? 'ready' : hasAnyEmbedding ? 'partial' : 'pending',
      model: chunksWithStatus.find(c => c.embeddingModel)?.embeddingModel ?? null
    }
  }
})
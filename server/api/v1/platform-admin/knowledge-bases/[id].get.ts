import { asc, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  setHeader(event, 'Cache-Control', 'no-store')

  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)
  const [knowledgeBase] = await db.select().from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, id)).limit(1)
  if (!knowledgeBase) throw createError({ statusCode: 404, message: '知识库不存在' })

  const [documents, chunks] = await Promise.all([
    db.select({
      id: schema.knowledgeDocuments.id,
      title: schema.knowledgeDocuments.title,
      sourceType: schema.knowledgeDocuments.sourceType,
      originalFilename: schema.knowledgeDocuments.originalFilename,
      mimeType: schema.knowledgeDocuments.mimeType,
      status: schema.knowledgeDocuments.status,
      metadata: schema.knowledgeDocuments.metadata,
      createdAt: schema.knowledgeDocuments.createdAt,
      updatedAt: schema.knowledgeDocuments.updatedAt
    }).from(schema.knowledgeDocuments)
      .where(eq(schema.knowledgeDocuments.knowledgeBaseId, id))
      .orderBy(asc(schema.knowledgeDocuments.createdAt)),
    db.select({
      id: schema.knowledgeChunks.id,
      documentId: schema.knowledgeChunks.documentId,
      chunkIndex: schema.knowledgeChunks.chunkIndex,
      heading: schema.knowledgeChunks.heading,
      content: schema.knowledgeChunks.content,
      tokenEstimate: schema.knowledgeChunks.tokenEstimate
    }).from(schema.knowledgeChunks)
      .where(eq(schema.knowledgeChunks.knowledgeBaseId, id))
      .orderBy(asc(schema.knowledgeChunks.documentId), asc(schema.knowledgeChunks.chunkIndex))
      .limit(200)
  ])

  return {
    knowledgeBase,
    documents: documents.map(document => ({
      ...document,
      chunks: chunks.filter(chunk => chunk.documentId === document.id).map(chunk => ({
        ...chunk,
        content: chunk.content.slice(0, 800)
      }))
    })),
    previewTruncated: chunks.length === 200
  }
})

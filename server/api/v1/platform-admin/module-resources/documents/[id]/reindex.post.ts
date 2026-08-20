import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { embedModuleResourceChunks } from '../../../../../../integrations/embeddings'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const config = useRuntimeConfig(event)

  const [document] = await db.select({
    id: schema.moduleResourceDocuments.id,
    title: schema.moduleResourceDocuments.title,
    libraryId: schema.moduleResourceDocuments.libraryId,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    schoolId: schema.moduleResourceLibraries.schoolId
  })
    .from(schema.moduleResourceDocuments)
    .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceDocuments.id, id))
    .limit(1)

  if (!document) throw createError({ statusCode: 404, message: '文档不存在' })

  const chunks = await db.select({
    id: schema.moduleResourceChunks.id,
    heading: schema.moduleResourceChunks.heading,
    content: schema.moduleResourceChunks.content
  })
    .from(schema.moduleResourceChunks)
    .where(eq(schema.moduleResourceChunks.documentId, id))
    .orderBy(schema.moduleResourceChunks.chunkIndex)

  if (!chunks.length) throw createError({ statusCode: 400, message: '文档没有分块数据' })

  let embeddedCount = 0
  let embeddingError: string | null = null

  try {
    const inputs = chunks.map(c => `${c.heading ? `${c.heading}\n` : ''}${c.content}`)
    const embeddings = await embedModuleResourceChunks(event, inputs)
    if (!embeddings) throw new Error('向量化服务未启用')
    const embeddingModel = String(config.embeddingModel)

    await db.transaction(async (tx) => {
      for (let i = 0; i < chunks.length; i++) {
        await tx.update(schema.moduleResourceChunks)
          .set({
            embedding: embeddings[i],
            embeddingModel: embeddings[i] ? embeddingModel : null,
            embeddedAt: embeddings[i] ? new Date() : null
          })
          .where(eq(schema.moduleResourceChunks.id, chunks[i]!.id))
      }
      await tx.update(schema.moduleResourceDocuments)
        .set({
          metadata: {
            ...((document as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}),
            embeddedChunkCount: embeddings.filter(Boolean).length,
            embeddingStatus: embeddings.some(Boolean) ? 'ready' : 'pending',
            module: document.module,
            libraryType: document.libraryType
          } as Record<string, unknown>,
          updatedAt: new Date()
        })
        .where(eq(schema.moduleResourceDocuments.id, id))
    })

    embeddedCount = embeddings.length
  } catch (error) {
    embeddingError = error instanceof Error ? error.message.slice(0, 160) : 'embedding_failed'
    await db.update(schema.moduleResourceDocuments)
      .set({
        metadata: {
          ...((document as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}),
          embeddingStatus: 'pending',
          embeddingError
        } as Record<string, unknown>,
        updatedAt: new Date()
      })
      .where(eq(schema.moduleResourceDocuments.id, id))
  }

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: document.schoolId,
    action: 'platform_admin.module_resource_document.reindex',
    targetType: 'module_resource_document',
    targetId: id,
    metadata: { title: document.title, chunkCount: chunks.length, embeddedCount, error: embeddingError }
  })

  return {
    documentId: id,
    chunkCount: chunks.length,
    embeddedCount,
    embeddingStatus: embeddingError ? 'pending' : 'ready',
    error: embeddingError
  }
})
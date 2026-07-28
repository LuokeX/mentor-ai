import { eq, inArray, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { embedModuleResourceChunks } from '../../../../../integrations/ollama'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({
  documentIds: z.array(z.string().uuid()).optional(),
  allPending: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const config = useRuntimeConfig(event)

  // 确定要处理的文档范围
  let targetDocs: Array<{ id: string; title: string; schoolId: string | null; module: string | null; libraryType: string | null }>

  if (body.documentIds && body.documentIds.length > 0) {
    targetDocs = await db.select({
      id: schema.moduleResourceDocuments.id,
      title: schema.moduleResourceDocuments.title,
      schoolId: schema.moduleResourceLibraries.schoolId,
      module: schema.moduleResourceLibraries.module,
      libraryType: schema.moduleResourceLibraries.libraryType
    })
      .from(schema.moduleResourceDocuments)
      .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
      .where(inArray(schema.moduleResourceDocuments.id, body.documentIds))
  } else if (body.allPending) {
    // 查找所有 embedding 状态不是 ready 的文档
    const allDocs = await db.select({
      id: schema.moduleResourceDocuments.id,
      title: schema.moduleResourceDocuments.title,
      metadata: schema.moduleResourceDocuments.metadata,
      schoolId: schema.moduleResourceLibraries.schoolId,
      module: schema.moduleResourceLibraries.module,
      libraryType: schema.moduleResourceLibraries.libraryType
    })
      .from(schema.moduleResourceDocuments)
      .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
      .limit(500)

    targetDocs = allDocs
      .filter(d => {
        const meta = d.metadata as Record<string, unknown> | undefined
        return meta?.embeddingStatus !== 'ready'
      })
      .map(d => ({
        id: d.id,
        title: d.title,
        schoolId: d.schoolId,
        module: d.module,
        libraryType: d.libraryType
      }))
  } else {
    throw createError({ statusCode: 400, message: '请提供 documentIds 或设置 allPending=true' })
  }

  if (!targetDocs.length) {
    return { processed: 0, totalChunks: 0, totalEmbedded: 0, errors: [] }
  }

  let totalChunks = 0
  let totalEmbedded = 0
  const errors: Array<{ documentId: string; error: string }> = []
  const embeddingModel = String(config.embeddingModel)

  for (const doc of targetDocs) {
    try {
      const chunks = await db.select({
        id: schema.moduleResourceChunks.id,
        heading: schema.moduleResourceChunks.heading,
        content: schema.moduleResourceChunks.content
      })
        .from(schema.moduleResourceChunks)
        .where(eq(schema.moduleResourceChunks.documentId, doc.id))
        .orderBy(schema.moduleResourceChunks.chunkIndex)

      if (!chunks.length) continue

      const inputs = chunks.map(c => `${c.heading ? `${c.heading}\n` : ''}${c.content}`)
      const embeddings = await embedModuleResourceChunks(event, inputs)
      if (!embeddings) {
        errors.push({ documentId: doc.id, error: '向量化服务未启用' })
        continue
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          await tx.update(schema.moduleResourceChunks)
            .set({
              embedding: embeddings[i],
              embeddingModel,
              embeddedAt: new Date()
            })
            .where(eq(schema.moduleResourceChunks.id, chunks[i]!.id))
        }
        await tx.update(schema.moduleResourceDocuments)
          .set({
            metadata: {
              ...(({}) as Record<string, unknown>),
              embeddedChunkCount: embeddings.length,
              embeddingStatus: 'ready',
              module: doc.module,
              libraryType: doc.libraryType
            } as Record<string, unknown>,
            updatedAt: new Date()
          })
          .where(eq(schema.moduleResourceDocuments.id, doc.id))
      })

      totalChunks += chunks.length
      totalEmbedded += embeddings.length
    } catch (error: any) {
      errors.push({ documentId: doc.id, error: error.message.slice(0, 160) })
    }
  }

  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.module_resource_document.batch_reindex',
    targetType: 'module_resource_document',
    targetId: 'batch',
    metadata: { documentCount: targetDocs.length, totalChunks, totalEmbedded, errorCount: errors.length }
  })

  return {
    processed: targetDocs.length,
    totalChunks,
    totalEmbedded,
    errors
  }
})
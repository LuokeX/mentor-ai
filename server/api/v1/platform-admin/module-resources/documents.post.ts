import { eq } from 'drizzle-orm'
import { moduleResourceDocumentImportSchema } from '../../../../../shared/contracts'
import { chunkModuleResourceDocument, checksumModuleResourceContent, normalizeModuleResourceContent } from '../../../../domain/module-resource-documents'
import { embedModuleResourceChunks } from '../../../../integrations/ollama'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceDocumentImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '文档参数不正确' })
  const body = parsed.data
  const db = useDb(event)
  const [version] = await db.select({
    id: schema.moduleResourceVersions.id,
    status: schema.moduleResourceVersions.status,
    libraryId: schema.moduleResourceVersions.libraryId,
    schoolId: schema.moduleResourceLibraries.schoolId,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceVersions.id, body.versionId))
    .limit(1)
  if (!version) throw createError({ statusCode: 404, message: '资源版本不存在' })
  if (!['assessment', 'attribution', 'tool'].includes(version.libraryType)) {
    throw createError({ statusCode: 422, message: '该资源类型不支持文档导入' })
  }

  let content = normalizeModuleResourceContent(body.content)
  if (body.sourceType === 'json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2) } catch { throw createError({ statusCode: 400, message: 'JSON 文档格式不正确' }) }
  }
  const chunks = chunkModuleResourceDocument(content)
  if (!chunks.length) throw createError({ statusCode: 400, message: '文档没有可导入内容' })

  let embeddings: number[][] | null = null
  let embeddingError: string | null = null
  try {
    embeddings = await embedModuleResourceChunks(event, chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`))
  } catch (error) {
    embeddingError = error instanceof Error ? error.message.slice(0, 160) : 'embedding_failed'
  }
  const config = useRuntimeConfig(event)

  try {
    const document = await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.moduleResourceDocuments).values({
        libraryId: version.libraryId,
        versionId: version.id,
        title: body.title,
        sourceType: body.sourceType,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        checksum: checksumModuleResourceContent(content),
        status: version.status === 'published' ? 'ready' : 'draft',
        content,
        metadata: {
          characterCount: content.length,
          chunkCount: chunks.length,
          embeddedChunkCount: embeddings?.length || 0,
          embeddingStatus: embeddings ? 'ready' : config.embeddingEnabled ? 'pending' : 'disabled',
          module: version.module,
          libraryType: version.libraryType,
          ...(embeddingError ? { embeddingError } : {})
        },
        createdBy: admin.id
      }).returning()
      if (!created) throw new Error('文档创建失败')
      await tx.insert(schema.moduleResourceChunks).values(chunks.map((chunk, index) => ({
        libraryId: version.libraryId,
        versionId: version.id,
        documentId: created.id,
        ...chunk,
        embedding: embeddings?.[index],
        embeddingModel: embeddings ? String(config.embeddingModel) : null,
        embeddedAt: embeddings ? new Date() : null,
        metadata: { module: version.module, libraryType: version.libraryType }
      })))
      return created
    })
    await writeAudit(event, {
      actorId: admin.id,
      schoolId: version.schoolId,
      action: 'platform_admin.module_resource_document.import',
      targetType: 'module_resource_document',
      targetId: document.id,
      metadata: { versionId: version.id, libraryId: version.libraryId, module: version.module, libraryType: version.libraryType, chunks: chunks.length, embeddedChunks: embeddings?.length || 0 }
    })
    return { ...document, chunkCount: chunks.length, embeddedChunkCount: embeddings?.length || 0, embeddingStatus: embeddings ? 'ready' : 'pending' }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '该资源版本中已经存在内容相同的文档' })
    throw error
  }
})

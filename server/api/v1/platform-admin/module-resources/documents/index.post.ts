import { eq } from 'drizzle-orm'
import { moduleResourceDocumentImportSchema } from '../../../../../../shared/contracts'
import type { ModuleId } from '../../../../../../shared/contracts'
import { chunkModuleResourceDocument, checksumModuleResourceContent, normalizeModuleResourceContent } from '../../../../../domain/module-resource-documents'
import { embedModuleResourceChunks } from '../../../../../integrations/embeddings'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceDocumentImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '文档参数不正确' })
  const body = parsed.data
  const db = useDb(event)

  // 确定文档归属：有 versionId → 业务三库文档；无 versionId → 独立知识库文档
  let libraryId: string | null = null
  let versionId: string | null = null
  let versionModule: ModuleId = (body.module ?? 'self_growth') as ModuleId
  let versionLibraryType = 'knowledge'
  let schoolId: string | null = null
  let docStatus = 'draft'

  if (body.versionId) {
    // 业务三库模式：查询版本获取 libraryId / module / libraryType
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
    if (version.libraryType === 'output_template' || version.libraryType === 'keyword_route') {
      throw createError({ statusCode: 422, message: 'output_template 和 keyword_route 类型不支持文档导入' })
    }
    libraryId = version.libraryId
    versionId = version.id
    versionModule = version.module as ModuleId
    versionLibraryType = version.libraryType
    schoolId = version.schoolId
    docStatus = version.status === 'published' ? 'ready' : 'draft'
  }
  // 无 versionId 时 libraryId/versionId 保持 null，独立知识库文档

  let content = normalizeModuleResourceContent(body.content)
  if (body.sourceType === 'json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2) } catch { throw createError({ statusCode: 400, message: 'JSON 文档格式不正确' }) }
  }
  const chunks = chunkModuleResourceDocument(content)
  if (!chunks.length) throw createError({ statusCode: 400, message: '文档没有可导入内容' })

  let embeddings: (number[] | null)[] | null = null
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
        libraryId,
        versionId,
        title: body.title,
        sourceType: body.sourceType,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        checksum: checksumModuleResourceContent(content),
        status: docStatus,
        content,
        metadata: {
          characterCount: content.length,
          chunkCount: chunks.length,
          embeddedChunkCount: embeddings?.filter(Boolean).length || 0,
          embeddingStatus: embeddings?.some(Boolean) ? 'ready' : config.embeddingEnabled ? 'pending' : 'disabled',
          module: versionModule,
          libraryType: versionLibraryType,
          ...(embeddingError ? { embeddingError } : {})
        },
        createdBy: admin.id
      }).returning()
      if (!created) throw new Error('文档创建失败')
      await tx.insert(schema.moduleResourceChunks).values(chunks.map((chunk, index) => ({
        libraryId,
        versionId,
        documentId: created.id,
        ...chunk,
        embedding: embeddings?.[index],
        embeddingModel: embeddings?.[index] ? String(config.embeddingModel) : null,
        embeddedAt: embeddings?.[index] ? new Date() : null,
        metadata: { module: versionModule, libraryType: versionLibraryType, documentTitle: body.title, sourceType: body.sourceType, tags: body.tags ?? [], sourceRef: body.sourceRef ?? null }
      })))
      return created
    })
    await writeAudit(event, {
      actorId: admin.id,
      schoolId,
      action: 'platform_admin.module_resource_document.import',
      targetType: 'module_resource_document',
      targetId: document.id,
      metadata: { versionId, libraryId, module: versionModule, libraryType: versionLibraryType, chunks: chunks.length, embeddedChunks: embeddings?.length || 0 }
    })
    return { ...document, chunkCount: chunks.length, embeddedChunkCount: embeddings?.length || 0, embeddingStatus: embeddings ? 'ready' : 'pending' }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '该资源版本中已经存在内容相同的文档' })
    throw error
  }
})
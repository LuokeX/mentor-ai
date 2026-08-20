import { eq } from 'drizzle-orm'
import { moduleResourceDocumentImportSchema } from '../../../../../../shared/contracts'
import type { ModuleId } from '../../../../../../shared/contracts'
import { chunkModuleResourceDocument, createDocumentWithChunks, normalizeModuleResourceContent } from '../../../../../domain/module-resource-documents'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { useDb, schema } from '../../../../../utils/db'
import { isUniqueConstraintError } from '../../../../../utils/db-helpers'

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

  // normalize → chunk → embed → 事务写入 由共享函数统一处理（口径与原实现一致）
  let result: Awaited<ReturnType<typeof createDocumentWithChunks>>
  try {
    result = await createDocumentWithChunks(db, {
      libraryId,
      versionId,
      title: body.title,
      sourceType: body.sourceType,
      content,
      metadata: { module: versionModule, libraryType: versionLibraryType },
      status: docStatus,
      createdBy: admin.id,
      event,
      originalFilename: body.originalFilename ?? null,
      mimeType: body.mimeType ?? null,
      tags: body.tags ?? [],
      sourceRef: body.sourceRef ?? null
    })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) throw createError({ statusCode: 409, message: '该资源版本中已经存在内容相同的文档' })
    throw error
  }

  await writeAudit(event, {
    actorId: admin.id,
    schoolId,
    action: 'platform_admin.module_resource_document.import',
    targetType: 'module_resource_document',
    targetId: result.id,
    metadata: { versionId, libraryId, module: versionModule, libraryType: versionLibraryType, chunks: result.chunks, embeddedChunks: result.embedded }
  })
  return {
    id: result.id,
    title: body.title,
    chunkCount: result.chunks,
    embeddedChunkCount: result.embedded,
    embeddingStatus: result.embedded ? 'ready' : 'pending'
  }
})
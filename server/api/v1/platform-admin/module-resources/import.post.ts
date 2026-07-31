import { and, eq, isNull, ne } from 'drizzle-orm'
import { moduleResourceFileImportSchema, type ModuleResourceFileImport } from '../../../../../shared/contracts'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { rebuildModuleResourceProjection } from '../../../../domain/module-resource-projection'
import { validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { runCrossRefCheck } from '../../../../domain/module-resource-cross-ref-runner'
import { resolveModuleResourceCounterpart } from '../../../../domain/module-resources'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceFileImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源文件参数不正确' })
  const body = parsed.data
  const db = useDb(event)
  if (body.schoolId) {
    const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, body.schoolId)).limit(1)
    if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  }

  let payload: Record<string, unknown>
  try {
    payload = parseModuleResourceFile(body)
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '资源文件解析失败' })
  }
  const validation = validateModuleResourcePayload({
    module: body.module,
    libraryType: body.libraryType,
    payload,
    counterpart: await resolveModuleResourceCounterpart(event, {
      module: body.module,
      libraryType: body.libraryType,
      schoolId: body.schoolId || null
    })
  })
  if (!validation.ok) {
    throw createError({
      statusCode: 422,
      message: `资源文件校验失败：${validation.errors.map(issue => issue.message).join('；')}`,
      data: { validation }
    })
  }
  // 勾了「预检通过后直接发布」时必须过跨库校验，否则可以一步把跨库断裂的资源推上线。
  // 只存草稿则放行——草稿本来就允许引用还没导入的库。
  if (body.publish) {
    const crossRef = await runCrossRefCheck(event, body.module, {
      kind: 'byPayload', libraryType: body.libraryType, payload
    })
    const errors = crossRef.issues.filter(issue => issue.severity === 'error')
    if (errors.length) {
      throw createError({
        statusCode: 422,
        message: `跨库引用校验失败，无法直接发布：${errors.slice(0, 3).map(item => item.message).join('；')}`,
        data: { crossRef }
      })
    }
  }

  const now = new Date()
  const result = await db.transaction(async (tx) => {
    const library = await resolveLibrary(tx, body, admin.id)
    // 停用旧版必须排在插入之前。module_resource_versions_published_uidx 是
    // 「WHERE status='published'」的部分唯一索引，先插一条 published 会当场撞索引：
    // 库里已经有已发布版本时，「导入并直接发布」必然 500，且报错只说 duplicate key。
    if (body.publish) {
      await tx.update(schema.moduleResourceVersions).set({ status: 'retired', updatedAt: now })
        .where(and(
          eq(schema.moduleResourceVersions.libraryId, library.id),
          eq(schema.moduleResourceVersions.status, 'published')
        ))
    }
    const [version] = await tx.insert(schema.moduleResourceVersions).values({
      libraryId: library.id,
      version: body.version,
      payload,
      notes: body.notes,
      status: body.publish ? 'published' : 'draft',
      createdBy: admin.id,
      publishedBy: body.publish ? admin.id : null,
      publishedAt: body.publish ? now : null,
      updatedAt: now
    }).returning()
    if (!version) throw createError({ statusCode: 500, message: '资源版本创建失败' })
    await rebuildModuleResourceProjection(tx, {
      libraryId: library.id,
      versionId: version.id,
      module: body.module,
      libraryType: body.libraryType,
      scope: body.scope,
      schoolId: library.schoolId
    }, payload)
    return { library, version }
  })

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: result.library.schoolId,
    action: body.publish ? 'platform_admin.module_resource_file.import_publish' : 'platform_admin.module_resource_file.import_draft',
    targetType: 'module_resource_version',
    targetId: result.version.id,
    metadata: {
      libraryId: result.library.id,
      module: body.module,
      libraryType: body.libraryType,
      filename: body.filename,
      warnings: validation.warnings.length
    }
  })

  return { ...result, validation }
})

async function resolveLibrary(tx: any, body: ModuleResourceFileImport, actorId: string) {
  if (body.libraryId) {
    const [library] = await tx.select().from(schema.moduleResourceLibraries).where(eq(schema.moduleResourceLibraries.id, body.libraryId)).limit(1)
    if (!library) throw createError({ statusCode: 404, message: '资源库不存在' })
    if (library.module !== body.module || library.libraryType !== body.libraryType) {
      throw createError({ statusCode: 422, message: '选择的资源库与导入模块或库类型不一致' })
    }
    return library
  }

  const [existing] = await tx.select().from(schema.moduleResourceLibraries)
    .where(and(
      eq(schema.moduleResourceLibraries.module, body.module),
      eq(schema.moduleResourceLibraries.libraryType, body.libraryType),
      eq(schema.moduleResourceLibraries.scope, body.scope),
      body.scope === 'school' && body.schoolId
        ? eq(schema.moduleResourceLibraries.schoolId, body.schoolId)
        : isNull(schema.moduleResourceLibraries.schoolId)
    ))
    .limit(1)
  if (existing) return existing

  const [created] = await tx.insert(schema.moduleResourceLibraries).values({
    module: body.module,
    libraryType: body.libraryType,
    scope: body.scope,
    schoolId: body.scope === 'school' ? body.schoolId || null : null,
    name: body.libraryName || `${body.module}·${body.libraryType}`,
    description: body.libraryDescription,
    createdBy: actorId
  }).returning()
  if (!created) throw createError({ statusCode: 500, message: '资源库创建失败' })
  return created
}

/**
 * 批量导入（整套替换）提交：必须上传全部 5 个库文件、同一版本号
 * （x.y.z 格式且该模块范围内未被占用），全部校验通过后在单事务里一起写入，
 * 要么全成功要么一个都不写。
 *
 * 为什么不复用 /import 逐个导入：那个端点的语义是「单库增量更新」，
 * 会拿新文件去和库里现行的对侧资源校验。整套导入时对侧也是本次上传的库，
 * 逐个导入会撞上循环冲突（先导量表→拿旧归因校验→422；反过来也一样）。
 * 与 wizard-import 的整套替换语义一致。
 */
import { and, eq, isNull } from 'drizzle-orm'
import { moduleResourceBatchImportSchema } from '../../../../../shared/contracts'
import type { LibraryType } from '../../../../../shared/contracts'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { rebuildModuleResourceProjection } from '../../../../domain/module-resource-projection'
import { validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { runCrossRefCheck } from '../../../../domain/module-resource-cross-ref-runner'
import { BATCH_LIBRARY_LABEL, buildBatchCounterpart } from '../../../../domain/module-resource-batch'
import { findExistingVersionLibraries, resolveModuleResourceCounterpart } from '../../../../domain/module-resources'
import { writeAudit } from '../../../../utils/audit'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceBatchImportSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源文件参数不正确' })
  }
  const body = parsed.data
  const schoolId = body.scope === 'school' ? (body.schoolId || null) : null
  const db = useDb(event)
  if (schoolId) {
    const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1)
    if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  }

  // 0. 版本号真实化：该模块+范围内不得重复（草稿也占位，(library_id, version) 全局唯一）。
  // 与预览一致，提交时再查一次——预览之后到提交之间可能已有别的管理员占用。
  const versionConflicts = await findExistingVersionLibraries(event, {
    module: body.module, scope: body.scope, schoolId, version: body.version
  })
  if (versionConflicts.length) {
    throw createError({
      statusCode: 422,
      message: `版本号 ${body.version} 已被使用（${versionConflicts.slice(0, 3).map(item => item.libraryName).join('、')}），请换一个新版本号`,
      data: { versionConflicts }
    })
  }

  // 1. 全部解析
  const entries: Array<{ libraryType: LibraryType, filename: string, payload: Record<string, unknown> }> = []
  for (const file of body.files) {
    let payload: Record<string, unknown>
    try {
      payload = parseModuleResourceFile({
        module: body.module,
        libraryType: file.libraryType,
        filename: file.filename,
        contentBase64: file.contentBase64
      })
    } catch (error: any) {
      throw createError({ statusCode: 400, message: `《${file.filename}》解析失败：${error?.message || ''}` })
    }
    entries.push({ libraryType: file.libraryType, filename: file.filename, payload })
  }

  // 2. 库内校验：对侧优先用本次一并上传的库（整套语义），没上传才回退现行
  const uploaded = new Map<LibraryType, Record<string, unknown>>(
    entries.map(entry => [entry.libraryType, entry.payload])
  )
  for (const entry of entries) {
    const validation = validateModuleResourcePayload({
      module: body.module,
      libraryType: entry.libraryType,
      payload: entry.payload,
      counterpart: buildBatchCounterpart(
        uploaded,
        await resolveModuleResourceCounterpart(event, { module: body.module, libraryType: entry.libraryType, schoolId }),
        entry.libraryType
      )
    })
    if (!validation.ok) {
      throw createError({
        statusCode: 422,
        message: `《${entry.filename}》校验未通过：${validation.errors.map(issue => issue.message).join('；')}`,
        data: { libraryType: entry.libraryType, validation }
      })
    }
  }

  // 3. 跨库校验：本次上传的库之间互相校验，未上传的库回退现行已发布版本。
  // 与 wizard-import 一样无条件拦截——整套导入的库本来就该互相自洽。
  const crossRef = await runCrossRefCheck(event, body.module,
    entries.map(entry => ({
      kind: 'byPayload' as const,
      libraryType: entry.libraryType,
      payload: entry.payload,
      scope: body.scope,
      schoolId
    })),
    { schoolId }
  )
  const crossRefErrors = crossRef.issues.filter(issue => issue.severity === 'error')
  if (crossRefErrors.length) {
    throw createError({
      statusCode: 422,
      message: `跨库检查未通过：${crossRefErrors.slice(0, 3).map(issue => issue.message).join('；')}`,
      data: { crossRef }
    })
  }

  // 4. 单事务写入：全部库一起成功或一起失败
  const now = new Date()
  const written = await db.transaction(async (tx) => {
    const result: Array<{ libraryType: string, libraryId: string, versionId: string }> = []
    for (const entry of entries) {
      const library = await resolveLibrary(tx, body, schoolId, entry.libraryType, admin.id)
      // 停用旧版必须排在插入之前：module_resource_versions_published_uidx 是
      // 「WHERE status='published'」的部分唯一索引，先插一条 published 会当场撞索引
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
        payload: entry.payload,
        notes: body.notes || '批量导入',
        status: body.publish ? 'published' : 'draft',
        createdBy: admin.id,
        publishedBy: body.publish ? admin.id : null,
        publishedAt: body.publish ? now : null,
        updatedAt: now
      }).returning()
      if (!version) throw createError({ statusCode: 500, message: `《${entry.filename}》版本创建失败` })

      await rebuildModuleResourceProjection(tx, {
        libraryId: library.id,
        versionId: version.id,
        module: body.module,
        libraryType: entry.libraryType,
        scope: body.scope,
        schoolId: library.schoolId
      }, entry.payload)

      result.push({ libraryType: entry.libraryType, libraryId: library.id, versionId: version.id })
    }
    return result
  })

  await writeAudit(event, {
    actorId: admin.id,
    schoolId,
    action: 'platform_admin.module_resource.batch_import',
    targetType: 'module_resource_library',
    // target_id 是 uuid 列，指向本次第一个上传的库，其余库记在 metadata 里
    targetId: written[0]?.libraryId,
    metadata: {
      module: body.module, version: body.version, scope: body.scope, publish: body.publish,
      files: body.files.map(file => file.filename),
      libraries: written.map(w => ({ libraryType: w.libraryType, versionId: w.versionId }))
    }
  })

  return { ok: true, published: body.publish, written, warnings: crossRef.issues.filter(issue => issue.severity === 'warning') }
})

async function resolveLibrary(
  tx: any,
  body: { module: string, scope: string },
  schoolId: string | null,
  libraryType: string,
  actorId: string
) {
  const [existing] = await tx.select().from(schema.moduleResourceLibraries)
    .where(and(
      eq(schema.moduleResourceLibraries.module, body.module),
      eq(schema.moduleResourceLibraries.libraryType, libraryType),
      eq(schema.moduleResourceLibraries.scope, body.scope),
      schoolId
        ? eq(schema.moduleResourceLibraries.schoolId, schoolId)
        : isNull(schema.moduleResourceLibraries.schoolId)
    ))
    .limit(1)
  if (existing) return existing

  const [created] = await tx.insert(schema.moduleResourceLibraries).values({
    module: body.module,
    libraryType,
    scope: body.scope,
    schoolId,
    name: `${body.module}·${BATCH_LIBRARY_LABEL[libraryType] || libraryType}`,
    description: '批量导入',
    createdBy: actorId
  }).returning()
  if (!created) throw createError({ statusCode: 500, message: `${BATCH_LIBRARY_LABEL[libraryType] || libraryType}资源库创建失败` })
  return created
}
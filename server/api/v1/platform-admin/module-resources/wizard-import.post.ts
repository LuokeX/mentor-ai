/**
 * 业务填写向导的整套导入。
 *
 * 为什么不复用 /import 逐个导入：那个端点的语义是「单库增量更新」，
 * 会拿新文件去和**库里现行的对侧资源**校验。而向导产出的是一整套替换——
 * 新量表库对上的是新归因库，不是旧的。逐个导入会撞上循环冲突：
 *   先导量表 → 拿旧归因库校验 → 题号对不上 → 422
 *   先导归因 → 拿旧量表库校验 → 同样对不上 → 422
 * 无论什么顺序都过不去，因为中间态必然不一致。
 *
 * 所以这里做成一个事务里的整套替换：5 个库互相校验（而不是和库里的旧版本校验），
 * 全部通过才一起写入，要么 5 个都成功要么一个都不写。
 */
import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { wizardInputSchema } from '../../../../../shared/business-wizard'
import { compileWizardInput } from '../../../../domain/business-wizard-compile'
import { checkCrossReferences } from '../../../../domain/module-resource-cross-ref'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { rebuildModuleResourceProjection } from '../../../../domain/module-resource-projection'
import { validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { writeAudit } from '../../../../utils/audit'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  input: wizardInputSchema,
  publish: z.boolean().default(false),
  /** 检查未通过时把原始填写内容存成「待验证」版本：不生成库文件、不校验，只供向导载入继续改 */
  saveAsPending: z.boolean().default(false),
  confirmNoPersonalData: z.literal(true)
})

const LIBRARY_LABEL: Record<string, string> = {
  assessment: '量表库', attribution: '归因库', tool: '工具库',
  keyword_route: '关键词路由库', output_template: '输出模板库'
}
const LIBRARY_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template'] as const
const MODULE_LABEL: Record<string, string> = {
  self_growth: '自我成长赋能', class_system: '班级系统建设', home_school: '家校沟通合作',
  student_case: '学生个体问题', learning_problem: '学生学习问题'
}

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })
  }
  const { input, publish, saveAsPending } = parsed.data

  // 「保存为待验证」：检查没通过也把原始填写内容留档。
  // 不编译、不生成库文件、不校验——这份内容本来就没通过检查，
  // 存的就是向导输入本身，载入时原样还原继续改，不走 decompile。
  if (saveAsPending) {
    const now = new Date()
    const db = useDb(event)
    const written = await db.transaction(async (tx) => {
      const result: Array<{ libraryType: string, libraryId: string, versionId: string }> = []
      for (const libType of LIBRARY_TYPES) {
        const [existing] = await tx.select().from(schema.moduleResourceLibraries).where(and(
          eq(schema.moduleResourceLibraries.module, input.module),
          eq(schema.moduleResourceLibraries.libraryType, libType),
          eq(schema.moduleResourceLibraries.scope, 'global'),
          isNull(schema.moduleResourceLibraries.schoolId)
        )).limit(1)
        const library = existing || (await tx.insert(schema.moduleResourceLibraries).values({
          module: input.module, libraryType: libType, scope: 'global', schoolId: null,
          name: `${MODULE_LABEL[input.module] || input.module}${LIBRARY_LABEL[libType]}`,
          description: '业务填写向导生成', createdBy: admin.id
        }).returning())[0]
        if (!library) throw createError({ statusCode: 500, message: `${LIBRARY_LABEL[libType]}资源库创建失败` })
        const [version] = await tx.insert(schema.moduleResourceVersions).values({
          libraryId: library.id, version: input.version,
          payload: { __wizardDraft: true, input },
          notes: '业务填写向导生成（待验证：检查未通过）',
          status: 'pending_review',
          createdBy: admin.id,
          publishedBy: null,
          publishedAt: null,
          updatedAt: now
        }).returning()
        if (!version) throw createError({ statusCode: 500, message: `${LIBRARY_LABEL[libType]}版本创建失败` })
        result.push({ libraryType: libType, libraryId: library.id, versionId: version.id })
      }
      return result
    })

    await writeAudit(event, {
      actorId: admin.id,
      schoolId: null,
      action: 'platform_admin.module_resource.wizard_import_pending',
      targetType: 'module_resource_library',
      targetId: written.find(w => w.libraryType === 'assessment')?.libraryId,
      metadata: { module: input.module, version: input.version, libraries: written.map(w => ({ libraryType: w.libraryType, versionId: w.versionId })) }
    })
    return { ok: true, savedAsPending: true, written }
  }

  const compiled = compileWizardInput(input)
  const blocking = compiled.issues.filter(i => i.severity === 'error')
  if (blocking.length) {
    throw createError({ statusCode: 422, message: blocking.map(i => i.message).join('；'), data: { issues: compiled.issues } })
  }

  // 先把 5 个库全部解析出来，互相校验；一个不过就整体不写
  const payloads = new Map<string, Record<string, unknown>>()
  const libraries: Array<{ id: string, libraryType: string }> = []
  for (const lib of compiled.libraries) {
    let payload: Record<string, unknown>
    try {
      payload = parseModuleResourceFile({
        module: input.module, libraryType: lib.libraryType,
        filename: `${lib.libraryType}.xlsx`, contentBase64: lib.buffer.toString('base64')
      })
    } catch (error: any) {
      throw createError({ statusCode: 422, message: `生成的${lib.label}无法解析：${error?.message || ''}` })
    }
    // 注意：不传 counterpart。整套替换的对侧就是这次一起导入的那几个库，
    // 拿库里的旧版本来校验只会得到必然失败的结果。
    const validation = validateModuleResourcePayload({
      module: input.module, libraryType: lib.libraryType, payload
    })
    if (!validation.ok) {
      throw createError({
        statusCode: 422,
        message: `${lib.label}校验未通过：${validation.errors.map(e => e.message).join('；')}`,
        data: { libraryType: lib.libraryType, validation }
      })
    }
    payloads.set(lib.libraryType, payload)
    libraries.push({ id: lib.libraryType, libraryType: lib.libraryType })
  }

  const crossRef = checkCrossReferences(input.module, libraries, payloads)
  const crossRefErrors = crossRef.issues.filter(i => i.severity === 'error')
  if (crossRefErrors.length) {
    throw createError({
      statusCode: 422,
      message: `跨库检查未通过：${crossRefErrors.slice(0, 3).map(i => i.message).join('；')}`,
      data: { crossRef }
    })
  }

  const now = new Date()
  const db = useDb(event)
  const written = await db.transaction(async (tx) => {
    const result: Array<{ libraryType: string, libraryId: string, versionId: string }> = []
    for (const lib of compiled.libraries) {
      // 找到或新建这个模块下该类型的平台级库
      const [existing] = await tx.select().from(schema.moduleResourceLibraries).where(and(
        eq(schema.moduleResourceLibraries.module, input.module),
        eq(schema.moduleResourceLibraries.libraryType, lib.libraryType),
        eq(schema.moduleResourceLibraries.scope, 'global'),
        isNull(schema.moduleResourceLibraries.schoolId)
      )).limit(1)
      const library = existing || (await tx.insert(schema.moduleResourceLibraries).values({
        module: input.module, libraryType: lib.libraryType, scope: 'global', schoolId: null,
        name: `${MODULE_LABEL[input.module] || input.module}${LIBRARY_LABEL[lib.libraryType]}`,
        description: '业务填写向导生成', createdBy: admin.id
      }).returning())[0]
      if (!library) throw createError({ statusCode: 500, message: `${lib.label}资源库创建失败` })

      // 停用旧的已发布版本必须排在插入之前：
      // module_resource_versions_published_uidx 是「WHERE status='published'」的部分唯一索引，
      // 先插一条 published 会当场撞索引。
      if (publish) {
        await tx.update(schema.moduleResourceVersions).set({ status: 'retired', updatedAt: now })
          .where(and(
            eq(schema.moduleResourceVersions.libraryId, library.id),
            eq(schema.moduleResourceVersions.status, 'published')
          ))
      }

      const [version] = await tx.insert(schema.moduleResourceVersions).values({
        libraryId: library.id, version: input.version,
        payload: payloads.get(lib.libraryType)!,
        notes: '业务填写向导生成',
        status: publish ? 'published' : 'draft',
        createdBy: admin.id,
        publishedBy: publish ? admin.id : null,
        publishedAt: publish ? now : null,
        updatedAt: now
      }).returning()
      if (!version) throw createError({ statusCode: 500, message: `${lib.label}版本创建失败` })

      await rebuildModuleResourceProjection(tx, {
        libraryId: library.id, versionId: version.id, module: input.module,
        libraryType: lib.libraryType, scope: 'global', schoolId: null
      }, payloads.get(lib.libraryType)!)

      result.push({ libraryType: lib.libraryType, libraryId: library.id, versionId: version.id })
    }
    return result
  })

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: null,
    action: 'platform_admin.module_resource.wizard_import',
    targetType: 'module_resource_library',
    // target_id 是 uuid 列，模块名塞不进去。指向量表库，其余库记在 metadata 里。
    targetId: written.find(w => w.libraryType === 'assessment')?.libraryId,
    metadata: {
      module: input.module, version: input.version, publish,
      libraries: written.map(w => ({ libraryType: w.libraryType, versionId: w.versionId }))
    }
  })

  return { ok: true, published: publish, written, warnings: compiled.issues.filter(i => i.severity === 'warning') }
})

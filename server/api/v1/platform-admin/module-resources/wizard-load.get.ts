/**
 * 把某个模块已发布的 5 库读回来，还原成向导的中文输入。
 *
 * 让业务能在向导里打开系统里已有的内容继续改，而不是只能从零填。
 *
 * 返回里的 unsupported 必须原样呈现给业务：库里的内容可能是手工填 Excel 来的，
 * 含有向导表达不了的东西（计算变量、复杂条件、工具的附加字段）。
 * 在向导里保存会把这些丢掉——不说清楚就是在帮人毁数据。
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { decompileToWizardInput } from '../../../../domain/business-wizard-decompile'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const module = moduleIdSchema.parse(getQuery(event).module)
  const db = useDb(event)

  const rows = await db.select({
    libraryType: schema.moduleResourceLibraries.libraryType,
    version: schema.moduleResourceVersions.version,
    payload: schema.moduleResourceVersions.payload,
    publishedAt: schema.moduleResourceVersions.publishedAt
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId),
      eq(schema.moduleResourceVersions.status, 'published')
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt))

  const payloads: Record<string, any> = {}
  const sources: Array<{ libraryType: string, version: string }> = []
  for (const row of rows) {
    if (payloads[row.libraryType]) continue
    payloads[row.libraryType] = row.payload
    sources.push({ libraryType: row.libraryType, version: row.version })
  }

  if (!payloads.assessment) {
    throw createError({ statusCode: 404, message: '这个模块还没有已发布的量表库，没有可载入的内容。' })
  }

  // 用量表库的实际版本号进位，payload 内部那个 version 字段是业务填的，不一定同步
  const result = decompileToWizardInput(module, payloads,
    sources.find(s => s.libraryType === 'assessment')?.version)
  return { ...result, sources }
})

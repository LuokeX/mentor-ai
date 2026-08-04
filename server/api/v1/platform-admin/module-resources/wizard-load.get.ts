/**
 * 把某个模块已发布的 5 库读回来，还原成向导的中文输入。
 *
 * 让业务能在向导里打开系统里已有的内容继续改，而不是只能从零填。
 *
 * 支持选择版本：`?module=X&version=4.0.0` 载入指定版本（默认最新）。
 * 返回 availableVersions 供前端下拉选择；指定版本在某库不存在时该库回退最新，
 * 避免版本漂移时整个载入失败。
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
  const query = getQuery(event)
  const module = moduleIdSchema.parse(query.module)
  const wantedVersion = typeof query.version === 'string' && query.version.trim() ? query.version.trim() : undefined
  const db = useDb(event)

  const rows = await db.select({
    libraryType: schema.moduleResourceLibraries.libraryType,
    version: schema.moduleResourceVersions.version,
    publishedAt: schema.moduleResourceVersions.publishedAt,
    payload: schema.moduleResourceVersions.payload
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

  // 该模块全部已发布版本（跨 5 库去重，按发布时间倒序），供前端下拉
  const availableVersions = [...new Map(
    rows.map(r => [r.version, r.publishedAt])
  ).entries()].map(([version, publishedAt]) => ({ version, publishedAt }))

  if (!availableVersions.length) {
    throw createError({ statusCode: 404, message: '这个模块还没有已发布的资源，没有可载入的内容。' })
  }

  // 每库取「指定版本」或「最新」；某库没有指定版本时回退该库最新，防止版本漂移导致整体失败
  const payloads: Record<string, any> = {}
  const sources: Array<{ libraryType: string, version: string }> = []
  for (const libraryType of ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']) {
    const chosen = wantedVersion
      ? rows.find(r => r.libraryType === libraryType && r.version === wantedVersion)
      : rows.find(r => r.libraryType === libraryType)
    const fallback = rows.find(r => r.libraryType === libraryType)
    const row = chosen || fallback
    if (!row) continue
    payloads[libraryType] = row.payload
    sources.push({ libraryType, version: row.version })
  }

  if (!payloads.assessment) {
    throw createError({ statusCode: 404, message: '这个模块还没有已发布的量表库，没有可载入的内容。' })
  }

  // 用量表库的实际版本号进位，payload 内部那个 version 字段是业务填的，不一定同步
  const result = decompileToWizardInput(module, payloads,
    sources.find(s => s.libraryType === 'assessment')?.version)
  return {
    ...result,
    sources,
    availableVersions,
    selectedVersion: sources.find(s => s.libraryType === 'assessment')?.version
  }
})
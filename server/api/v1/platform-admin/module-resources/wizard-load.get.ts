/**
 * 把某个模块的 5 库读回来，还原成向导的中文输入。
 *
 * 让业务能在向导里打开系统里已有的内容继续改，而不是只能从零填。
 *
 * 支持选择版本：`?module=X&version=4.0.0` 载入指定版本（默认载入各库最新已发布）。
 * 可选范围是所有状态的版本——已发布、草稿、待验证、已停用都可以载入：
 *   - 已发布/草稿/已停用：库格式 payload，走 decompile 还原成中文输入；
 *   - 待验证：保存的是向导原始填写内容（检查未通过时留档），原样还原，不走 decompile。
 * 返回 availableVersions 供前端下拉选择（带状态标签）；
 * 指定版本在某库不存在时该库回退最新，避免版本漂移时整个载入失败。
 *
 * 返回里的 unsupported 必须原样呈现给业务：库里的内容可能是手工填 Excel 来的，
 * 含有向导表达不了的东西（计算变量、复杂条件、工具的附加字段）。
 * 在向导里保存会把这些丢掉——不说清楚就是在帮人毁数据。
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { bumpVersion, decompileToWizardInput } from '../../../../domain/business-wizard-decompile'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const module = moduleIdSchema.parse(query.module)
  const wantedVersion = typeof query.version === 'string' && query.version.trim() ? query.version.trim() : undefined
  const db = useDb(event)

  // 所有状态的版本都参与载入；排序按最近更新，最新编辑的排前面
  const rows = await db.select({
    libraryType: schema.moduleResourceLibraries.libraryType,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    publishedAt: schema.moduleResourceVersions.publishedAt,
    payload: schema.moduleResourceVersions.payload
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId)
    ))
    .orderBy(desc(schema.moduleResourceVersions.updatedAt))

  // 该模块全部版本（跨 5 库按版本号聚合，带状态集合），供前端下拉选择
  const byVersion = new Map<string, { statuses: Set<string>, publishedAt: Date | null }>()
  for (const r of rows) {
    const entry = byVersion.get(r.version) || { statuses: new Set<string>(), publishedAt: r.publishedAt }
    entry.statuses.add(r.status)
    if (r.publishedAt && (!entry.publishedAt || r.publishedAt > entry.publishedAt)) entry.publishedAt = r.publishedAt
    byVersion.set(r.version, entry)
  }
  const availableVersions = [...byVersion.entries()].map(([version, entry]) => ({
    version,
    statuses: [...entry.statuses],
    publishedAt: entry.publishedAt
  }))

  if (!availableVersions.length) {
    throw createError({ statusCode: 404, message: '这个模块还没有任何版本，没有可载入的内容。' })
  }

  // 每库取「指定版本（任意状态）」或「该库最新已发布」；指定版本在某库缺失时回退最新，
  // 防止版本漂移导致整体失败
  const latestPublished = (libraryType: string) => rows.find(r => r.libraryType === libraryType && r.status === 'published')
  const payloads: Record<string, any> = {}
  const sources: Array<{ libraryType: string, version: string, status: string }> = []
  for (const libraryType of ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']) {
    const chosen = wantedVersion
      ? rows.find(r => r.libraryType === libraryType && r.version === wantedVersion)
      : latestPublished(libraryType)
    const row = chosen || latestPublished(libraryType)
    if (!row) continue
    payloads[libraryType] = row.payload
    sources.push({ libraryType, version: row.version, status: row.status })
  }

  if (!payloads.assessment) {
    throw createError({ statusCode: 404, message: '这个模块还没有量表库内容，没有可载入的版本。' })
  }

  // 待验证版本：整份内容是向导原始输入，5 个库存的是同一份，原样还原即可
  const pendingPayload = payloads.assessment as any
  if (pendingPayload?.__wizardDraft && pendingPayload.input) {
    const input = { ...(pendingPayload.input as Record<string, unknown>) }
    input.version = bumpVersion(String(input.version || '1.0.0'))
    return {
      input,
      sources,
      availableVersions,
      selectedVersion: sources.find(s => s.libraryType === 'assessment')?.version,
      unsupported: [],
      notes: ['这是一份「待验证」版本：保存时检查未通过，原样载入继续填写。']
    }
  }

  // 正常库格式 payload：用量表库的实际版本号进位，payload 内部那个 version 字段是业务填的，不一定同步
  const result = decompileToWizardInput(module, payloads,
    sources.find(s => s.libraryType === 'assessment')?.version)
  return {
    ...result,
    sources,
    availableVersions,
    selectedVersion: sources.find(s => s.libraryType === 'assessment')?.version
  }
})
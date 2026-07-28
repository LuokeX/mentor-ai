import { and, eq, desc } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { checkCrossReferences } from '../../../../domain/module-resource-cross-ref'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])

  const query = getQuery(event)
  const module = moduleIdSchema.parse(query.module)
  const versionId = typeof query.versionId === 'string' && query.versionId.length > 0 ? query.versionId : undefined

  const db = useDb(event)

  // 加载该模块所有已发布的库及其最新已发布版本
  const publishedLibraries = await db.select({
    id: schema.moduleResourceLibraries.id,
    libraryType: schema.moduleResourceLibraries.libraryType,
  }).from(schema.moduleResourceLibraries)
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global'),
    ))

  // 对每种库类型，取最新已发布版本的 payload
  const publishedVersions = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    payload: schema.moduleResourceVersions.payload,
    status: schema.moduleResourceVersions.status,
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      eq(schema.moduleResourceVersions.status, 'published'),
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt))

  // 每种库类型取最新发布的 payload
  const versionPayloads = new Map<string, Record<string, unknown>>()
  const seenTypes = new Set<string>()
  for (const v of publishedVersions) {
    const lib = publishedLibraries.find(l => l.id === v.libraryId)
    if (!lib) continue
    if (seenTypes.has(lib.libraryType)) continue
    seenTypes.add(lib.libraryType)
    versionPayloads.set(lib.libraryType, v.payload as Record<string, unknown>)
  }

  // 如果传了 versionId，额外加载该版本（可能是 draft），覆盖对应库类型的 payload
  if (versionId) {
    const targetVersion = await db.select({
      id: schema.moduleResourceVersions.id,
      libraryId: schema.moduleResourceVersions.libraryId,
      payload: schema.moduleResourceVersions.payload,
    }).from(schema.moduleResourceVersions)
      .where(eq(schema.moduleResourceVersions.id, versionId))
      .limit(1)

    const tv = targetVersion[0]
    if (tv) {
      let targetLib = publishedLibraries.find(l => l.id === tv.libraryId)
      if (!targetLib) {
        const libRow = await db.select({
          id: schema.moduleResourceLibraries.id,
          libraryType: schema.moduleResourceLibraries.libraryType,
        })
          .from(schema.moduleResourceLibraries)
          .where(eq(schema.moduleResourceLibraries.id, tv.libraryId))
          .limit(1)
        if (libRow[0]) {
          targetLib = libRow[0]
        }
      }

      if (targetLib) {
        versionPayloads.set(targetLib.libraryType, tv.payload as Record<string, unknown>)
        if (!publishedLibraries.some(l => l.id === tv.libraryId)) {
          publishedLibraries.push({ id: tv.libraryId, libraryType: targetLib.libraryType })
        }
      }
    }
  }

  const report = checkCrossReferences(module, publishedLibraries, versionPayloads)
  return report
})
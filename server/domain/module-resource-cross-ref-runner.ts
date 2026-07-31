/**
 * 跨库引用校验的执行入口。
 *
 * checkCrossReferences 是纯函数，需要「该模块所有库的 payload」才能跑。
 * 组装这份 payload 的逻辑原本只写在 cross-ref-check.get.ts 里，导致校验
 * 只有编辑器的「校验关联」按钮能触发——导入和发布都不跑，勾了
 * 「预检通过后直接发布」就能把跨库断裂的资源直接推上线。
 *
 * 这里把组装逻辑抽出来，让导入预检、导入、发布三条路径共用同一份校验。
 */
import type { H3Event } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import type { LibraryType, ModuleId } from '../../shared/contracts'
import { schema, useDb } from '../utils/db'
import { checkCrossReferences } from './module-resource-cross-ref'

/**
 * 用什么覆盖现行已发布的 payload：
 * - byVersion   已入库的版本（可以是 draft），供编辑器和发布路径使用
 * - byPayload   还没入库的解析结果，供导入预检使用
 */
export type CrossRefOverride =
  | { kind: 'byVersion', versionId: string }
  | { kind: 'byPayload', libraryType: LibraryType, payload: Record<string, unknown> }

export async function runCrossRefCheck(
  event: H3Event,
  module: ModuleId,
  override?: CrossRefOverride
) {
  const db = useDb(event)

  const libraries = await db.select({
    id: schema.moduleResourceLibraries.id,
    libraryType: schema.moduleResourceLibraries.libraryType
  }).from(schema.moduleResourceLibraries)
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global')
    ))

  const publishedVersions = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    payload: schema.moduleResourceVersions.payload
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      eq(schema.moduleResourceVersions.status, 'published')
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt))

  // 每种库类型只取最新发布的那一份
  const payloads = new Map<string, Record<string, unknown>>()
  const seenTypes = new Set<string>()
  for (const version of publishedVersions) {
    const library = libraries.find(item => item.id === version.libraryId)
    if (!library || seenTypes.has(library.libraryType)) continue
    seenTypes.add(library.libraryType)
    payloads.set(library.libraryType, version.payload as Record<string, unknown>)
  }

  if (override?.kind === 'byPayload') {
    payloads.set(override.libraryType, override.payload)
    // 待导入的库可能还不存在，补进去才能让「缺失依赖库」那条链判断正确
    if (!libraries.some(item => item.libraryType === override.libraryType)) {
      libraries.push({ id: `pending:${override.libraryType}`, libraryType: override.libraryType })
    }
  } else if (override?.kind === 'byVersion') {
    const [target] = await db.select({
      libraryId: schema.moduleResourceVersions.libraryId,
      payload: schema.moduleResourceVersions.payload
    }).from(schema.moduleResourceVersions)
      .where(eq(schema.moduleResourceVersions.id, override.versionId))
      .limit(1)

    if (target) {
      let library = libraries.find(item => item.id === target.libraryId)
      if (!library) {
        const [row] = await db.select({
          id: schema.moduleResourceLibraries.id,
          libraryType: schema.moduleResourceLibraries.libraryType
        }).from(schema.moduleResourceLibraries)
          .where(eq(schema.moduleResourceLibraries.id, target.libraryId))
          .limit(1)
        if (row) {
          library = row
          libraries.push(row)
        }
      }
      if (library) payloads.set(library.libraryType, target.payload as Record<string, unknown>)
    }
  }

  return checkCrossReferences(module, libraries, payloads)
}

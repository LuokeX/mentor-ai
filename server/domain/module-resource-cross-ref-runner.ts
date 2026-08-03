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
import { and, desc, eq, or } from 'drizzle-orm'
import type { LibraryType, ModuleId, ModuleResourceScope } from '../../shared/contracts'
import { schema, useDb } from '../utils/db'
import { checkCrossReferences } from './module-resource-cross-ref'

/**
 * 用什么覆盖现行已发布的 payload：
 * - byVersion   已入库的版本（可以是 draft），供编辑器和发布路径使用
 * - byPayload   还没入库的解析结果，供导入预检使用
 */
export type CrossRefOverride =
  | { kind: 'byVersion', versionId: string }
  | {
    kind: 'byPayload'
    libraryType: LibraryType
    payload: Record<string, unknown>
    scope?: ModuleResourceScope
    schoolId?: string | null
  }

export interface CrossRefPayloadCandidate {
  libraryType: LibraryType
  scope: ModuleResourceScope
  schoolId: string | null
  payload: Record<string, unknown>
}

/**
 * 把「正在导入/正在发布的那一份」放进候选集，并顶掉同一格（库类型＋范围＋学校）
 * 上已发布的那一份。
 *
 * 不顶掉的话 selectEffectiveCrossRefPayloads 的 find 会取到先入列的已发布版本，
 * 于是预检校验的是库里的旧数据而不是你正在上传的文件——写错的引用会一路放行。
 */
function upsertCandidate(candidates: CrossRefPayloadCandidate[], entry: CrossRefPayloadCandidate) {
  const index = candidates.findIndex(item =>
    item.libraryType === entry.libraryType
    && item.scope === entry.scope
    && item.schoolId === entry.schoolId)
  if (index >= 0) candidates.splice(index, 1, entry)
  else candidates.push(entry)
}

export function selectEffectiveCrossRefPayloads(
  candidates: CrossRefPayloadCandidate[],
  schoolId?: string | null
) {
  const payloads = new Map<string, Record<string, unknown>>()
  const libraries: Array<{ libraryType: string }> = []
  const libraryTypes: LibraryType[] = ['assessment', 'attribution', 'tool', 'output_template', 'keyword_route']
  for (const libraryType of libraryTypes) {
    const scoped = schoolId
      ? candidates.find(item =>
          item.libraryType === libraryType
          && item.scope === 'school'
          && item.schoolId === schoolId)
      : undefined
    const global = candidates.find(item => item.libraryType === libraryType && item.scope === 'global')
    const picked = scoped || global
    if (!picked) continue
    payloads.set(libraryType, picked.payload)
    libraries.push({ libraryType })
  }
  return { libraries, payloads }
}

export async function runCrossRefCheck(
  event: H3Event,
  module: ModuleId,
  override?: CrossRefOverride,
  options: { schoolId?: string | null } = {}
) {
  const db = useDb(event)
  let effectiveSchoolId = options.schoolId ?? null
  if (!effectiveSchoolId && override?.kind === 'byPayload' && override.scope === 'school') {
    effectiveSchoolId = override.schoolId ?? null
  }

  const overrideVersion = override?.kind === 'byVersion'
    ? await db.select({
        libraryId: schema.moduleResourceVersions.libraryId,
        payload: schema.moduleResourceVersions.payload,
        libraryType: schema.moduleResourceLibraries.libraryType,
        scope: schema.moduleResourceLibraries.scope,
        schoolId: schema.moduleResourceLibraries.schoolId
      }).from(schema.moduleResourceVersions)
        .innerJoin(schema.moduleResourceLibraries,
          eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
        .where(eq(schema.moduleResourceVersions.id, override.versionId))
        .limit(1)
    : []
  const targetVersion = overrideVersion[0]
  if (!effectiveSchoolId && targetVersion?.scope === 'school') {
    effectiveSchoolId = targetVersion.schoolId
  }

  const scopeCondition = effectiveSchoolId
    ? or(
        eq(schema.moduleResourceLibraries.scope, 'global'),
        and(
          eq(schema.moduleResourceLibraries.scope, 'school'),
          eq(schema.moduleResourceLibraries.schoolId, effectiveSchoolId)
        )
      )!
    : eq(schema.moduleResourceLibraries.scope, 'global')

  const libraries = await db.select({
    id: schema.moduleResourceLibraries.id,
    libraryType: schema.moduleResourceLibraries.libraryType,
    scope: schema.moduleResourceLibraries.scope,
    schoolId: schema.moduleResourceLibraries.schoolId
  }).from(schema.moduleResourceLibraries)
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      scopeCondition
    ))

  const publishedVersions = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    payload: schema.moduleResourceVersions.payload,
    libraryType: schema.moduleResourceLibraries.libraryType,
    scope: schema.moduleResourceLibraries.scope,
    schoolId: schema.moduleResourceLibraries.schoolId
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, module),
      scopeCondition,
      eq(schema.moduleResourceVersions.status, 'published')
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt))

  const candidates: CrossRefPayloadCandidate[] = []
  const seenLibraryIds = new Set<string>()
  for (const version of publishedVersions) {
    if (seenLibraryIds.has(version.libraryId)) continue
    seenLibraryIds.add(version.libraryId)
    candidates.push({
      libraryType: version.libraryType as LibraryType,
      scope: version.scope as ModuleResourceScope,
      schoolId: version.schoolId,
      payload: version.payload as Record<string, unknown>
    })
  }

  if (override?.kind === 'byPayload') {
    const overrideScope = override.scope ?? (override.schoolId ? 'school' : 'global')
    const overrideSchoolId = overrideScope === 'school'
      ? override.schoolId ?? effectiveSchoolId
      : null
    if (!effectiveSchoolId && overrideScope === 'school') effectiveSchoolId = overrideSchoolId ?? null
    // 必须顶掉同一格已发布的那份，否则校验的是库里的旧数据而不是这次要导入的文件
    upsertCandidate(candidates, {
      libraryType: override.libraryType,
      scope: overrideScope,
      schoolId: overrideSchoolId ?? null,
      payload: override.payload
    })
    // 待导入的库可能还不存在，补进去才能让「缺失依赖库」那条链判断正确
    if (!libraries.some(item => item.libraryType === override.libraryType)) {
      libraries.push({
        id: `pending:${override.libraryType}`,
        libraryType: override.libraryType,
        scope: overrideScope,
        schoolId: overrideSchoolId ?? null
      })
    }
  } else if (targetVersion) {
    // 同理：发布闸门要校验待发布的这一版，不是它那个已发布的兄弟版本
    upsertCandidate(candidates, {
      libraryType: targetVersion.libraryType as LibraryType,
      scope: targetVersion.scope as ModuleResourceScope,
      schoolId: targetVersion.schoolId,
      payload: targetVersion.payload as Record<string, unknown>
    })
    if (!libraries.some(item => item.id === targetVersion.libraryId)) {
      libraries.push({
        id: targetVersion.libraryId,
        libraryType: targetVersion.libraryType,
        scope: targetVersion.scope,
        schoolId: targetVersion.schoolId
      })
    }
  }

  // 与运行时 resolvePublishedModuleResource 保持一致：
  // 本校有已发布校本版本时用校本，否则回退平台发布版本。
  const effective = selectEffectiveCrossRefPayloads(candidates, effectiveSchoolId)
  return checkCrossReferences(module, effective.libraries, effective.payloads)
}

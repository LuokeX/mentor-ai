import { and, desc, eq, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { assessmentDefinitions } from '../../shared/assessments'
import type { AssessmentDefinition } from '../../shared/assessments'
import type { AttributionConfig, LibraryType, ModuleId } from '../../shared/contracts'
import type { ModuleResourceCounterpart } from './module-resource-validation'
import { schema, useDb } from '../utils/db'

export const documentLibraryTypes: LibraryType[] = ['assessment', 'attribution', 'tool']
type AssessmentResourcePayload = AssessmentDefinition | { instruments?: AssessmentDefinition[] }

export interface ResolvedModuleResource<T> {
  payload: T
  source: 'module_resource' | 'content_package' | 'fallback'
  sourceVersions: string[]
  libraryId?: string
  versionId?: string
  scope?: 'global' | 'school'
  schoolId?: string | null
}

export function filterVisiblePublishedLibraries<T extends { libraryType: string, scope: string, schoolId: string | null }>(
  libraries: T[],
  schoolId?: string | null
) {
  const schoolOverrides = new Set(
    libraries
      .filter(item => item.scope === 'school' && item.schoolId === schoolId)
      .map(item => item.libraryType)
  )
  return libraries.filter(item =>
    (item.scope === 'school' && item.schoolId === schoolId)
    || (item.scope === 'global' && !schoolOverrides.has(item.libraryType))
  )
}

export async function resolvePublishedModuleResource<T>(
  event: H3Event,
  input: { module: ModuleId, libraryType: LibraryType, schoolId?: string | null }
): Promise<ResolvedModuleResource<T> | null> {
  const db = useDb(event)
  const baseSelect = {
    payload: schema.moduleResourceVersions.payload,
    version: schema.moduleResourceVersions.version,
    versionId: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceLibraries.id,
    scope: schema.moduleResourceLibraries.scope,
    schoolId: schema.moduleResourceLibraries.schoolId
  }
  if (input.schoolId) {
    const [schoolResource] = await db.select(baseSelect)
      .from(schema.moduleResourceVersions)
      .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
      .where(and(
        eq(schema.moduleResourceVersions.status, 'published'),
        eq(schema.moduleResourceLibraries.module, input.module),
        eq(schema.moduleResourceLibraries.libraryType, input.libraryType),
        eq(schema.moduleResourceLibraries.scope, 'school'),
        eq(schema.moduleResourceLibraries.schoolId, input.schoolId)
      ))
      .orderBy(desc(schema.moduleResourceVersions.publishedAt), desc(schema.moduleResourceVersions.updatedAt))
      .limit(1)
    if (schoolResource) return {
      payload: schoolResource.payload as T,
      source: 'module_resource',
      sourceVersions: [`module-resource:${input.module}:${input.libraryType}:school:${schoolResource.version}`],
      libraryId: schoolResource.libraryId,
      versionId: schoolResource.versionId,
      scope: 'school',
      schoolId: schoolResource.schoolId
    }
  }

  const [globalResource] = await db.select(baseSelect)
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceVersions.status, 'published'),
      eq(schema.moduleResourceLibraries.module, input.module),
      eq(schema.moduleResourceLibraries.libraryType, input.libraryType),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId)
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt), desc(schema.moduleResourceVersions.updatedAt))
    .limit(1)
  if (!globalResource) return null
  return {
    payload: globalResource.payload as T,
    source: 'module_resource',
    sourceVersions: [`module-resource:${input.module}:${input.libraryType}:global:${globalResource.version}`],
    libraryId: globalResource.libraryId,
    versionId: globalResource.versionId,
    scope: 'global',
    schoolId: globalResource.schoolId
  }
}

export async function resolveContentPackage<T>(
  event: H3Event,
  code: string
): Promise<ResolvedModuleResource<T> | null> {
  const [row] = await useDb(event)
    .select({ payload: schema.contentPackages.payload, code: schema.contentPackages.code, version: schema.contentPackages.version })
    .from(schema.contentPackages)
    .where(and(eq(schema.contentPackages.code, code), eq(schema.contentPackages.status, 'published')))
    .orderBy(desc(schema.contentPackages.version))
    .limit(1)
  if (!row) return null
  return {
    payload: row.payload as T,
    source: 'content_package',
    sourceVersions: [`content-package:${row.code}:${row.version}`]
  }
}

export async function resolveAssessmentDefinition(
  event: H3Event,
  module: ModuleId,
  schoolId?: string | null,
  instrumentCode?: string
): Promise<ResolvedModuleResource<AssessmentDefinition>> {
  if (instrumentCode) {
    // 查找特定 instrument：从所有 published versions 中匹配 instrumentCode
    const allInstruments = await listAssessmentInstruments(event, module, schoolId)
    const matched = allInstruments.find(i => i.code === instrumentCode || i.instrumentCode === instrumentCode)
    if (matched) {
      return {
        payload: matched,
        source: 'module_resource',
        sourceVersions: [`module-resource:${module}:assessment:${instrumentCode}`]
      }
    }
  }

  const moduleResource = await resolvePublishedModuleResource<AssessmentResourcePayload>(event, { module, libraryType: 'assessment', schoolId })
  if (moduleResource) return normalizeAssessmentDefinition(moduleResource, module)
  const contentPackage = await resolveContentPackage<AssessmentDefinition>(event, `assessment-${module}`)
  if (contentPackage) return normalizeAssessmentDefinition(contentPackage, module)
  return { payload: assessmentDefinitions[module], source: 'fallback', sourceVersions: [`fallback:assessment:${module}:${assessmentDefinitions[module].version}`] }
}

/**
 * 列出某个模块下所有已发布的评估量表（支持多 instrument）
 */
export async function listAssessmentInstruments(
  event: H3Event,
  module: ModuleId,
  schoolId?: string | null
): Promise<AssessmentDefinition[]> {
  const db = useDb(event)
  const instruments: AssessmentDefinition[] = []

  // 查询所有 published 的 assessment 版本
  const baseConditions = [
    eq(schema.moduleResourceVersions.status, 'published'),
    eq(schema.moduleResourceLibraries.module, module),
    eq(schema.moduleResourceLibraries.libraryType, 'assessment'),
  ]

  // 先查 school 级别
  if (schoolId) {
    const schoolRows = await db.select({
      payload: schema.moduleResourceVersions.payload,
      version: schema.moduleResourceVersions.version,
    })
      .from(schema.moduleResourceVersions)
      .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
      .where(and(
        ...baseConditions,
        eq(schema.moduleResourceLibraries.scope, 'school'),
        eq(schema.moduleResourceLibraries.schoolId, schoolId)
      ))
      .orderBy(desc(schema.moduleResourceVersions.publishedAt))

    for (const row of schoolRows) {
      const payload = row.payload as Record<string, unknown>
      // payload 可能是单个 AssessmentDefinition 或 { instruments: [...] }
      if (payload.instruments && Array.isArray(payload.instruments)) {
        for (const inst of payload.instruments as AssessmentDefinition[]) {
          instruments.push({ ...inst, module, version: row.version })
        }
      } else if (payload.code || payload.title) {
        instruments.push({ ...payload as unknown as AssessmentDefinition, module, version: row.version })
      }
    }
  }

  // 再查 global 级别（如果 school 没有覆盖的）
  const presentCodes = new Set(instruments.map(i => i.code))
  const globalRows = await db.select({
    payload: schema.moduleResourceVersions.payload,
    version: schema.moduleResourceVersions.version,
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      ...baseConditions,
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId)
    ))
    .orderBy(desc(schema.moduleResourceVersions.publishedAt))

  for (const row of globalRows) {
    const payload = row.payload as Record<string, unknown>
    if (payload.instruments && Array.isArray(payload.instruments)) {
      for (const inst of payload.instruments as AssessmentDefinition[]) {
        if (!presentCodes.has(inst.code)) {
          instruments.push({ ...inst, module, version: row.version })
        }
      }
    } else if (payload.code || payload.title) {
      const code = (payload.code as string) || `assessment-${module}`
      if (!presentCodes.has(code)) {
        instruments.push({ ...payload as unknown as AssessmentDefinition, module, version: row.version })
      }
    }
  }

  // 如果没有动态 instrument，fallback 到硬编码
  if (instruments.length === 0) {
    instruments.push(assessmentDefinitions[module])
  }

  return instruments
}

export async function resolveAttributionConfig(
  event: H3Event,
  module: ModuleId,
  schoolId?: string | null
): Promise<ResolvedModuleResource<AttributionConfig> | null> {
  const moduleResource = await resolvePublishedModuleResource<AttributionConfig>(event, { module, libraryType: 'attribution', schoolId })
  if (moduleResource) return moduleResource
  return resolveContentPackage<AttributionConfig>(event, `attribution-${module}`)
}

export async function listPublishedModuleTools(event: H3Event, module: ModuleId, schoolId?: string | null) {
  const resource = await resolvePublishedModuleResource<{ tools?: unknown[] } | unknown[]>(event, { module, libraryType: 'tool', schoolId })
  if (!resource) return { tools: [], sourceVersions: [] as string[] }
  const payload = resource.payload
  const tools = Array.isArray(payload) ? payload : Array.isArray((payload as { tools?: unknown[] }).tools) ? (payload as { tools: unknown[] }).tools : []
  return { tools, sourceVersions: resource.sourceVersions }
}

function normalizeAssessmentDefinition(resource: ResolvedModuleResource<AssessmentResourcePayload>, module: ModuleId): ResolvedModuleResource<AssessmentDefinition> {
  const payload = Array.isArray((resource.payload as { instruments?: AssessmentDefinition[] }).instruments)
    ? (resource.payload as { instruments: AssessmentDefinition[] }).instruments[0]
    : resource.payload as AssessmentDefinition
  if (!payload) {
    return {
      payload: assessmentDefinitions[module],
      source: 'fallback',
      sourceVersions: [`fallback:assessment:${module}:${assessmentDefinitions[module].version}`]
    }
  }
  return {
    ...resource,
    payload: {
      ...payload,
      module,
      code: payload.code || `assessment-${module}`,
      version: payload.version || resource.sourceVersions[0]?.split(':').pop() || '1.0.0'
    }
  }
}

/**
 * 解析同模块另一侧的生效资源，供发布前交叉校验和运营台预览使用。
 * 发布量表时要拿到现行归因库，发布归因库时要拿到现行量表 —— 两者必须成对自洽。
 */
export async function resolveModuleResourceCounterpart(
  event: H3Event,
  input: { module: ModuleId, libraryType: LibraryType, schoolId?: string | null }
): Promise<ModuleResourceCounterpart> {
  if (input.libraryType === 'attribution') {
    const assessment = await resolveAssessmentDefinition(event, input.module, input.schoolId)
    return { assessmentDefinition: assessment.payload }
  }
  if (input.libraryType === 'assessment') {
    const attribution = await resolveAttributionConfig(event, input.module, input.schoolId)
    return { attributionConfig: attribution?.payload ?? null }
  }
  return {}
}

import { and, desc, eq, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { assessmentDefinitions } from '../../shared/assessments'
import type { AssessmentDefinition } from '../../shared/assessments'
import type { LibraryType, ModuleId } from '../../shared/contracts'
import type { RuleConfig } from '../../shared/contracts'
import { schema, useDb } from '../utils/db'

export const documentLibraryTypes: LibraryType[] = ['professional_knowledge', 'sop', 'script', 'case', 'tool', 'prompt']

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
  schoolId?: string | null
): Promise<ResolvedModuleResource<AssessmentDefinition>> {
  const moduleResource = await resolvePublishedModuleResource<AssessmentDefinition>(event, { module, libraryType: 'assessment', schoolId })
  if (moduleResource) return normalizeAssessmentDefinition(moduleResource, module)
  const contentPackage = await resolveContentPackage<AssessmentDefinition>(event, `assessment-${module}`)
  if (contentPackage) return normalizeAssessmentDefinition(contentPackage, module)
  return { payload: assessmentDefinitions[module], source: 'fallback', sourceVersions: [`fallback:assessment:${module}:${assessmentDefinitions[module].version}`] }
}

export async function resolveRuleConfig(
  event: H3Event,
  module: ModuleId,
  schoolId?: string | null
): Promise<ResolvedModuleResource<RuleConfig> | null> {
  const moduleResource = await resolvePublishedModuleResource<RuleConfig>(event, { module, libraryType: 'rules', schoolId })
  if (moduleResource) return moduleResource
  return resolveContentPackage<RuleConfig>(event, `rules-${module}`)
}

export async function listPublishedModuleTools(event: H3Event, module: ModuleId, schoolId?: string | null) {
  const resource = await resolvePublishedModuleResource<{ tools?: unknown[] } | unknown[]>(event, { module, libraryType: 'tool', schoolId })
  if (!resource) return { tools: [], sourceVersions: [] as string[] }
  const payload = resource.payload
  const tools = Array.isArray(payload) ? payload : Array.isArray((payload as { tools?: unknown[] }).tools) ? (payload as { tools: unknown[] }).tools : []
  return { tools, sourceVersions: resource.sourceVersions }
}

function normalizeAssessmentDefinition(resource: ResolvedModuleResource<AssessmentDefinition>, module: ModuleId): ResolvedModuleResource<AssessmentDefinition> {
  return {
    ...resource,
    payload: {
      ...resource.payload,
      module,
      code: resource.payload.code || `assessment-${module}`,
      version: resource.payload.version || resource.sourceVersions[0]?.split(':').pop() || '1.0.0'
    }
  }
}

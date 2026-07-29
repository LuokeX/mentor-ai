import { eq } from 'drizzle-orm'
import type { LibraryType, ModuleId, ModuleResourceScope } from '../../../../../../../shared/contracts'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { projectModuleResourcePayload } from '../../../../../../domain/module-resource-projection'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)
  const [version] = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    payload: schema.moduleResourceVersions.payload,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    scope: schema.moduleResourceLibraries.scope,
    schoolId: schema.moduleResourceLibraries.schoolId
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceVersions.id, id))
    .limit(1)

  if (!version) throw createError({ statusCode: 404, message: '资源版本不存在' })
  const projection = projectModuleResourcePayload({
    libraryId: version.libraryId,
    versionId: version.id,
    module: version.module as ModuleId,
    libraryType: version.libraryType as LibraryType,
    scope: version.scope as ModuleResourceScope,
    schoolId: version.schoolId
  }, version.payload as Record<string, unknown>)

  const [assessments, attributionRules, tools] = await Promise.all([
    db.select().from(schema.moduleResourceAssessmentItems)
      .where(eq(schema.moduleResourceAssessmentItems.versionId, id)),
    db.select().from(schema.moduleResourceAttributionRules)
      .where(eq(schema.moduleResourceAttributionRules.versionId, id)),
    db.select().from(schema.moduleResourceToolItems)
      .where(eq(schema.moduleResourceToolItems.versionId, id))
  ])

  return {
    version: {
      id: version.id,
      libraryId: version.libraryId,
      version: version.version,
      status: version.status,
      module: version.module,
      libraryType: version.libraryType,
      scope: version.scope,
      schoolId: version.schoolId
    },
    summary: {
      assessmentCount: assessments.length,
      attributionRuleCount: attributionRules.length,
      attributionItemCount: projection.attributionItems.length,
      toolCount: tools.length,
      templateCount: projection.outputTemplates.length,
      routeCount: projection.keywordRoutes.length
    },
    assessments,
    attributionRules,
    attributionItems: projection.attributionItems,
    tools,
    outputTemplates: projection.outputTemplates,
    keywordRoutes: projection.keywordRoutes
  }
})

import { eq } from 'drizzle-orm'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)
  const [version] = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
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

  const [assessments, attributionRules, tools] = await Promise.all([
    db.select().from(schema.moduleResourceAssessmentItems)
      .where(eq(schema.moduleResourceAssessmentItems.versionId, id)),
    db.select().from(schema.moduleResourceAttributionRules)
      .where(eq(schema.moduleResourceAttributionRules.versionId, id)),
    db.select().from(schema.moduleResourceToolItems)
      .where(eq(schema.moduleResourceToolItems.versionId, id))
  ])

  return {
    version,
    summary: {
      assessmentCount: assessments.length,
      attributionRuleCount: attributionRules.length,
      toolCount: tools.length
    },
    assessments,
    attributionRules,
    tools
  }
})

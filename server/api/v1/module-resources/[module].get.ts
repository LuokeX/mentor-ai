import { and, eq } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../shared/contracts'
import { filterVisiblePublishedLibraries, listPublishedModuleTools, resolveAssessmentDefinition } from '../../../domain/module-resources'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const db = useDb(event)
  const [assessment, tools, libraries] = await Promise.all([
    resolveAssessmentDefinition(event, module, user.schoolId),
    listPublishedModuleTools(event, module, user.schoolId),
    db.select({
      id: schema.moduleResourceLibraries.id,
      module: schema.moduleResourceLibraries.module,
      libraryType: schema.moduleResourceLibraries.libraryType,
      name: schema.moduleResourceLibraries.name,
      description: schema.moduleResourceLibraries.description,
      scope: schema.moduleResourceLibraries.scope,
      schoolId: schema.moduleResourceLibraries.schoolId,
      versionId: schema.moduleResourceVersions.id,
      version: schema.moduleResourceVersions.version,
      publishedAt: schema.moduleResourceVersions.publishedAt
    })
      .from(schema.moduleResourceVersions)
      .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
      .where(and(
        eq(schema.moduleResourceVersions.status, 'published'),
        eq(schema.moduleResourceLibraries.module, module)
      ))
  ])
  const visibleLibraries = filterVisiblePublishedLibraries(libraries, user.schoolId)
  return {
    module,
    assessment: {
      title: assessment.payload.title,
      code: assessment.payload.code,
      version: assessment.payload.version,
      questionCount: assessment.payload.questions.length,
      sourceVersions: assessment.sourceVersions
    },
    tools,
    libraries: visibleLibraries.map(item => ({
      id: item.id,
      libraryType: item.libraryType,
      name: item.name,
      description: item.description,
      scope: item.scope,
      versionId: item.versionId,
      version: item.version,
      publishedAt: item.publishedAt
    }))
  }
})

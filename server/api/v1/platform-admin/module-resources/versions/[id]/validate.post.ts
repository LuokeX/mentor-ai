import { eq } from 'drizzle-orm'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { validateModuleResourcePayload } from '../../../../../../domain/module-resource-validation'
import { resolveModuleResourceCounterpart } from '../../../../../../domain/module-resources'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const [version] = await useDb(event).select({
    id: schema.moduleResourceVersions.id,
    payload: schema.moduleResourceVersions.payload,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    schoolId: schema.moduleResourceLibraries.schoolId
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceVersions.id, id))
    .limit(1)
  if (!version) throw createError({ statusCode: 404, message: '资源版本不存在' })

  const counterpart = await resolveModuleResourceCounterpart(event, {
    module: version.module as any,
    libraryType: version.libraryType as any,
    schoolId: version.schoolId
  })
  return validateModuleResourcePayload({
    module: version.module as any,
    libraryType: version.libraryType as any,
    payload: version.payload as Record<string, unknown>,
    counterpart
  })
})

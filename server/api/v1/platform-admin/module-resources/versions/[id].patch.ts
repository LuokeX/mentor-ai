import { and, eq, ne } from 'drizzle-orm'
import { moduleResourceVersionActionSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'
import { validateModuleResourcePayload } from '../../../../../domain/module-resource-validation'
import { resolveModuleResourceCounterpart } from '../../../../../domain/module-resources'
import { rebuildModuleResourceProjection } from '../../../../../domain/module-resource-projection'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const body = moduleResourceVersionActionSchema.parse(await readBody(event))
  const db = useDb(event)
  const [version] = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    status: schema.moduleResourceVersions.status,
    version: schema.moduleResourceVersions.version,
    payload: schema.moduleResourceVersions.payload,
    schoolId: schema.moduleResourceLibraries.schoolId,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    scope: schema.moduleResourceLibraries.scope
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceVersions.id, id))
    .limit(1)
  if (!version) throw createError({ statusCode: 404, message: '资源版本不存在' })

  const shouldPublish = body.action === 'publish' || body.action === 'rollback'
  if (shouldPublish) {
    const validation = validateModuleResourcePayload({
      module: version.module as any,
      libraryType: version.libraryType as any,
      payload: version.payload as Record<string, unknown>,
      counterpart: await resolveModuleResourceCounterpart(event, {
        module: version.module as any,
        libraryType: version.libraryType as any,
        schoolId: version.schoolId
      })
    })
    if (!validation.ok) {
      throw createError({
        statusCode: 422,
        message: `资源版本校验失败：${validation.errors.map(item => item.message).join('；')}`
      })
    }
  }
  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    if (shouldPublish) {
      await rebuildModuleResourceProjection(tx, {
        libraryId: version.libraryId,
        versionId: version.id,
        module: version.module as any,
        libraryType: version.libraryType as any,
        scope: version.scope as any,
        schoolId: version.schoolId
      }, version.payload as Record<string, unknown>)
      await tx.update(schema.moduleResourceVersions).set({ status: 'retired', updatedAt: now })
        .where(and(
          eq(schema.moduleResourceVersions.libraryId, version.libraryId),
          eq(schema.moduleResourceVersions.status, 'published'),
          ne(schema.moduleResourceVersions.id, id)
        ))
      await tx.update(schema.moduleResourceDocuments).set({ status: 'ready', updatedAt: now })
        .where(and(
          eq(schema.moduleResourceDocuments.versionId, id),
          eq(schema.moduleResourceDocuments.status, 'draft')
        ))
    }
    const [row] = await tx.update(schema.moduleResourceVersions).set({
      status: shouldPublish ? 'published' : 'retired',
      publishedBy: shouldPublish ? admin.id : null,
      publishedAt: shouldPublish ? now : null,
      updatedAt: now
    }).where(eq(schema.moduleResourceVersions.id, id)).returning()
    return row
  })
  if (!updated) throw createError({ statusCode: 404, message: '资源版本不存在' })
  await writeAudit(event, {
    actorId: admin.id,
    schoolId: version.schoolId,
    action: `platform_admin.module_resource_version.${body.action}`,
    targetType: 'module_resource_version',
    targetId: id,
    metadata: { libraryId: version.libraryId, previousStatus: version.status, module: version.module, libraryType: version.libraryType }
  })
  return updated
})

import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const query = z.object({
    sourceId: z.string().uuid(),
    targetId: z.string().uuid()
  }).parse(getQuery(event))
  const rows = await useDb(event).select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    payload: schema.moduleResourceVersions.payload,
    updatedAt: schema.moduleResourceVersions.updatedAt
  }).from(schema.moduleResourceVersions)
    .where(eq(schema.moduleResourceVersions.id, query.sourceId))
    .limit(1)
  const targets = await useDb(event).select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    payload: schema.moduleResourceVersions.payload,
    updatedAt: schema.moduleResourceVersions.updatedAt
  }).from(schema.moduleResourceVersions)
    .where(eq(schema.moduleResourceVersions.id, query.targetId))
    .limit(1)
  const source = rows[0]
  const target = targets[0]
  if (!source || !target || source.libraryId !== target.libraryId) {
    throw createError({ statusCode: 404, message: '资源版本不存在或不属于同一资源库' })
  }
  return {
    source,
    target,
    sourceJson: JSON.stringify(source.payload, null, 2),
    targetJson: JSON.stringify(target.payload, null, 2)
  }
})

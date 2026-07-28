import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [document] = await db.select({
    id: schema.moduleResourceDocuments.id,
    title: schema.moduleResourceDocuments.title,
    libraryId: schema.moduleResourceDocuments.libraryId,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    schoolId: schema.moduleResourceLibraries.schoolId
  })
    .from(schema.moduleResourceDocuments)
    .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceDocuments.id, id))
    .limit(1)

  if (!document) throw createError({ statusCode: 404, message: '文档不存在' })

  await db.transaction(async (tx) => {
    await tx.delete(schema.moduleResourceChunks)
      .where(eq(schema.moduleResourceChunks.documentId, id))
    await tx.delete(schema.moduleResourceDocuments)
      .where(eq(schema.moduleResourceDocuments.id, id))
  })

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: document.schoolId,
    action: 'platform_admin.module_resource_document.delete',
    targetType: 'module_resource_document',
    targetId: id,
    metadata: { title: document.title, libraryId: document.libraryId, module: document.module, libraryType: document.libraryType }
  })

  return { deleted: true, id }
})
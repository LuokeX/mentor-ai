import { eq } from 'drizzle-orm'
import { moduleResourceVersionCreateSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceVersionCreateSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源版本参数不正确' })
  const body = parsed.data
  const db = useDb(event)
  const [library] = await db.select().from(schema.moduleResourceLibraries).where(eq(schema.moduleResourceLibraries.id, body.libraryId)).limit(1)
  if (!library) throw createError({ statusCode: 404, message: '模块资源库不存在' })
  try {
    const [created] = await db.insert(schema.moduleResourceVersions).values({
      libraryId: library.id,
      version: body.version,
      payload: body.payload,
      notes: body.notes,
      createdBy: admin.id
    }).returning()
    if (!created) throw createError({ statusCode: 500, message: '资源版本创建失败' })
    await writeAudit(event, {
      actorId: admin.id,
      schoolId: library.schoolId,
      action: 'platform_admin.module_resource_version.create',
      targetType: 'module_resource_version',
      targetId: created.id,
      metadata: { libraryId: library.id, module: library.module, libraryType: library.libraryType, version: created.version }
    })
    return created
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '该资源库中已经存在相同版本号' })
    throw error
  }
})

import { eq } from 'drizzle-orm'
import { moduleResourceLibraryCreateSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceLibraryCreateSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '模块资源库参数不正确' })
  const body = parsed.data
  const db = useDb(event)
  if (body.schoolId) {
    const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, body.schoolId)).limit(1)
    if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  }
  try {
    const [created] = await db.insert(schema.moduleResourceLibraries).values({
      module: body.module,
      libraryType: body.libraryType,
      name: body.name,
      description: body.description,
      scope: body.scope,
      schoolId: body.schoolId || null,
      createdBy: admin.id
    }).returning()
    if (!created) throw createError({ statusCode: 500, message: '模块资源库创建失败' })
    await writeAudit(event, {
      actorId: admin.id,
      schoolId: created.schoolId,
      action: 'platform_admin.module_resource_library.create',
      targetType: 'module_resource_library',
      targetId: created.id,
      metadata: { module: created.module, libraryType: created.libraryType, scope: created.scope }
    })
    return created
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '该模块资源库已存在' })
    throw error
  }
})

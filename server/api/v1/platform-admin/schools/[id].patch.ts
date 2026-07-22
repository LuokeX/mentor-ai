import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    name: z.string().trim().min(2).max(160).optional(),
    code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
    status: z.enum(['active', 'disabled']).optional()
  }).refine(value => value.name || value.code || value.status).parse(await readBody(event))
  try {
    const [school] = await useDb(event).update(schema.schools).set({ ...body, updatedAt: new Date() })
      .where(eq(schema.schools.id, id)).returning()
    if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
    await writeAudit(event, {
      actorId: admin.id, schoolId: school.id, action: body.status ? `platform_admin.school.${body.status}` : 'platform_admin.school.update',
      targetType: 'school', targetId: school.id,
      metadata: { nameChanged: Boolean(body.name), codeChanged: Boolean(body.code) }
    })
    return school
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '学校代码已存在' })
    throw error
  }
})

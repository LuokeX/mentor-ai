import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({ status: z.enum(['active', 'disabled']) }).parse(await readBody(event))
  const [school] = await useDb(event).update(schema.schools).set({ status: body.status, updatedAt: new Date() })
    .where(eq(schema.schools.id, id)).returning()
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  await writeAudit(event, {
    actorId: admin.id, schoolId: school.id, action: `platform_admin.school.${body.status}`,
    targetType: 'school', targetId: school.id
  })
  return school
})

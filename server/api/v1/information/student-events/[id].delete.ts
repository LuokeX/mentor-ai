import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [record] = await db.select().from(schema.studentEvents).where(and(
    eq(schema.studentEvents.id, id),
    eq(schema.studentEvents.ownerUserId, user.id)
  )).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '事件不存在' })

  await db.delete(schema.studentEvents).where(eq(schema.studentEvents.id, id))

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'student_event.delete',
    targetType: 'student_event',
    targetId: id
  })

  return { ok: true }
})
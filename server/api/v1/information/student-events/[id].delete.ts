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
    eq(schema.studentEvents.schoolId, user.schoolId),
    eq(schema.studentEvents.ownerUserId, user.id)
  )).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '事件不存在' })

  // 学生事件禁止物理删除，只能归档
  if (record.status === 'archived') {
    throw createError({ statusCode: 409, message: '事件已归档' })
  }

  const [updated] = await db.update(schema.studentEvents).set({
    status: 'archived',
    archivedAt: new Date(),
    archivedBy: user.id,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.studentEvents.id, id),
    eq(schema.studentEvents.schoolId, user.schoolId),
    eq(schema.studentEvents.ownerUserId, user.id),
  )).returning({ id: schema.studentEvents.id })
  if (!updated) throw createError({ statusCode: 409, message: '事件状态已变化，请刷新后重试' })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'student_event.archive',
    targetType: 'student_event',
    targetId: id,
    metadata: { previousStatus: record.status }
  })

  return { ok: true }
})

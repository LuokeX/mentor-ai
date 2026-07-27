import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { writeAudit } from '../../../../../../utils/audit'

const bodySchema = z.object({
  ownerUserId: z.string().uuid(),
  reason: z.string().trim().max(500).optional()
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const schoolId = admin.schoolId!
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id, ownerUserId: schema.students.ownerUserId }).from(schema.students).where(and(eq(schema.students.id, id), eq(schema.students.schoolId, schoolId))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  const [teacher] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, body.ownerUserId), eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'teacher'), eq(schema.users.status, 'active'))).limit(1)
  if (!teacher) throw createError({ statusCode: 422, message: '目标教师不存在或不可用' })
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.students).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(
      eq(schema.students.id, id),
      eq(schema.students.schoolId, schoolId),
    )).returning({ id: schema.students.id })
    if (!updated) throw createError({ statusCode: 409, message: '学生状态已变化，请刷新后重试' })
    await tx.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.studentId, id), eq(schema.communications.schoolId, schoolId)))
    await tx.insert(schema.recordAssignments).values({
      schoolId,
      targetType: 'student',
      targetId: id,
      fromUserId: student.ownerUserId,
      toUserId: body.ownerUserId,
      assignedBy: admin.id,
      reason: body.reason,
      metadata: { action: 'student_owner_update' }
    })
    await writeAudit(event, {
      schoolId,
      actorId: admin.id,
      action: 'school_admin.student.owner.update',
      targetType: 'student',
      targetId: id,
      metadata: { fromUserId: student.ownerUserId, toUserId: body.ownerUserId, reason: body.reason }
    }, tx)
  })
  return { ok: true }
})

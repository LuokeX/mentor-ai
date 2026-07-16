import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { writeAudit } from '../../../../../../utils/audit'

const bodySchema = z.object({
  classId: z.string().uuid().nullable(),
  reason: z.string().trim().max(500).optional()
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const schoolId = admin.schoolId!
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id, classId: schema.students.classId, ownerUserId: schema.students.ownerUserId }).from(schema.students).where(and(eq(schema.students.id, id), eq(schema.students.schoolId, schoolId))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  let targetOwnerUserId = student.ownerUserId
  let targetClassId: string | null = null
  if (body.classId) {
    const [klass] = await db.select({ id: schema.classes.id, ownerUserId: schema.classes.ownerUserId }).from(schema.classes).where(and(eq(schema.classes.id, body.classId), eq(schema.classes.schoolId, schoolId))).limit(1)
    if (!klass) throw createError({ statusCode: 422, message: '目标班级不存在' })
    targetOwnerUserId = klass.ownerUserId
    targetClassId = klass.id
  }
  await db.update(schema.students).set({ classId: targetClassId, ownerUserId: targetOwnerUserId, updatedAt: new Date() }).where(eq(schema.students.id, id))
  await db.update(schema.communications).set({ ownerUserId: targetOwnerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.studentId, id), eq(schema.communications.schoolId, schoolId)))
  await db.insert(schema.recordAssignments).values({
    schoolId,
    targetType: 'student',
    targetId: id,
    fromUserId: student.ownerUserId,
    toUserId: targetOwnerUserId,
    assignedBy: admin.id,
    reason: body.reason,
    metadata: { action: 'student_class_transfer', fromClassId: student.classId, toClassId: targetClassId }
  })
  await writeAudit(event, {
    schoolId,
    actorId: admin.id,
    action: 'school_admin.student.class.update',
    targetType: 'student',
    targetId: id,
    metadata: { fromClassId: student.classId, toClassId: targetClassId, ownerUserId: targetOwnerUserId, reason: body.reason }
  })
  return { ok: true, ownerUserId: targetOwnerUserId, classId: targetClassId }
})

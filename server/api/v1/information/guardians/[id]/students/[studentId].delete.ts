import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { writeAudit } from '../../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const studentId = z.string().uuid().parse(getRouterParam(event, 'studentId'))
  const db = useDb(event)
  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(eq(schema.guardians.id, id), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  const [student] = await db.select({ id: schema.students.id }).from(schema.students).where(and(eq(schema.students.id, studentId), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId!))).limit(1)
  if (!student) throw createError({ statusCode: 422, message: '学生不存在或不属于当前教师' })
  await db.delete(schema.studentGuardians).where(and(eq(schema.studentGuardians.studentId, studentId), eq(schema.studentGuardians.guardianId, id)))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.guardian.student.unlink', targetType: 'guardian', targetId: id, metadata: { studentId } })
  return { ok: true }
})

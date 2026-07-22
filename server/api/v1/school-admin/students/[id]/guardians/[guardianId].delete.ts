import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../../../domain/school-management'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['guardians', 'students'])
  const studentId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const guardianId = z.string().uuid().parse(getRouterParam(event, 'guardianId'))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id }).from(schema.students)
    .where(and(eq(schema.students.id, studentId), eq(schema.students.schoolId, schoolId))).limit(1)
  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians)
    .where(and(eq(schema.guardians.id, guardianId), eq(schema.guardians.schoolId, schoolId))).limit(1)
  if (!student || !guardian) throw createError({ statusCode: 404, message: '学生或家长不存在' })
  await db.delete(schema.studentGuardians).where(and(
    eq(schema.studentGuardians.studentId, studentId),
    eq(schema.studentGuardians.guardianId, guardianId)
  ))
  await writeAudit(event, {
    schoolId, actorId: actor.id, action: 'school_admin.student_guardian.unlink',
    targetType: 'student', targetId: studentId,
    metadata: { guardianId, delegatedGrantId }
  })
  return { ok: true }
})

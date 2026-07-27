import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { writeAudit } from '../../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const guardianId = z.string().uuid().parse(getRouterParam(event, 'guardianId'))
  const db = useDb(event)

  const [student] = await db.select({ id: schema.students.id }).from(schema.students)
    .where(and(eq(schema.students.id, id), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId!))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })

  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians)
    .where(and(eq(schema.guardians.id, guardianId), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).limit(1)
  if (!guardian) throw createError({ statusCode: 422, message: '家长不存在或不属于当前教师' })

  // 学生-家长关系不物理删除，改为标记为 removed
  const [rel] = await db.select({ studentId: schema.studentGuardians.studentId, guardianId: schema.studentGuardians.guardianId })
    .from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.studentId, id),
      eq(schema.studentGuardians.guardianId, guardianId),
      eq(schema.studentGuardians.schoolId, user.schoolId!),
      eq(schema.studentGuardians.status, 'active')
    )).limit(1)

  if (!rel) throw createError({ statusCode: 404, message: '学生-家长关系不存在或已解除' })

  await db.update(schema.studentGuardians).set({ status: 'removed' }).where(and(
    eq(schema.studentGuardians.studentId, id),
    eq(schema.studentGuardians.guardianId, guardianId)
  ))

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'information.student.guardian.unlink',
    targetType: 'student',
    targetId: id,
    metadata: { guardianId }
  })

  return { ok: true }
})
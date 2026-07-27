import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

const bodySchema = z.object({ guardianId: z.string().uuid() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id }).from(schema.students).where(and(eq(schema.students.id, id), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId!))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(eq(schema.guardians.id, body.guardianId), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).limit(1)
  if (!guardian) throw createError({ statusCode: 422, message: '家长不存在或不属于当前教师' })
  await db.insert(schema.studentGuardians)
    .values({ studentId: id, guardianId: body.guardianId, schoolId: user.schoolId! })
    .onConflictDoUpdate({
      target: [schema.studentGuardians.studentId, schema.studentGuardians.guardianId],
      set: { status: 'active', schoolId: user.schoolId! },
    })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.student.guardian.link', targetType: 'student', targetId: id, metadata: { guardianId: body.guardianId } })
  return { ok: true }
})

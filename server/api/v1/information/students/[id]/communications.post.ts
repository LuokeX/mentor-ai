import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { encryptSensitive } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

const bodySchema = z.object({
  summary: z.string().trim().min(5).max(3000),
  guardianId: z.string().uuid().optional(),
  parentType: z.string().max(20).optional(),
  attitudeType: z.string().max(20).optional(),
  containerLevel: z.number().int().min(-4).max(4).optional(),
  riskLevel: z.string().max(20).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id }).from(schema.students).where(and(eq(schema.students.id, id), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId!))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  if (body.guardianId) {
    const [relation] = await db.select().from(schema.studentGuardians).where(and(eq(schema.studentGuardians.studentId, id), eq(schema.studentGuardians.guardianId, body.guardianId))).limit(1)
    if (!relation) throw createError({ statusCode: 422, message: '只能选择该学生已关联的家长' })
  }
  const secret = useRuntimeConfig(event).encryptionKey
  const [record] = await db.insert(schema.communications).values({
    schoolId: user.schoolId!,
    ownerUserId: user.id,
    studentId: id,
    guardianId: body.guardianId,
    summaryEnc: encryptSensitive(body.summary, secret),
    parentType: body.parentType,
    attitudeType: body.attitudeType,
    containerLevel: body.containerLevel,
    riskLevel: body.riskLevel
  }).returning({ id: schema.communications.id })
  if (!record) throw createError({ statusCode: 500, message: '沟通记录保存失败' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.student.communication.create', targetType: 'communication', targetId: record.id, metadata: { studentId: id, guardianId: body.guardianId } })
  return { ok: true, id: record.id }
})

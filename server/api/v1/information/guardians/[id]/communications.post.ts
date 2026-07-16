import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { encryptSensitive } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

const bodySchema = z.object({
  summary: z.string().trim().min(5).max(3000),
  studentId: z.string().uuid().optional(),
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
  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(eq(schema.guardians.id, id), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  if (body.studentId) {
    const [relation] = await db.select().from(schema.studentGuardians).where(and(eq(schema.studentGuardians.studentId, body.studentId), eq(schema.studentGuardians.guardianId, id))).limit(1)
    if (!relation) throw createError({ statusCode: 422, message: '只能选择该家长已关联的学生' })
  }
  const secret = useRuntimeConfig(event).encryptionKey
  const [record] = await db.insert(schema.communications).values({
    schoolId: user.schoolId!,
    ownerUserId: user.id,
    guardianId: id,
    studentId: body.studentId,
    summaryEnc: encryptSensitive(body.summary, secret),
    parentType: body.parentType,
    attitudeType: body.attitudeType,
    containerLevel: body.containerLevel,
    riskLevel: body.riskLevel
  }).returning({ id: schema.communications.id })
  if (!record) throw createError({ statusCode: 500, message: '沟通记录保存失败' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.guardian.communication.create', targetType: 'communication', targetId: record.id, metadata: { guardianId: id, studentId: body.studentId } })
  return { ok: true, id: record.id }
})

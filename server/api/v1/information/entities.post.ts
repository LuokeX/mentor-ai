import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive, searchableHash } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'

const entitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guardian'), name: z.string().trim().min(1).max(80), phone: z.string().max(40).optional(), relation: z.string().max(40).optional(), studentIds: z.array(z.string().uuid()).max(6).optional() }),
  z.object({
    type: z.literal('communication'), summary: z.string().trim().min(5).max(3000), guardianId: z.string().uuid().optional(), studentId: z.string().uuid().optional(),
    parentType: z.string().max(20).optional(), attitudeType: z.string().max(20).optional(), containerLevel: z.number().int().min(-4).max(4).optional(), riskLevel: z.string().max(20).optional()
  })
])

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = entitySchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)

  if (body.type === 'communication') {
    if (body.guardianId) {
      const [ownedGuardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(
        eq(schema.guardians.id, body.guardianId), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId)
      )).limit(1)
      if (!ownedGuardian) throw createError({ statusCode: 422, message: '所选家长不存在或不属于当前教师' })
    }
    if (body.studentId) {
      const [ownedStudent] = await db.select({ id: schema.students.id }).from(schema.students).where(and(
        eq(schema.students.id, body.studentId), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId)
      )).limit(1)
      if (!ownedStudent) throw createError({ statusCode: 422, message: '所选学生不存在或不属于当前教师' })
    }
  }

  if (body.type === 'guardian' && body.studentIds?.length) {
    const owned = await db.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.ownerUserId, user.id))
    const ownedIds = new Set(owned.map(item => item.id))
    if (body.studentIds.some(id => !ownedIds.has(id))) throw createError({ statusCode: 422, message: '关联学生不存在或不属于当前教师' })
  }

  let record: { id: string } | undefined
  if (body.type === 'guardian') {
    [record] = await db.insert(schema.guardians).values({
      schoolId: user.schoolId, ownerUserId: user.id,
      nameEnc: encryptSensitive(body.name, config.encryptionKey), nameSearch: searchableHash(body.name, config.encryptionKey),
      phoneEnc: body.phone ? encryptSensitive(body.phone, config.encryptionKey) : null, relation: body.relation
    }).returning({ id: schema.guardians.id })
    if (record && body.studentIds?.length) {
      await db.insert(schema.studentGuardians).values(body.studentIds.map(studentId => ({ studentId, guardianId: record!.id }))).onConflictDoNothing()
    }
  } else {
    [record] = await db.insert(schema.communications).values({
      schoolId: user.schoolId, ownerUserId: user.id, guardianId: body.guardianId, studentId: body.studentId,
      summaryEnc: encryptSensitive(body.summary, config.encryptionKey), parentType: body.parentType,
      attitudeType: body.attitudeType, containerLevel: body.containerLevel, riskLevel: body.riskLevel
    }).returning({ id: schema.communications.id })
  }
  if (!record) throw createError({ statusCode: 500, message: '资料保存失败' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: `information.${body.type}.create`, targetType: body.type, targetId: record.id })
  return { ok: true, id: record.id }
})
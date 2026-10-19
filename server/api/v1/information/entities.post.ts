import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { communicationChannelSchema } from '../../../../shared/contracts'
import { canonicalCommunicationRiskLevel } from '../../../../shared/dashboard'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive, searchableHash } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { assertChatMessageSource } from '../../../domain/chat-transfer-source'
import { RECORD_RELATED_TARGET_MAX, resolveOwnedRecordTargets } from '../../../domain/information-record-targets'

const entitySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('student'),
    name: z.string().trim().min(1).max(80),
    classId: z.string().uuid(),
    gender: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(1000).optional(),
    enrolledAt: z.string().datetime().nullable().optional(),
  }),
  z.object({ type: z.literal('guardian'), name: z.string().trim().min(1).max(80), phone: z.string().max(40).optional(), relation: z.string().max(40).optional(), studentIds: z.array(z.string().uuid()).max(6).optional() }),
  z.object({
    type: z.literal('communication'), summary: z.string().trim().min(5).max(3000),
    /** 关联学生（首个为主学生，最多 RECORD_RELATED_TARGET_MAX 个） */
    studentIds: z.array(z.string().uuid()).max(RECORD_RELATED_TARGET_MAX).optional(),
    /** 关联家长（首个为主家长，最多 RECORD_RELATED_TARGET_MAX 个） */
    guardianIds: z.array(z.string().uuid()).max(RECORD_RELATED_TARGET_MAX).optional(),
    channel: communicationChannelSchema.optional(),
    parentType: z.string().max(20).optional(), attitudeType: z.string().max(20).optional(), riskLevel: z.string().max(20).optional(),
    /** 来源：从 AI 对话「转存」创建时携带（会话 + 消息，归属在服务端校验） */
    sourceChatSessionId: z.string().uuid().optional(),
    sourceChatMessageId: z.string().uuid().optional()
  })
])

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = entitySchema.parse(await readBody(event))
  const config = useRuntimeConfig(event)
  const db = useDb(event)

  if (body.type === 'student') {
    const [ownedClass] = await db.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.id, body.classId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.schoolId, user.schoolId),
      eq(schema.classes.status, 'active'),
    )).limit(1)
    if (!ownedClass) throw createError({ statusCode: 422, message: '只能向当前负责的有效班级添加学生' })
  }

  /** 沟通记录的关联对象集（首个为主对象）：多选学生 / 多选家长，校验后归一化，写入时主对象 + 关联表 */
  let communicationTargets: { studentIds: string[], guardianIds: string[] } = { studentIds: [], guardianIds: [] }
  if (body.type === 'communication') {
    const students = body.studentIds?.length
      ? await resolveOwnedRecordTargets(event, user, { kind: 'student', ids: body.studentIds })
      : { primary: null, related: [] as string[] }
    const guardians = body.guardianIds?.length
      ? await resolveOwnedRecordTargets(event, user, { kind: 'guardian', ids: body.guardianIds })
      : { primary: null, related: [] as string[] }
    communicationTargets = {
      studentIds: students.primary ? [students.primary, ...students.related] : [],
      guardianIds: guardians.primary ? [guardians.primary, ...guardians.related] : []
    }
  }

  if (body.type === 'guardian' && body.studentIds?.length) {
    const owned = await db.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.ownerUserId, user.id))
    const ownedIds = new Set(owned.map(item => item.id))
    if (body.studentIds.some(id => !ownedIds.has(id))) throw createError({ statusCode: 422, message: '关联学生不存在或不属于当前教师' })
  }

  let record: { id: string } | undefined
  if (body.type === 'student') {
    [record] = await db.insert(schema.students).values({
      schoolId: user.schoolId,
      ownerUserId: user.id,
      classId: body.classId,
      nameEnc: encryptSensitive(body.name, config.encryptionKey),
      nameSearch: searchableHash(body.name, config.encryptionKey),
      gender: body.gender || null,
      notesEnc: body.notes ? encryptSensitive(body.notes, config.encryptionKey) : null,
      enrolledAt: body.enrolledAt ? new Date(body.enrolledAt) : null,
    }).returning({ id: schema.students.id })
  } else if (body.type === 'guardian') {
    [record] = await db.insert(schema.guardians).values({
      schoolId: user.schoolId, ownerUserId: user.id,
      nameEnc: encryptSensitive(body.name, config.encryptionKey), nameSearch: searchableHash(body.name, config.encryptionKey),
      phoneEnc: body.phone ? encryptSensitive(body.phone, config.encryptionKey) : null, relation: body.relation
    }).returning({ id: schema.guardians.id })
    if (record && body.studentIds?.length) {
      await db.insert(schema.studentGuardians).values(body.studentIds.map(studentId => ({ studentId, guardianId: record!.id, schoolId: user.schoolId! }))).onConflictDoNothing()
    }
  } else {
    const source = await assertChatMessageSource(event, user, body.sourceChatSessionId, body.sourceChatMessageId)
    const relatedStudents = communicationTargets.studentIds.slice(1)
    const relatedGuardians = communicationTargets.guardianIds.slice(1)
    const created = await db.transaction(async (tx) => {
      const [communication] = await tx.insert(schema.communications).values({
        schoolId: user.schoolId!,
        ownerUserId: user.id,
        guardianId: communicationTargets.guardianIds[0] ?? null,
        studentId: communicationTargets.studentIds[0] ?? null,
        channel: body.channel ?? null,
        summaryEnc: encryptSensitive(body.summary, config.encryptionKey), parentType: body.parentType,
        attitudeType: body.attitudeType, riskLevel: canonicalCommunicationRiskLevel(body.riskLevel),
        sourceChatSessionId: source?.sessionId ?? null,
        sourceChatMessageId: source?.messageId ?? null
      }).returning({ id: schema.communications.id })
      if (!communication) return null
      // 关联表只存主对象之外的其余对象，避免与主列双写
      if (relatedStudents.length) {
        await tx.insert(schema.communicationStudents).values(relatedStudents.map(studentId => ({
          communicationId: communication.id, studentId, schoolId: user.schoolId!
        })))
      }
      if (relatedGuardians.length) {
        await tx.insert(schema.communicationGuardians).values(relatedGuardians.map(guardianId => ({
          communicationId: communication.id, guardianId, schoolId: user.schoolId!
        })))
      }
      return communication
    })
    if (!created) throw createError({ statusCode: 500, message: '资料保存失败' })
    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'information.communication.create',
      targetType: 'communication',
      targetId: created.id,
      metadata: {
        studentCount: communicationTargets.studentIds.length,
        guardianCount: communicationTargets.guardianIds.length,
        ...(source ? { source: 'chat', sourceChatSessionId: source.sessionId, sourceChatMessageId: source.messageId } : {})
      }
    })
    return { ok: true, id: created.id }
  }
  if (!record) throw createError({ statusCode: 500, message: '资料保存失败' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: `information.${body.type}.create`, targetType: body.type, targetId: record.id })
  return { ok: true, id: record.id }
})

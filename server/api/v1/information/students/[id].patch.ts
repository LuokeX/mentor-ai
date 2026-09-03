import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive, encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const studentProfileSchema = z.object({
  studentNo: z.string().trim().max(40).optional(),
  birthDate: z.string().trim().max(20).optional(),
  ethnicity: z.string().trim().max(40).optional(),
  residenceType: z.string().trim().max(80).optional(),
  boardingStatus: z.string().trim().max(40).optional(),
  classRole: z.string().trim().max(80).optional(),
  attendanceStatus: z.string().trim().max(80).optional(),
  academicLevel: z.string().trim().max(80).optional(),
  classroomBehavior: z.string().trim().max(120).optional(),
  emotionStatus: z.string().trim().max(120).optional(),
  peerRelation: z.string().trim().max(120).optional(),
  familyStructure: z.string().trim().max(120).optional(),
  primaryCaregiver: z.string().trim().max(120).optional(),
  strengths: z.string().trim().max(500).optional(),
  mainDifficulties: z.string().trim().max(500).optional(),
  supportNeeds: z.string().trim().max(500).optional(),
  riskAttentionLevel: z.string().trim().max(80).optional()
}).partial()

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  gender: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
  classId: z.string().uuid().nullable().optional(),
  /** 入学日期（学籍字段） */
  enrolledAt: z.string().datetime().nullable().optional(),
  /** 现住址（AES-256-GCM 加密落 address_enc） */
  address: z.string().trim().max(1000).nullable().optional(),
  /** 个体问题解决方案状态：unresolved/in_progress/resolved（红/黄/绿点） */
  caseSolutionStatus: z.enum(['unresolved', 'in_progress', 'resolved']).optional(),
  profile: studentProfileSchema.optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [student] = await db.select({
    id: schema.students.id,
    profileEnc: schema.students.profileEnc,
    updatedAt: schema.students.updatedAt,
  }).from(schema.students).where(and(
    eq(schema.students.id, id),
    eq(schema.students.ownerUserId, user.id),
    eq(schema.students.schoolId, user.schoolId!)
  )).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(student.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '学生档案已被其他用户修改，请刷新后重试' })
  }
  if (body.classId) {
    const [klass] = await db.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.id, body.classId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.schoolId, user.schoolId!)
    )).limit(1)
    if (!klass) throw createError({ statusCode: 422, message: '只能分配到当前教师负责的班级' })
  }
  const patch: Partial<typeof schema.students.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) {
    patch.nameEnc = encryptSensitive(body.name, secret)
    patch.nameSearch = searchableHash(body.name, secret)
  }
  if (body.gender !== undefined) patch.gender = body.gender
  if (body.profile !== undefined) {
    const currentProfileText = decryptSensitive(student.profileEnc, secret)
    const currentProfile = currentProfileText ? JSON.parse(currentProfileText) : {}
    const nextProfile = Object.fromEntries(
      Object.entries({ ...currentProfile, ...body.profile }).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    )
    patch.profileEnc = encryptSensitive(JSON.stringify(nextProfile), secret)
  }
  if (body.notes !== undefined) patch.notesEnc = body.notes ? encryptSensitive(body.notes, secret) : null
  if (body.address !== undefined) patch.addressEnc = body.address ? encryptSensitive(body.address, secret) : null
  if (body.classId !== undefined) patch.classId = body.classId
  if (body.enrolledAt !== undefined) patch.enrolledAt = body.enrolledAt ? new Date(body.enrolledAt) : null
  if (body.caseSolutionStatus !== undefined) patch.caseSolutionStatus = body.caseSolutionStatus
  const finalConditions = [
    eq(schema.students.id, id),
    eq(schema.students.ownerUserId, user.id),
    eq(schema.students.schoolId, user.schoolId!),
  ]
  if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.students.updatedAt, expectedUpdatedAt))
  const [updated] = await db.update(schema.students).set(patch).where(and(...finalConditions)).returning({ id: schema.students.id })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '学生档案已被其他用户修改，请刷新后重试' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.student.update', targetType: 'student', targetId: id })
  return { ok: true }
})

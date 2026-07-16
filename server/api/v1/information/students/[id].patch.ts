import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
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
  profile: studentProfileSchema.optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [student] = await db.select({ id: schema.students.id, profileEnc: schema.students.profileEnc }).from(schema.students).where(and(
    eq(schema.students.id, id),
    eq(schema.students.ownerUserId, user.id),
    eq(schema.students.schoolId, user.schoolId!)
  )).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
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
  if (body.classId !== undefined) patch.classId = body.classId
  await db.update(schema.students).set(patch).where(eq(schema.students.id, id))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.student.update', targetType: 'student', targetId: id })
  return { ok: true }
})

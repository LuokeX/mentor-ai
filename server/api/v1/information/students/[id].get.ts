import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [student] = await db.select().from(schema.students).where(and(
    eq(schema.students.id, id),
    eq(schema.students.ownerUserId, user.id),
    eq(schema.students.schoolId, user.schoolId!)
  )).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })

  const [klass, relations, communications, classOptions, guardianOptions, plans] = await Promise.all([
    student.classId ? db.select().from(schema.classes).where(eq(schema.classes.id, student.classId)).limit(1) : Promise.resolve([]),
    db.select().from(schema.studentGuardians).where(eq(schema.studentGuardians.studentId, id)),
    db.select().from(schema.communications).where(and(eq(schema.communications.studentId, id), eq(schema.communications.schoolId, user.schoolId!))).orderBy(desc(schema.communications.occurredAt)),
    db.select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade }).from(schema.classes).where(and(eq(schema.classes.ownerUserId, user.id), eq(schema.classes.schoolId, user.schoolId!))).orderBy(schema.classes.name),
    db.select().from(schema.guardians).where(and(eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.plans).where(and(eq(schema.plans.studentId, id), eq(schema.plans.ownerUserId, user.id), eq(schema.plans.schoolId, user.schoolId!))).orderBy(desc(schema.plans.updatedAt)).limit(20)
  ])
  const guardianIds = relations.map(relation => relation.guardianId)
  const linkedGuardians = guardianIds.length
    ? await db.select().from(schema.guardians).where(inArray(schema.guardians.id, guardianIds))
    : []
  const guardianById = new Map([...linkedGuardians, ...guardianOptions].map(row => [row.id, row]))
  const profileText = decryptSensitive(student.profileEnc, secret)
  const profile = profileText ? JSON.parse(profileText) : {}
  return {
    student: {
      ...student,
      name: decryptSensitive(student.nameEnc, secret),
      profile,
      notes: decryptSensitive(student.notesEnc, secret),
      className: klass[0]?.name || null,
      aiContext: { type: 'student', id: student.id, label: decryptSensitive(student.nameEnc, secret) },
      nameEnc: undefined,
      profileEnc: undefined,
      notesEnc: undefined,
      nameSearch: undefined
    },
    class: klass[0] || null,
    classOptions,
    guardianOptions: guardianOptions.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, secret), phone: decryptSensitive(row.phoneEnc, secret), nameEnc: undefined, phoneEnc: undefined, nameSearch: undefined })),
    guardians: linkedGuardians.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, secret), phone: decryptSensitive(row.phoneEnc, secret), nameEnc: undefined, phoneEnc: undefined, nameSearch: undefined })),
    communications: communications.map(row => {
      const guardian = row.guardianId ? guardianById.get(row.guardianId) : null
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, secret),
        guardianName: guardian ? decryptSensitive(guardian.nameEnc, secret) : null,
        relation: guardian?.relation || null,
        summaryEnc: undefined
      }
    }),
    plans: plans.map(row => {
      const report = row.report as any
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, secret),
        summaryEnc: undefined,
        riskLabel: report?.risk?.label,
        sourceLabel: row.sourceChatSessionId ? 'AI 咨询' : row.sourceAssessmentAttemptId ? '模块评估' : '手动记录'
      }
    })
  }
})

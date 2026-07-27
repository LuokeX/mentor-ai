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
  const [guardian] = await db.select().from(schema.guardians).where(and(
    eq(schema.guardians.id, id),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId!)
  )).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  const [relations, communications, studentOptions, plans] = await Promise.all([
    db.select().from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.guardianId, id),
      eq(schema.studentGuardians.schoolId, user.schoolId!),
      eq(schema.studentGuardians.status, 'active'),
    )),
    db.select().from(schema.communications).where(and(eq(schema.communications.guardianId, id), eq(schema.communications.schoolId, user.schoolId!))).orderBy(desc(schema.communications.occurredAt)),
    db.select().from(schema.students).where(and(eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId!))).orderBy(desc(schema.students.updatedAt)),
    db.select().from(schema.plans).where(and(eq(schema.plans.guardianId, id), eq(schema.plans.ownerUserId, user.id), eq(schema.plans.schoolId, user.schoolId!))).orderBy(desc(schema.plans.updatedAt)).limit(20)
  ])
  const studentIds = relations.map(relation => relation.studentId)
  const linkedStudents = studentIds.length ? await db.select().from(schema.students).where(inArray(schema.students.id, studentIds)) : []
  const classIds = [...new Set([...linkedStudents, ...studentOptions].map(student => student.classId).filter(Boolean))] as string[]
  const classRows = classIds.length ? await db.select().from(schema.classes).where(inArray(schema.classes.id, classIds)) : []
  const classById = new Map(classRows.map(row => [row.id, row]))
  const studentById = new Map([...linkedStudents, ...studentOptions].map(row => [row.id, row]))
  const normalizeStudent = (row: typeof schema.students.$inferSelect) => ({
    ...row,
    name: decryptSensitive(row.nameEnc, secret),
    notes: decryptSensitive(row.notesEnc, secret),
    className: row.classId ? classById.get(row.classId)?.name : null,
    nameEnc: undefined,
    notesEnc: undefined,
    nameSearch: undefined
  })
  return {
    guardian: {
      ...guardian,
      name: decryptSensitive(guardian.nameEnc, secret),
      phone: decryptSensitive(guardian.phoneEnc, secret),
      aiContext: { type: 'guardian', id: guardian.id, label: decryptSensitive(guardian.nameEnc, secret) },
      nameEnc: undefined,
      phoneEnc: undefined,
      nameSearch: undefined
    },
    students: linkedStudents.map(normalizeStudent),
    studentOptions: studentOptions.map(normalizeStudent),
    communications: communications.map(row => {
      const student = row.studentId ? studentById.get(row.studentId) : null
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, secret),
        studentName: student ? decryptSensitive(student.nameEnc, secret) : null,
        className: student?.classId ? classById.get(student.classId)?.name : null,
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

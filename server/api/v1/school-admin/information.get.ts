import { and, asc, desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const schoolId = admin.schoolId!
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [teachers, classes, studentsRaw, guardiansRaw, relations, communicationsRaw, plansRaw, assignmentsRaw] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, status: schema.users.status }).from(schema.users)
      .where(and(eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'teacher'))).orderBy(asc(schema.users.name)),
    db.select().from(schema.classes).where(eq(schema.classes.schoolId, schoolId)).orderBy(asc(schema.classes.name)),
    db.select().from(schema.students).where(eq(schema.students.schoolId, schoolId)).orderBy(asc(schema.students.createdAt)),
    db.select().from(schema.guardians).where(eq(schema.guardians.schoolId, schoolId)).orderBy(asc(schema.guardians.createdAt)),
    db.select().from(schema.studentGuardians),
    db.select().from(schema.communications).where(eq(schema.communications.schoolId, schoolId)).orderBy(asc(schema.communications.createdAt)),
    db.select().from(schema.plans).where(eq(schema.plans.schoolId, schoolId)).orderBy(desc(schema.plans.updatedAt)).limit(100),
    db.select().from(schema.recordAssignments).where(eq(schema.recordAssignments.schoolId, schoolId)).orderBy(desc(schema.recordAssignments.createdAt)).limit(80)
  ])
  const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher]))
  const classById = new Map(classes.map(item => [item.id, item]))
  const students = studentsRaw.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, secret),
    notes: decryptSensitive(row.notesEnc, secret),
    ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
    className: row.classId ? classById.get(row.classId)?.name : null,
    nameEnc: undefined,
    notesEnc: undefined
  }))
  const studentById = new Map(students.map(student => [student.id, student]))
  const guardians = guardiansRaw.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, secret),
    phone: decryptSensitive(row.phoneEnc, secret),
    ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
    linkedStudents: relations.filter(relation => relation.guardianId === row.id).map(relation => studentById.get(relation.studentId)).filter(Boolean).map(student => ({ id: student!.id, name: student!.name, className: student!.className })),
    nameEnc: undefined,
    phoneEnc: undefined
  }))
  const guardianById = new Map(guardians.map(guardian => [guardian.id, guardian]))
  const communications = communicationsRaw.map(row => ({
    ...row,
    summary: decryptSensitive(row.summaryEnc, secret),
    ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
    studentName: row.studentId ? studentById.get(row.studentId)?.name : null,
    guardianName: row.guardianId ? guardianById.get(row.guardianId)?.name : null,
    summaryEnc: undefined
  }))
  const plans = plansRaw.map(row => {
    const report = row.report as any
    return {
      ...row,
      summary: decryptSensitive(row.summaryEnc, secret),
      ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
      riskLabel: report?.risk?.label || report?.risk?.level || row.status,
      summaryEnc: undefined
    }
  })
  return {
    teachers: teachers.filter(teacher => teacher.status === 'active'),
    classes: classes.map(row => ({ ...row, ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师' })),
    students,
    guardians,
    communications,
    plans,
    assignments: assignmentsRaw.map(row => ({
      ...row,
      fromUserName: row.fromUserId ? teacherById.get(row.fromUserId)?.name || '未知教师' : '未分配',
      toUserName: teacherById.get(row.toUserId)?.name || '未知教师',
      assignedByName: row.assignedBy ? teacherById.get(row.assignedBy)?.name || '学校管理员' : '系统'
    }))
  }
})

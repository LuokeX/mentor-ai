import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { decryptSensitive } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const grantId = z.string().uuid().parse(getRouterParam(event, 'grantId'))
  const db = useDb(event)
  const [grant] = await db.select().from(schema.delegatedManagementGrants).where(and(
    eq(schema.delegatedManagementGrants.id, grantId),
    eq(schema.delegatedManagementGrants.requesterId, admin.id),
    eq(schema.delegatedManagementGrants.status, 'approved')
  )).limit(1)
  if (!grant || !grant.expiresAt || grant.expiresAt.getTime() <= Date.now() || grant.revokedAt) {
    throw createError({ statusCode: 403, message: '代管授权不存在或已过期' })
  }
  const schoolId = grant.schoolId
  const secret = useRuntimeConfig(event).encryptionKey
  const [school, teachers, departments, classes, studentsRaw, guardiansRaw, relations] = await Promise.all([
    db.select().from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1),
    db.select({ id: schema.users.id, name: schema.users.name, phone: schema.users.phone, status: schema.users.status }).from(schema.users)
      .where(and(eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'teacher'))).orderBy(asc(schema.users.name)),
    db.select().from(schema.departments).where(eq(schema.departments.schoolId, schoolId)).orderBy(asc(schema.departments.name)),
    db.select().from(schema.classes).where(eq(schema.classes.schoolId, schoolId)).orderBy(asc(schema.classes.name)),
    db.select().from(schema.students).where(eq(schema.students.schoolId, schoolId)).orderBy(desc(schema.students.updatedAt)).limit(500),
    db.select().from(schema.guardians).where(eq(schema.guardians.schoolId, schoolId)).orderBy(desc(schema.guardians.updatedAt)).limit(500),
    db.select().from(schema.studentGuardians)
  ])
  const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher]))
  const classById = new Map(classes.map(item => [item.id, item]))
  const students = studentsRaw.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, secret),
    notes: decryptSensitive(row.notesEnc, secret),
    externalRef: decryptSensitive(row.externalRefEnc, secret),
    ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
    className: row.classId ? classById.get(row.classId)?.name : null,
    nameEnc: undefined,
    notesEnc: undefined,
    externalRefEnc: undefined,
    profileEnc: undefined
  }))
  const studentById = new Map(students.map(student => [student.id, student]))
  const guardians = guardiansRaw.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, secret),
    phone: decryptSensitive(row.phoneEnc, secret),
    externalRef: decryptSensitive(row.externalRefEnc, secret),
    ownerName: teacherById.get(row.ownerUserId)?.name || '未分配教师',
    linkedStudents: relations.filter(relation => relation.guardianId === row.id).map(relation => studentById.get(relation.studentId)).filter(Boolean).map(student => ({ id: student!.id, name: student!.name, className: student!.className })),
    nameEnc: undefined,
    phoneEnc: undefined,
    externalRefEnc: undefined
  }))
  return { grant, school: school[0], teachers, departments, classes, students, guardians }
})

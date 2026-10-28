import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { canonicalCommunicationRiskLevel } from '../../../../../shared/dashboard'
import { guardianDisplayLabel } from '../../../../../shared/guardian-display'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [record] = await db.select().from(schema.communications).where(and(
    eq(schema.communications.id, id),
    eq(schema.communications.schoolId, user.schoolId),
    eq(schema.communications.ownerUserId, user.id),
  )).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '沟通记录不存在' })
  const secret = useRuntimeConfig(event).encryptionKey
  // 关联学生 / 关联家长（主对象之外的其余对象）：详情页要展示完整的一组对象
  const [relatedStudents, relatedGuardians] = await Promise.all([
    db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc })
      .from(schema.communicationStudents)
      .innerJoin(schema.students, and(
        eq(schema.students.id, schema.communicationStudents.studentId),
        eq(schema.students.schoolId, user.schoolId)
      ))
      .where(eq(schema.communicationStudents.communicationId, id)),
    db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc })
      .from(schema.communicationGuardians)
      .innerJoin(schema.guardians, and(
        eq(schema.guardians.id, schema.communicationGuardians.guardianId),
        eq(schema.guardians.schoolId, user.schoolId)
      ))
      .where(eq(schema.communicationGuardians.communicationId, id))
  ])
  // 主对象姓名（主列可能为空：历史记录允许不指定学生/家长）
  const [primaryStudent, primaryGuardian] = await Promise.all([
    record.studentId
      ? db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
        .where(and(eq(schema.students.id, record.studentId), eq(schema.students.schoolId, user.schoolId)))
        .limit(1).then(rows => rows[0] ?? null)
      : Promise.resolve(null),
    record.guardianId
      ? db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc, relation: schema.guardians.relation }).from(schema.guardians)
        .where(and(eq(schema.guardians.id, record.guardianId), eq(schema.guardians.schoolId, user.schoolId)))
        .limit(1).then(rows => rows[0] ?? null)
      : Promise.resolve(null)
  ])
  const [primaryLink] = record.studentId && record.guardianId
    ? await db.select({ relation: schema.studentGuardians.relation }).from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.studentId, record.studentId),
      eq(schema.studentGuardians.guardianId, record.guardianId),
      eq(schema.studentGuardians.schoolId, user.schoolId),
      eq(schema.studentGuardians.status, 'active'),
    )).limit(1)
    : []
  const studentName = primaryStudent ? decryptSensitive(primaryStudent.nameEnc, secret) : null
  const guardianName = primaryGuardian ? decryptSensitive(primaryGuardian.nameEnc, secret) : null
  const guardianRelation = primaryLink?.relation || primaryGuardian?.relation || null
  const guardianLabel = guardianName
    ? guardianDisplayLabel(studentName ? [{ studentName, relation: guardianRelation }] : [], guardianName, guardianRelation)
    : null
  const guardianNames = guardianName
    ? [guardianName, ...relatedGuardians.map(row => decryptSensitive(row.nameEnc, secret))]
    : relatedGuardians.map(row => decryptSensitive(row.nameEnc, secret))
  const { summaryEnc, ...safeRecord } = record
  return {
    ...safeRecord,
    riskLevel: canonicalCommunicationRiskLevel(safeRecord.riskLevel) ?? safeRecord.riskLevel,
    summary: decryptSensitive(summaryEnc, secret),
    studentName,
    guardianName,
    guardianNames,
    guardianRelation,
    guardianLabel,
    guardianLabels: guardianLabel ? [guardianLabel, ...relatedGuardians.map(row => decryptSensitive(row.nameEnc, secret))] : relatedGuardians.map(row => decryptSensitive(row.nameEnc, secret)),
    relatedStudentNames: relatedStudents.map(row => decryptSensitive(row.nameEnc, secret)),
    relatedGuardianNames: relatedGuardians.map(row => decryptSensitive(row.nameEnc, secret)),
    studentIds: [record.studentId, ...relatedStudents.map(row => row.id)].filter(Boolean),
    guardianIds: [record.guardianId, ...relatedGuardians.map(row => row.id)].filter(Boolean)
  }
})

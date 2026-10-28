import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [classes, students, guardians, studentGuardianRelations, communications, plans, assessments, conversations] = await Promise.all([
    db.select().from(schema.classes).where(eq(schema.classes.ownerUserId, user.id)).orderBy(desc(schema.classes.updatedAt)),
    db.select().from(schema.students).where(eq(schema.students.ownerUserId, user.id)).orderBy(desc(schema.students.updatedAt)),
    db.select().from(schema.guardians).where(eq(schema.guardians.ownerUserId, user.id)).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.schoolId, user.schoolId!),
      eq(schema.studentGuardians.status, 'active'),
    )),
    db.select().from(schema.communications).where(eq(schema.communications.ownerUserId, user.id)).orderBy(desc(schema.communications.occurredAt)),
    db.select().from(schema.plans).where(eq(schema.plans.ownerUserId, user.id)).orderBy(desc(schema.plans.updatedAt)),
    db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, user.id)).orderBy(desc(schema.assessmentAttempts.updatedAt)),
    db.select().from(schema.chatSessions).where(eq(schema.chatSessions.ownerUserId, user.id)).orderBy(desc(schema.chatSessions.updatedAt))
  ])
  const planIds = plans.map(plan => plan.id)
  const planReviews = planIds.length
    ? await db.select().from(schema.planReviews).where(inArray(schema.planReviews.planId, planIds)).orderBy(desc(schema.planReviews.reviewAt))
    : []
  const conversationIds = new Set(conversations.map(item => item.id))
  const messages = (await db.select().from(schema.chatMessages).where(and(
    eq(schema.chatMessages.ownerUserId, user.id),
    isNull(schema.chatMessages.deletedAt)
  )).orderBy(schema.chatMessages.createdAt))
    .filter(item => conversationIds.has(item.sessionId))
    .map(item => ({ id: item.id, sessionId: item.sessionId, role: item.role, content: decryptSensitive(item.contentEnc, secret), metadata: item.metadata, createdAt: item.createdAt }))
  const payload = {
    exportVersion: '1.0', exportedAt: new Date().toISOString(), owner: { id: user.id, name: user.name, phone: user.phone },
    ownershipNote: '班级、学生、家长、沟通和方案是学校业务档案；本导出仅包含当前由该教师负责或参与的记录。',
    classes,
    students: students.map(item => ({
      ...item,
      name: decryptSensitive(item.nameEnc, secret),
      notes: decryptSensitive(item.notesEnc, secret),
      address: decryptSensitive(item.addressEnc, secret),
      studentNo: decryptSensitive(item.studentNoEnc, secret),
      externalRef: item.externalRefEnc ? decryptSensitive(item.externalRefEnc, secret) : null,
      idCard: item.idCardEnc ? decryptSensitive(item.idCardEnc, secret) : null,
      profile: item.profileEnc ? parseJsonSafe(decryptSensitive(item.profileEnc, secret)) : null,
      extra: item.extraEnc ? parseJsonSafe(decryptSensitive(item.extraEnc, secret)) : null,
      nameEnc: undefined,
      notesEnc: undefined,
      nameSearch: undefined,
      addressEnc: undefined,
      studentNoEnc: undefined,
      studentNoSearch: undefined,
      externalRefEnc: undefined,
      externalRefSearch: undefined,
      idCardEnc: undefined,
      idCardSearch: undefined,
      extraEnc: undefined,
      profileEnc: undefined,
    })),
    guardians: guardians.map(item => ({
      ...item,
      name: decryptSensitive(item.nameEnc, secret),
      phone: decryptSensitive(item.phoneEnc, secret),
      idCard: item.idCardEnc ? decryptSensitive(item.idCardEnc, secret) : null,
      externalRef: item.externalRefEnc ? decryptSensitive(item.externalRefEnc, secret) : null,
      profile: item.profileEnc ? parseJsonSafe(decryptSensitive(item.profileEnc, secret)) : null,
      nameEnc: undefined,
      phoneEnc: undefined,
      nameSearch: undefined,
      idCardEnc: undefined,
      idCardSearch: undefined,
      externalRefEnc: undefined,
      externalRefSearch: undefined,
      contactEnc: undefined,
      profileEnc: undefined,
      notesEnc: undefined,
    })),
    studentGuardianRelations: studentGuardianRelations.filter(relation => students.some(student => student.id === relation.studentId) || guardians.some(guardian => guardian.id === relation.guardianId)),
    communications: communications.map(item => ({ ...item, summary: decryptSensitive(item.summaryEnc, secret), summaryEnc: undefined })),
    plans: plans.map(item => ({ ...item, summary: decryptSensitive(item.summaryEnc, secret), summaryEnc: undefined })),
    planReviews,
    assessments,
    conversations: conversations.map(session => ({ ...session, messages: messages.filter(message => message.sessionId === session.id) }))
  }
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.export', targetType: 'teacher_profile', targetId: user.id })
  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="mentor-data-${formatBeijingDateStamp()}.json"`,
    'cache-control': 'no-store, private'
  })
  return payload
})

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

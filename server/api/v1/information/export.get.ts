import { and, desc, eq, inArray } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [classes, students, guardians, studentGuardianRelations, communications, plans, assessments, cases, conversations] = await Promise.all([
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
    db.select().from(schema.moduleCases).where(eq(schema.moduleCases.ownerUserId, user.id)).orderBy(desc(schema.moduleCases.updatedAt)),
    db.select().from(schema.chatSessions).where(eq(schema.chatSessions.ownerUserId, user.id)).orderBy(desc(schema.chatSessions.updatedAt))
  ])
  const planIds = plans.map(plan => plan.id)
  const planReviews = planIds.length
    ? await db.select().from(schema.planReviews).where(inArray(schema.planReviews.planId, planIds)).orderBy(desc(schema.planReviews.reviewAt))
    : []
  const conversationIds = new Set(conversations.map(item => item.id))
  const messages = (await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.ownerUserId, user.id)).orderBy(schema.chatMessages.createdAt))
    .filter(item => conversationIds.has(item.sessionId))
    .map(item => ({ id: item.id, sessionId: item.sessionId, role: item.role, content: decryptSensitive(item.contentEnc, secret), metadata: item.metadata, createdAt: item.createdAt }))
  const payload = {
    exportVersion: '1.0', exportedAt: new Date().toISOString(), owner: { id: user.id, name: user.name, email: user.email },
    ownershipNote: '班级、学生、家长、沟通和方案是学校业务档案；本导出仅包含当前由该教师负责或参与的记录。',
    classes,
    students: students.map(item => ({ ...item, name: decryptSensitive(item.nameEnc, secret), notes: decryptSensitive(item.notesEnc, secret), nameEnc: undefined, notesEnc: undefined, nameSearch: undefined })),
    guardians: guardians.map(item => ({ ...item, name: decryptSensitive(item.nameEnc, secret), phone: decryptSensitive(item.phoneEnc, secret), nameEnc: undefined, phoneEnc: undefined, nameSearch: undefined })),
    studentGuardianRelations: studentGuardianRelations.filter(relation => students.some(student => student.id === relation.studentId) || guardians.some(guardian => guardian.id === relation.guardianId)),
    communications: communications.map(item => ({ ...item, summary: decryptSensitive(item.summaryEnc, secret), summaryEnc: undefined })),
    plans: plans.map(item => ({ ...item, summary: decryptSensitive(item.summaryEnc, secret), summaryEnc: undefined })),
    planReviews,
    assessments,
    cases: cases.map(item => ({ ...item, description: decryptSensitive(item.descriptionEnc, secret), descriptionEnc: undefined })),
    conversations: conversations.map(session => ({ ...session, messages: messages.filter(message => message.sessionId === session.id) }))
  }
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.export', targetType: 'teacher_profile', targetId: user.id })
  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="mentor-data-${new Date().toISOString().slice(0, 10)}.json"`,
    'cache-control': 'no-store, private'
  })
  return payload
})

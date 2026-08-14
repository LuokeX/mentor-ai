import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { targetTypeSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { useDb, schema } from '../../../../../utils/db'
import { requireAdminGrant } from '../../../../../domain/admin-access'
import { decryptSensitive } from '../../../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin', 'platform_admin'])
  const targetType = targetTypeSchema.parse(getRouterParam(event, 'targetType'))
  const targetId = z.string().uuid().parse(getRouterParam(event, 'targetId'))
  const grant = await requireAdminGrant(event, user, targetType, targetId)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  let record: unknown
  let fields: string[] = []

  if (targetType === 'teacher_profile') {
    const [profile] = await db.select({ id: schema.users.id, schoolId: schema.users.schoolId, name: schema.users.name, phone: schema.users.phone, role: schema.users.role, status: schema.users.status, lastLoginAt: schema.users.lastLoginAt, createdAt: schema.users.createdAt }).from(schema.users).where(and(eq(schema.users.id, targetId), eq(schema.users.role, 'teacher'), eq(schema.users.schoolId, grant.schoolId))).limit(1)
    if (!profile) throw createError({ statusCode: 404, message: '教师不存在' })
    const [assessments, conversations, communicationRows, planRows, planReviewRows] = await Promise.all([
      db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, targetId)).orderBy(desc(schema.assessmentAttempts.createdAt)).limit(50),
      db.select({ id: schema.chatSessions.id, title: schema.chatSessions.title, status: schema.chatSessions.status, createdAt: schema.chatSessions.createdAt }).from(schema.chatSessions).where(eq(schema.chatSessions.ownerUserId, targetId)).orderBy(desc(schema.chatSessions.createdAt)).limit(50),
      db.select().from(schema.communications).where(eq(schema.communications.ownerUserId, targetId)).orderBy(desc(schema.communications.createdAt)).limit(50),
      db.select().from(schema.plans).where(eq(schema.plans.ownerUserId, targetId)).orderBy(desc(schema.plans.createdAt)).limit(50),
      db.select().from(schema.planReviews).where(eq(schema.planReviews.ownerUserId, targetId)).orderBy(desc(schema.planReviews.reviewAt)).limit(200)
    ])
    record = {
      profile, assessments, conversations,
      communications: communicationRows.map(row => ({ ...row, summary: decryptSensitive(row.summaryEnc, secret), summaryEnc: undefined })),
      plans: planRows.map(row => ({ ...row, summary: decryptSensitive(row.summaryEnc, secret), summaryEnc: undefined })),
      planReviews: planReviewRows,
      page: { limitPerCollection: 50, truncated: true }
    }
    fields = ['profile', 'assessments', 'conversations', 'communications', 'plans', 'planReviews']
  } else if (targetType === 'assessment') {
    record = (await db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.id, targetId)).limit(1))[0]
    fields = ['answers', 'result', 'module', 'submittedAt']
  } else if (targetType === 'conversation') {
    const session = (await db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, targetId)).limit(1))[0]
    const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.sessionId, targetId)).orderBy(schema.chatMessages.createdAt)
    record = { session, messages: messages.map(row => ({ role: row.role, content: decryptSensitive(row.contentEnc, secret), metadata: row.metadata, createdAt: row.createdAt })) }
    fields = ['session', 'messages']
  } else if (targetType === 'student_case') {
    // module_cases 已删除：存量授权记录无对应数据，统一按不存在处理
    record = null
  } else if (targetType === 'guardian_communication') {
    const row = (await db.select().from(schema.communications).where(eq(schema.communications.id, targetId)).limit(1))[0]
    record = row ? { ...row, summary: decryptSensitive(row.summaryEnc, secret), summaryEnc: undefined } : null
    fields = ['summary', 'parentType', 'attitudeType', 'containerLevel', 'riskLevel']
  } else {
    const row = (await db.select().from(schema.plans).where(eq(schema.plans.id, targetId)).limit(1))[0]
    const reviews = row ? await db.select().from(schema.planReviews).where(eq(schema.planReviews.planId, targetId)).orderBy(desc(schema.planReviews.reviewAt)) : []
    record = row ? { ...row, summary: decryptSensitive(row.summaryEnc, secret), summaryEnc: undefined, reviews } : null
    fields = ['summary', 'report', 'actions', 'tools', 'status', 'reviews']
  }
  if (!record) throw createError({ statusCode: 404, message: '记录不存在' })
  await db.insert(schema.adminAccessEvents).values({
    schoolId: grant.schoolId, actorId: user.id, grantId: grant.id, targetType, targetId,
    action: 'read', path: event.path, fields, metadata: { role: user.role }
  })
  setResponseHeader(event, 'cache-control', 'no-store, private')
  return { record, access: { grantId: grant.id, expiresAt: grant.expiresAt, watermark: `${user.name} · ${new Date().toLocaleString('zh-CN')} · ${grant.id.slice(0, 8)}` } }
})

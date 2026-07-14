import { and, eq, gt, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser } from '../../app/composables/useAuth'
import { targetTypeSchema } from '../../shared/contracts'
import { useDb, schema } from '../utils/db'

export async function resolveTargetSchool(event: H3Event, targetType: string, targetId: string) {
  const db = useDb(event)
  if (targetType === 'teacher_profile') return (await db.select({ schoolId: schema.users.schoolId }).from(schema.users).where(and(eq(schema.users.id, targetId), eq(schema.users.role, 'teacher'))).limit(1))[0]?.schoolId
  if (targetType === 'assessment') return (await db.select({ schoolId: schema.assessmentAttempts.schoolId }).from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.id, targetId)).limit(1))[0]?.schoolId
  if (targetType === 'conversation') return (await db.select({ schoolId: schema.chatSessions.schoolId }).from(schema.chatSessions).where(eq(schema.chatSessions.id, targetId)).limit(1))[0]?.schoolId
  if (targetType === 'student_case') return (await db.select({ schoolId: schema.moduleCases.schoolId }).from(schema.moduleCases).where(eq(schema.moduleCases.id, targetId)).limit(1))[0]?.schoolId
  if (targetType === 'guardian_communication') return (await db.select({ schoolId: schema.communications.schoolId }).from(schema.communications).where(eq(schema.communications.id, targetId)).limit(1))[0]?.schoolId
  if (targetType === 'plan') return (await db.select({ schoolId: schema.plans.schoolId }).from(schema.plans).where(eq(schema.plans.id, targetId)).limit(1))[0]?.schoolId
  return null
}

export async function requireAdminGrant(event: H3Event, user: AuthUser, targetType: string, targetId: string) {
  targetTypeSchema.parse(targetType)
  const grantId = getHeader(event, 'x-admin-access-grant')
  if (!grantId) throw createError({ statusCode: 403, message: '查看敏感数据前必须填写访问事由' })
  const [grant] = await useDb(event).select().from(schema.adminAccessGrants).where(and(
    eq(schema.adminAccessGrants.id, grantId), eq(schema.adminAccessGrants.userId, user.id),
    eq(schema.adminAccessGrants.targetType, targetType), eq(schema.adminAccessGrants.targetId, targetId),
    gt(schema.adminAccessGrants.expiresAt, new Date()), isNull(schema.adminAccessGrants.revokedAt)
  )).limit(1)
  if (!grant || (user.schoolId && grant.schoolId !== user.schoolId)) {
    throw createError({ statusCode: 403, message: '访问授权无效或已过期' })
  }
  return grant
}

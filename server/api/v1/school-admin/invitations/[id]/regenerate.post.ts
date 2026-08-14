import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { issueInvitation } from '../../../../../domain/invitations'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [previous] = await db.select().from(schema.invitations).where(and(
    eq(schema.invitations.id, id), eq(schema.invitations.schoolId, admin.schoolId)
  )).limit(1)
  if (!previous?.userId) throw createError({ statusCode: 404, message: '邀请不存在' })
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, previous.userId), eq(schema.users.schoolId, admin.schoolId)
  )).limit(1)
  if (!target || target.status === 'active') throw createError({ statusCode: 409, message: '该账号已激活，无需重新邀请' })
  const { invitation, token } = await issueInvitation(event, {
    schoolId: admin.schoolId, userId: target.id, name: target.name, phone: target.phone,
    role: target.role as 'teacher' | 'psychologist', invitedBy: admin.id
  })
  await writeAudit(event, {
    schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.invitation.regenerate',
    targetType: 'user', targetId: target.id, metadata: { invitationId: invitation.id }
  })
  return { ok: true, invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
})

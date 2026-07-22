import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { issueInvitation } from '../../../../domain/invitations'
import { schoolAdminUserUpdateSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement } from '../../../../domain/school-management'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminUserUpdateSchema.parse(await readBody(event))
  const db = useDb(event)
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  const needsActivation = Boolean(body.resetMfa || body.reissueInvitation)
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({
      name: body.name,
      status: needsActivation ? 'invited' : body.status,
      totpSecretEnc: body.resetMfa ? null : undefined,
      updatedAt: new Date()
    }).where(eq(schema.users.id, target.id))
    if (body.status === 'disabled' || needsActivation) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, target.id))
    if (body.resetMfa) await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, target.id))
  })

  let activation: { invitationId: string, activationToken: string, expiresAt: Date } | undefined
  if (needsActivation) {
    const { invitation, token } = await issueInvitation(event, {
      schoolId, userId: target.id, name: body.name || target.name, email: target.email,
      role: target.role as 'teacher' | 'psychologist', invitedBy: actor.id
    })
    activation = { invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
  }
  await writeAudit(event, {
    schoolId, actorId: actor.id, action: body.resetMfa ? 'school_admin.user.mfa_reset' : 'school_admin.user.update',
    targetType: 'user', targetId: id,
    metadata: { status: body.status, nameChanged: Boolean(body.name), resetMfa: Boolean(body.resetMfa), invitationReissued: needsActivation, delegatedGrantId }
  })
  return { ok: true, ...activation }
})

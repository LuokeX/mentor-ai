import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { issueInvitation } from '../../../../domain/invitations'

const bodySchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  resetMfa: z.boolean().optional(),
  reissueInvitation: z.boolean().optional(),
  temporaryPassword: z.string().max(200).optional()
}).refine(value => value.status || value.resetMfa || value.reissueInvitation || value.temporaryPassword)

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, admin.schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  const needsActivation = Boolean(body.resetMfa || body.reissueInvitation || body.temporaryPassword)
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({
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
      schoolId: admin.schoolId, userId: target.id, name: target.name, email: target.email,
      role: target.role as 'teacher' | 'psychologist', invitedBy: admin.id
    })
    activation = { invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
  }
  await writeAudit(event, {
    schoolId: admin.schoolId, actorId: admin.id, action: body.resetMfa ? 'school_admin.user.mfa_reset' : 'school_admin.user.update',
    targetType: 'user', targetId: id,
    metadata: { status: body.status, resetMfa: Boolean(body.resetMfa), invitationReissued: needsActivation }
  })
  return { ok: true, ...activation }
})

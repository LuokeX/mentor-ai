import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { schoolAdminUserInviteSchema } from '../../../../shared/contracts'
import { issueInvitation } from '../../../domain/invitations'
import { requireSchoolManagement } from '../../../domain/school-management'
import { writeAudit } from '../../../utils/audit'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const body = schoolAdminUserInviteSchema.parse(await readBody(event))
  const db = useDb(event)
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, body.email)).limit(1)

  if (existing && existing.schoolId !== schoolId) {
    throw createError({ statusCode: 409, message: '该邮箱已绑定其他学校账号' })
  }
  if (existing?.status === 'active' || existing?.status === 'disabled') {
    throw createError({ statusCode: 409, message: '该邮箱已绑定账号，不能重复邀请' })
  }

  const result = await db.transaction(async (tx) => {
    let invitedUser: typeof schema.users.$inferSelect | undefined
    if (existing) {
      [invitedUser] = await tx.update(schema.users).set({
        name: body.name,
        role: body.role,
        status: 'invited',
        updatedAt: new Date(),
      }).where(and(
        eq(schema.users.id, existing.id),
        eq(schema.users.schoolId, schoolId),
        eq(schema.users.status, 'invited'),
      )).returning()
    } else {
      [invitedUser] = await tx.insert(schema.users).values({
        schoolId,
        name: body.name,
        email: body.email,
        role: body.role,
        status: 'invited',
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id }),
      }).returning()
    }
    if (!invitedUser) throw createError({ statusCode: 409, message: '邀请账号状态已变化，请刷新后重试' })

    const { invitation, token } = await issueInvitation(event, {
      schoolId,
      userId: invitedUser.id,
      name: invitedUser.name,
      email: invitedUser.email,
      role: invitedUser.role as 'teacher' | 'psychologist',
      invitedBy: actor.id,
    }, tx as ReturnType<typeof useDb>)

    await writeAudit(event, {
      schoolId,
      actorId: actor.id,
      action: 'school_admin.user.invite',
      targetType: 'user',
      targetId: invitedUser.id,
      metadata: {
        role: invitedUser.role,
        invitationId: invitation.id,
        expiresAt: invitation.expiresAt.toISOString(),
        delegatedGrantId,
      },
    }, tx)

    return { invitedUser, invitation, token }
  })

  return {
    ok: true,
    id: result.invitedUser.id,
    invitationId: result.invitation.id,
    activationToken: result.token,
    expiresAt: result.invitation.expiresAt,
  }
})

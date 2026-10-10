import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { issueInvitation } from '../../../../../../domain/invitations'
import { applyUserRoles } from '../../../../../../domain/user-roles'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'
import { PHONE_PATTERN } from '../../../../../../../shared/contracts'

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(PHONE_PATTERN)
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const schoolId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)
  if (existing && (existing.schoolId !== schoolId || existing.status === 'active')) throw createError({ statusCode: 409, message: '该手机号已绑定账号' })

  // 账号与角色集合在同一事务写入；邀请在事务外创建（邀请失败不影响已建账号，可重发邀请）
  const user = await db.transaction(async (tx) => {
    const [target] = existing
      ? await tx.update(schema.users)
        .set({ name: body.name, role: 'school_admin', status: 'invited', updatedAt: new Date() })
        .where(eq(schema.users.id, existing.id))
        .returning({ id: schema.users.id })
      : await tx.insert(schema.users).values({
        schoolId,
        name: body.name,
        phone: body.phone,
        role: 'school_admin',
        status: 'invited',
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id })
      }).returning({ id: schema.users.id })
    if (!target) throw createError({ statusCode: 500, message: '学校管理员创建失败' })

    // 角色关联：邀请阶段先落 school_admin 角色行，激活后即可切换激活角色
    await applyUserRoles(tx, {
      userId: target.id,
      roleCodes: ['school_admin'],
      primaryRole: 'school_admin',
    })
    return target
  })

  const { invitation, token } = await issueInvitation(event, {
    schoolId,
    userId: user.id,
    name: body.name,
    phone: body.phone,
    role: 'school_admin',
    invitedBy: admin.id
  })
  await writeAudit(event, {
    schoolId, actorId: admin.id, action: 'platform_admin.school_admin.invite',
    targetType: 'user', targetId: user.id,
    metadata: { invitationId: invitation.id, expiresAt: invitation.expiresAt.toISOString(), roles: ['school_admin'] }
  })
  return { ok: true, id: user.id, invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
})

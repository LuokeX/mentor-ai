import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { issueInvitation } from '../../../../../../domain/invitations'
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
  let user: typeof schema.users.$inferSelect | undefined
  if (existing) {
    user = existing
  } else {
    const inserted = await db.insert(schema.users).values({
      schoolId,
      name: body.name,
      phone: body.phone,
      role: 'school_admin',
      status: 'invited',
      passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id })
    }).returning() as any
    user = inserted?.[0]
  }
  if (!user) throw createError({ statusCode: 500, message: '学校管理员创建失败' })
  if (existing) await db.update(schema.users).set({ name: body.name, role: 'school_admin', status: 'invited', updatedAt: new Date() }).where(eq(schema.users.id, user.id))
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
    metadata: { invitationId: invitation.id, expiresAt: invitation.expiresAt.toISOString() }
  })
  return { ok: true, id: user.id, invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
})

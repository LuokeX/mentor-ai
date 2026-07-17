import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'
import { issueInvitation } from '../../../domain/invitations'

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().transform(value => value.toLowerCase()),
  role: z.enum(['teacher', 'psychologist']),
  // 兼容旧客户端字段；服务端不再保存或分发临时密码。
  temporaryPassword: z.string().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const body = inputSchema.parse(await readBody(event))
  const db = useDb(event)
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, body.email)).limit(1)
  if (existing && (existing.schoolId !== admin.schoolId || existing.status === 'active')) {
    throw createError({ statusCode: 409, message: '该邮箱已绑定账号' })
  }
  const user = existing || (await db.insert(schema.users).values({
    schoolId: admin.schoolId,
    name: body.name,
    email: body.email,
    role: body.role,
    status: 'invited',
    passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id })
  }).returning())[0]
  if (!user) throw createError({ statusCode: 500, message: '用户创建失败' })
  if (existing) {
    await db.update(schema.users).set({ name: body.name, role: body.role, status: 'invited', totpSecretEnc: null, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id))
  }
  const { invitation, token } = await issueInvitation(event, {
    schoolId: admin.schoolId, userId: user.id, name: body.name, email: body.email,
    role: body.role, invitedBy: admin.id
  })
  await writeAudit(event, {
    schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.user.invite',
    targetType: 'user', targetId: user.id, metadata: { role: body.role, invitationId: invitation.id, expiresAt: invitation.expiresAt.toISOString() }
  })
  return { ok: true, id: user.id, invitationId: invitation.id, activationToken: token, expiresAt: invitation.expiresAt }
})

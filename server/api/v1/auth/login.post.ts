import argon2 from 'argon2'
import * as OTPAuth from 'otpauth'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../utils/db'
import { createSession } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { encryptSensitive, hashToken } from '../../../utils/crypto'
import { loginRequestSchema } from '../../../../shared/contracts'

export default defineEventHandler(async (event) => {
  const parsed = loginRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: '登录信息格式不正确' })
  }
  const body = parsed.data
  const [user] = await useDb(event).select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)
  const valid = !!user && user.status === 'active' && !!user.passwordHash && await argon2.verify(user.passwordHash, body.password).catch(() => false)
  if (!valid) {
    await writeAudit(event, { action: 'auth.login', result: 'denied', metadata: { phone: body.phone } })
    throw createError({ statusCode: 401, message: '手机号或密码不正确' })
  }

  // 直接创建的心理专员账号未绑定 TOTP：签发 30 分钟一次性绑定凭证（复用 invitations 表 pending 字段与 activate-mfa 绑定流程），
  // 前端展示二维码引导绑定后再完成登录；绑定完成前不创建会话。
  if (user.role === 'psychologist' && !user.totpSecretEnc) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32
    const token = randomBytes(24).toString('base64url')
    const totp = new OTPAuth.TOTP({ issuer: '教师赋能智能平台', label: user.name, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) })
    await useDb(event).insert(schema.invitations).values({
      schoolId: user.schoolId,
      userId: user.id,
      phone: user.phone ?? '',
      name: user.name,
      role: 'psychologist',
      tokenHash: hashToken(token),
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      pendingPasswordHash: user.passwordHash,
      pendingTotpSecretEnc: encryptSensitive(secret, useRuntimeConfig(event).encryptionKey),
    })
    return { ok: false, needsMfa: true, token, secret, otpauthUri: totp.toString() }
  }

  await createSession(event, user.id)
  await useDb(event).update(schema.users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, user.id))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.login' })
  return { ok: true, role: user.role }
})
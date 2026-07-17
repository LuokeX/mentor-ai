import argon2 from 'argon2'
import * as OTPAuth from 'otpauth'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb, schema } from '../../../utils/db'
import { createSession } from '../../../utils/auth'
import { decryptSensitive, hashToken } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { loginRequestSchema } from '../../../../shared/contracts'

export default defineEventHandler(async (event) => {
  const parsed = loginRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    const otpInvalid = parsed.error.issues.some(issue => issue.path[0] === 'otp')
    throw createError({ statusCode: 400, message: otpInvalid ? '动态验证码必须为 6 位数字' : '登录信息格式不正确' })
  }
  const body = parsed.data
  const [user] = await useDb(event).select().from(schema.users).where(eq(schema.users.email, body.email)).limit(1)
  const valid = user && user.status === 'active' && await argon2.verify(user.passwordHash, body.password).catch(() => false)
  if (!valid) {
    await writeAudit(event, { action: 'auth.login', result: 'denied', metadata: { email: body.email } })
    throw createError({ statusCode: 401, message: '邮箱或密码不正确' })
  }

  if (user.role === 'psychologist') {
    if (!user.totpSecretEnc) throw createError({ statusCode: 403, message: '心理专员账号尚未配置二次认证' })
    if (!body.otp && !body.recoveryCode) throw createError({ statusCode: 428, message: '请输入动态验证码或恢复码', data: { code: 'MFA_REQUIRED' } })
    if (body.recoveryCode) {
      const [recovery] = await useDb(event).select().from(schema.mfaRecoveryCodes).where(and(
        eq(schema.mfaRecoveryCodes.userId, user.id),
        eq(schema.mfaRecoveryCodes.codeHash, hashToken(body.recoveryCode.toUpperCase())),
        isNull(schema.mfaRecoveryCodes.usedAt)
      )).limit(1)
      if (!recovery) {
        await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.mfa.recovery', result: 'denied' })
        throw createError({ statusCode: 401, message: '恢复码不正确或已使用' })
      }
      await useDb(event).update(schema.mfaRecoveryCodes).set({ usedAt: new Date() }).where(eq(schema.mfaRecoveryCodes.id, recovery.id))
    } else {
      const secret = decryptSensitive(user.totpSecretEnc, useRuntimeConfig(event).encryptionKey)
      const totp = new OTPAuth.TOTP({ issuer: '教师赋能智能平台', label: user.email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) })
      if (!body.otp || totp.validate({ token: body.otp, window: 1 }) === null) {
        await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.mfa', result: 'denied' })
        throw createError({ statusCode: 401, message: '动态验证码不正确' })
      }
    }
  }

  await createSession(event, user.id)
  await useDb(event).update(schema.users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, user.id))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.login' })
  return { ok: true, role: user.role }
})

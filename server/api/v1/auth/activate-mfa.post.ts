import * as OTPAuth from 'otpauth'
import { eq } from 'drizzle-orm'
import { getRequestIP } from 'h3'
import { z } from 'zod'
import { createRecoveryCodes, findValidInvitation } from '../../../domain/invitations'
import { decryptSensitive, hashToken } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({ token: z.string().min(20).max(200), otp: z.string().regex(/^\d{6}$/) })

export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  const invitation = await findValidInvitation(event, body.token)
  if (!invitation?.userId || invitation.role !== 'psychologist' || !invitation.pendingPasswordHash || !invitation.pendingTotpSecretEnc) {
    throw createError({ statusCode: 410, message: '请重新开始心理专员激活流程' })
  }
  const secret = decryptSensitive(invitation.pendingTotpSecretEnc, useRuntimeConfig(event).encryptionKey)
  const totp = new OTPAuth.TOTP({ issuer: '教师赋能智能平台', label: invitation.name, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) })
  if (totp.validate({ token: body.otp, window: 1 }) === null) throw createError({ statusCode: 422, message: '动态验证码不正确' })
  const recoveryCodes = createRecoveryCodes()
  const now = new Date()
  const db = useDb(event)
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({
      passwordHash: invitation.pendingPasswordHash!,
      totpSecretEnc: invitation.pendingTotpSecretEnc!,
      status: 'active', activatedAt: now, updatedAt: now
    }).where(eq(schema.users.id, invitation.userId!))
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, invitation.userId!))
    await tx.insert(schema.mfaRecoveryCodes).values(recoveryCodes.map(code => ({ userId: invitation.userId!, codeHash: hashToken(code) })))
    await tx.update(schema.invitations).set({
      acceptedAt: now, pendingPasswordHash: null, pendingTotpSecretEnc: null, pendingRecoveryCodeHashes: null
    }).where(eq(schema.invitations.id, invitation.id))
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, invitation.userId!))
    await tx.insert(schema.productEvents).values({
      schoolId: invitation.schoolId, userId: invitation.userId, eventName: 'account_activated', targetType: 'user', targetId: invitation.userId,
      metadata: { mfa: true }
    })
    await tx.insert(schema.auditLogs).values({
      schoolId: invitation.schoolId,
      actorId: invitation.userId,
      action: 'auth.account_activated',
      targetType: 'user',
      targetId: invitation.userId,
      ipAddress: getRequestIP(event, { xForwardedFor: true }) || null,
      metadata: { mfa: true }
    })
  })
  return { ok: true, activated: true, recoveryCodes }
})

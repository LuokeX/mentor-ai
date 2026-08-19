import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { getRequestIP } from 'h3'
import { z } from 'zod'
import { findValidInvitation } from '../../../domain/invitations'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(200) })

export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  const invitation = await findValidInvitation(event, body.token)
  if (!invitation?.userId) throw createError({ statusCode: 410, message: '激活链接无效或已过期' })
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id })
  const now = new Date()
  await useDb(event).transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash, status: 'active', activatedAt: now, updatedAt: now })
      .where(eq(schema.users.id, invitation.userId!))
    await tx.update(schema.invitations).set({ acceptedAt: now }).where(eq(schema.invitations.id, invitation.id))
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, invitation.userId!))
    await tx.insert(schema.productEvents).values({
      schoolId: invitation.schoolId, userId: invitation.userId, eventName: 'account_activated', targetType: 'user', targetId: invitation.userId
    })
    await tx.insert(schema.auditLogs).values({
      schoolId: invitation.schoolId,
      actorId: invitation.userId,
      action: 'auth.account_activated',
      targetType: 'user',
      targetId: invitation.userId,
      ipAddress: getRequestIP(event, { xForwardedFor: true }) || null
    })
  })
  return { ok: true, activated: true }
})
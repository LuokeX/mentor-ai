import type { H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { hashToken } from '../utils/crypto'
import { schema, useDb } from '../utils/db'

export function createActivationToken() {
  return randomBytes(24).toString('base64url')
}

export function invitationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + 72 * 60 * 60 * 1000)
}

export async function issueInvitation(event: H3Event, input: {
  schoolId: string
  userId: string
  name: string
  phone: string
  role: 'teacher' | 'psychologist' | 'school_admin'
  invitedBy: string
}, database: ReturnType<typeof useDb> = useDb(event)) {
  const token = createActivationToken()
  const db = database
  await db.update(schema.invitations).set({ acceptedAt: new Date() }).where(and(
    eq(schema.invitations.userId, input.userId), isNull(schema.invitations.acceptedAt)
  ))
  const [invitation] = await db.insert(schema.invitations).values({
    schoolId: input.schoolId,
    userId: input.userId,
    phone: input.phone,
    name: input.name,
    role: input.role,
    tokenHash: hashToken(token),
    invitedBy: input.invitedBy,
    expiresAt: invitationExpiresAt()
  }).returning()
  if (!invitation) throw new Error('邀请创建失败')
  return { invitation, token }
}

export async function findValidInvitation(event: H3Event, token: string) {
  const [invitation] = await useDb(event).select().from(schema.invitations).where(and(
    eq(schema.invitations.tokenHash, hashToken(token)),
    isNull(schema.invitations.acceptedAt)
  )).limit(1)
  if (!invitation || invitation.expiresAt.getTime() <= Date.now()) return null
  return invitation
}

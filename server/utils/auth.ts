import { and, eq, gt } from 'drizzle-orm'
import { createError, getCookie, getHeader, getRequestIP, setCookie, type H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { useDb, schema } from './db'
import { hashToken } from './crypto'
import type { AppRole, AuthUser } from '../../app/composables/useAuth'

const COOKIE_NAME = 'mentor_session'
const ROLE_LABELS: Record<AppRole, string> = {
  teacher: '班主任', psychologist: '心理专员', school_admin: '学校管理员', platform_admin: '平台管理员'
}

export async function createSession(event: H3Event, userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
  await useDb(event).insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: getHeader(event, 'user-agent') || null,
    ipAddress: getRequestIP(event, { xForwardedFor: true }) || null,
    expiresAt
  })
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt
  })
}

export async function destroySession(event: H3Event) {
  const token = getCookie(event, COOKIE_NAME)
  if (token) await useDb(event).delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)))
  setCookie(event, COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
}

export async function currentUser(event: H3Event): Promise<AuthUser | null> {
  const token = getCookie(event, COOKIE_NAME)
  if (!token) return null
  const [row] = await useDb(event)
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(
      eq(schema.sessions.tokenHash, hashToken(token)),
      gt(schema.sessions.expiresAt, new Date()),
      eq(schema.users.status, 'active')
    ))
    .limit(1)
  if (!row) return null
  if (row.user.schoolId) {
    const [school] = await useDb(event).select({ status: schema.schools.status }).from(schema.schools)
      .where(eq(schema.schools.id, row.user.schoolId)).limit(1)
    if (!school || school.status !== 'active') return null
  }
  const role = row.user.role as AppRole
  return {
    id: row.user.id,
    schoolId: row.user.schoolId,
    email: row.user.email,
    name: row.user.name,
    role,
    roleLabel: ROLE_LABELS[role]
  }
}

export async function requireUser(event: H3Event, roles?: AppRole[]) {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, message: '请先登录' })
  if (roles && !roles.includes(user.role)) {
    throw createError({ statusCode: 403, message: '无权执行此操作' })
  }
  return user
}

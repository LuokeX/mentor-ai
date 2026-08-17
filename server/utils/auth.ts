import { and, eq, gt } from 'drizzle-orm'
import { createError, getCookie, getHeader, getRequestIP, setCookie, type H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { useDb, schema } from './db'
import { hashToken } from './crypto'
import type { AppRole, AuthUser } from '../../app/composables/useAuth'
import { ROLE_LABELS } from './role-labels'

const COOKIE_NAME = 'mentor_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
/**
 * 滑动续期阈值：会话剩余时间低于该值时，当前请求会把会话延长到完整的 TTL。
 * 否则长填写场景（如三库业务向导，86 个必填列、跨天用草稿续填）会在最后一步掉登录。
 * 效果：连续空闲满 TTL 才过期；只要窗口内有任何请求就保持会话。
 */
const SESSION_SLIDING_THRESHOLD_MS = 2 * 60 * 60 * 1000

const sessionCookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' && process.env.SESSION_COOKIE_SECURE !== 'false',
  sameSite: 'lax' as const,
  path: '/',
  expires: expiresAt
})

export async function createSession(event: H3Event, userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await useDb(event).insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: getHeader(event, 'user-agent') || null,
    ipAddress: getRequestIP(event, { xForwardedFor: true }) || null,
    expiresAt
  })
  setCookie(event, COOKIE_NAME, token, sessionCookieOptions(expiresAt))
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
  // 滑动续期：剩余时间低于阈值时把会话延长到完整 TTL（数据库与 cookie 同步更新）
  const remaining = row.session.expiresAt.getTime() - Date.now()
  if (remaining < SESSION_SLIDING_THRESHOLD_MS) {
    const now = new Date()
    await useDb(event).update(schema.sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastSeenAt: now })
      .where(eq(schema.sessions.id, row.session.id))
    setCookie(event, COOKIE_NAME, token, sessionCookieOptions(new Date(now.getTime() + SESSION_TTL_MS)))
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

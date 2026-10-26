import { and, eq, gt } from 'drizzle-orm'
import { createError, getCookie, getHeader, getRequestIP, setCookie, type H3Event } from 'h3'
import { randomBytes, randomInt } from 'node:crypto'
import { useDb, schema } from './db'
import { hashToken } from './crypto'
import type { AppRole, AuthUser } from '../../app/composables/useAuth'
import { ROLE_LABELS } from './role-labels'
import { listUserRoles } from '../domain/user-roles'

/** 生成 16 位混合字符初始密码：保证包含大写、小写、数字、符号各至少一个，去除易混淆字符 */
export function generateInitialPassword(length = 16) {
  const pools = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnpqrstuvwxyz',
    digits: '23456789',
    symbols: '!@#$%^&*_-+=',
  }
  const all = Object.values(pools).join('')
  const pick = (pool: string) => pool[randomInt(pool.length)]
  const chars = Object.values(pools).map(pick)
  while (chars.length < length) chars.push(pick(all))
  // Fisher-Yates 洗牌
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

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

export async function createSession(event: H3Event, userId: string, options: { activeSchoolId?: string | null } = {}) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  // 会话记录登录时的激活租户与主角色（多租户/多角色由 switch-tenant、switch-role 切换）
  const db = useDb(event)
  const [account] = await db.select({ role: schema.users.role, schoolId: schema.users.schoolId })
    .from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  const activeSchoolId = options.activeSchoolId === undefined ? (account?.schoolId ?? null) : options.activeSchoolId
  const tenantRoles = account
    ? (await listUserRoles(db, userId, activeSchoolId)).map(entry => entry.roleCode)
    : []
  const activeRole = account
    ? (tenantRoles.includes(account.role as AppRole) ? account.role as AppRole : tenantRoles[0] ?? account.role as AppRole)
    : null
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    activeRole,
    activeSchoolId,
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
  const auth = await currentAuth(event)
  return auth?.user ?? null
}

/** 会话内部信息：供需要会话 id 的服务端逻辑使用（如切换激活角色），不要直接返回给客户端。 */
export interface CurrentAuth {
  user: AuthUser
  /** 当前会话 id（sessions.id），不对外暴露。 */
  sessionId: string
  /** 会话上显式记录的激活角色；为空表示尚未切换过，按主角色解析。 */
  sessionActiveRole: AppRole | null
}

/**
 * 解析当前会话身份：账号主角色、全部角色与「激活角色」。
 *
 * 激活角色规则（多角色账号）：会话显式记录的角色优先，其次账号主角色，最后取角色集合首个。
 * 账号的权限解析、路由落地与 requireUser 都以激活角色为准。
 */
export async function currentAuth(event: H3Event): Promise<CurrentAuth | null> {
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
  // 激活租户：会话显式记录优先，否则回落到账号主租户；租户被停用则拒绝会话。
  let activeSchoolId = row.session.activeSchoolId ?? row.user.schoolId
  if (activeSchoolId) {
    const [school] = await useDb(event).select({ status: schema.schools.status }).from(schema.schools)
      .where(eq(schema.schools.id, activeSchoolId)).limit(1)
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
  const db = useDb(event)
  let roleEntries = await listUserRoles(db, row.user.id, activeSchoolId)
  // 会话里的激活租户已失效（角色被移除/租户变更）：回落到账号主租户，避免会话卡死。
  if (!roleEntries.length && activeSchoolId !== row.user.schoolId) {
    activeSchoolId = row.user.schoolId
    roleEntries = await listUserRoles(db, row.user.id, activeSchoolId)
  }
  // 迁移已保证每个账号至少一行角色；这里对历史/异常数据保留主角色兜底，避免登录被卡住
  const roles: AppRole[] = roleEntries.length
    ? roleEntries.map(entry => entry.roleCode)
    : [row.user.role as AppRole]
  const primaryRole = activeSchoolId === row.user.schoolId
    ? row.user.role as AppRole
    : (roles[0] ?? row.user.role as AppRole)
  if (!roles.includes(primaryRole)) roles.push(primaryRole)
  const sessionActiveRole = (row.session.activeRole as AppRole | null) ?? null
  const activeRole = sessionActiveRole && roles.includes(sessionActiveRole)
    ? sessionActiveRole
    : (roles.includes(primaryRole) ? primaryRole : roles[0]!)
  return {
    sessionId: row.session.id,
    sessionActiveRole,
    user: {
      id: row.user.id,
      schoolId: activeSchoolId,
      phone: row.user.phone ?? '',
      name: row.user.name,
      role: activeRole,
      roles,
      roleLabel: ROLE_LABELS[activeRole],
      // 任教年级：随会话用户一起带出（同一行数据，不额外查询），供按学段筛选资源使用
      teachingGrades: row.user.teachingGrades ?? []
    }
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

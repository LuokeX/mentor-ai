import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import * as oidc from 'openid-client'
import type { AuthUser } from '../../app/composables/useAuth'
import { useDb, schema } from '../utils/db'
import { ROLE_LABELS } from '../utils/role-labels'

const SSO_STATE_COOKIE = 'mentor_sso_state'
const SSO_VERIFIER_COOKIE = 'mentor_sso_verifier'
const SSO_COOKIE_TTL_SECONDS = 10 * 60
const SSO_SCOPE = 'openid profile email'

/** Discovery 结果做进程级缓存；配置变更需重启生效 */
let discoveryPromise: Promise<oidc.Configuration> | null = null

interface SsoConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function ssoConfig(event: H3Event): SsoConfig {
  const c = useRuntimeConfig(event)
  const config = {
    issuer: c.oidcIssuer,
    clientId: c.oidcClientId,
    clientSecret: c.oidcClientSecret,
    redirectUri: c.oidcRedirectUri
  }
  if (!config.issuer || !config.clientId || !config.clientSecret || !config.redirectUri) {
    throw createError({ statusCode: 503, message: '统一身份验证未配置，请联系管理员' })
  }
  return config
}

function oidcConfiguration(event: H3Event): Promise<oidc.Configuration> {
  const cfg = ssoConfig(event)
  discoveryPromise ??= oidc.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret, undefined, {
    // 本地 mock 与校园内网 IdP 常为 http 部署；https issuer 时该扩展无副作用
    execute: cfg.issuer.startsWith('http://') ? [oidc.allowInsecureRequests] : undefined
  })
  return discoveryPromise
}

const ssoCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/api/v1/auth/sso',
  maxAge: SSO_COOKIE_TTL_SECONDS
}

/**
 * 生成 state 与 PKCE verifier（存短 TTL httpOnly cookie），返回 IdP 授权 URL。
 * 回调时按 cookie 取回校验，防止 CSRF 与授权码劫持。
 */
export async function ssoAuthorizeUrl(event: H3Event): Promise<string> {
  const config = await oidcConfiguration(event)
  const cfg = ssoConfig(event)
  const state = oidc.randomState()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  setCookie(event, SSO_STATE_COOKIE, state, ssoCookieOptions)
  setCookie(event, SSO_VERIFIER_COOKIE, codeVerifier, ssoCookieOptions)
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: SSO_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).href
}

/** IdP 用户信息中可用于匹配本地账号的字段 */
export interface IdpProfile {
  sub: string
  email?: string | null
  employeeNo?: string | null
}

export interface MappingCandidate {
  subject: string
  email?: string
  employeeNo?: string
}

/** 从 IdP 用户信息提取本地账号匹配键（纯函数，可单测） */
export function toMappingCandidate(profile: IdpProfile): MappingCandidate {
  return {
    subject: profile.sub,
    email: profile.email?.trim().toLowerCase() || undefined,
    employeeNo: profile.employeeNo?.trim() || undefined
  }
}

/** 按优先级匹配本地账号：已绑定 subject → email（唯一）→ 工号（仅唯一命中） */
export async function findUserByMapping(event: H3Event, candidate: MappingCandidate) {
  const db = useDb(event)
  return matchUser(candidate, {
    bySubject: async (subject) => (await db.select().from(schema.users).where(eq(schema.users.oidcSubject, subject)).limit(1))[0],
    byEmail: async (email) => (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0],
    // 工号仅 (schoolId, employeeNo) 唯一，多校同工号视为歧义，跳过该键
    byEmployeeNo: async (employeeNo) => await db.select().from(schema.users).where(eq(schema.users.employeeNo, employeeNo)).limit(2)
  })
}

type UserRow = typeof schema.users.$inferSelect

export interface UserMatcher {
  bySubject(subject: string): Promise<UserRow | undefined>
  byEmail(email: string): Promise<UserRow | undefined>
  byEmployeeNo(employeeNo: string): Promise<UserRow[]>
}

/** 匹配优先级与歧义处理（纯逻辑，可单测） */
export async function matchUser(candidate: MappingCandidate, find: UserMatcher): Promise<UserRow | null> {
  const bySubject = await find.bySubject(candidate.subject)
  if (bySubject) return bySubject
  if (candidate.email) {
    const byEmail = await find.byEmail(candidate.email)
    if (byEmail) return byEmail
  }
  if (candidate.employeeNo) {
    const byEmployeeNo = await find.byEmployeeNo(candidate.employeeNo)
    if (byEmployeeNo.length === 1) return byEmployeeNo[0] ?? null
  }
  return null
}

function ssoDenied(message: string, email?: string) {
  return createError({ statusCode: 403, message, data: { email } })
}

/**
 * 完成 OIDC 授权码交换与本地账号映射。
 * 校验 state → 换 token → 取用户信息 → 匹配本地用户 → 绑定 subject。
 * 未预置账号与非 active 账号拒绝（403），错误 data 携带 email 供路由写审计。
 */
export async function completeSsoLogin(event: H3Event): Promise<AuthUser> {
  const config = await oidcConfiguration(event)
  const expectedState = getCookie(event, SSO_STATE_COOKIE)
  const codeVerifier = getCookie(event, SSO_VERIFIER_COOKIE)
  if (!expectedState || !codeVerifier) {
    throw createError({ statusCode: 400, message: '统一身份登录已过期，请重试' })
  }
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers
  try {
    tokens = await oidc.authorizationCodeGrant(config, getRequestURL(event), {
      pkceCodeVerifier: codeVerifier,
      expectedState
    })
  } catch {
    throw createError({ statusCode: 400, message: '统一身份验证失败，请重试' })
  }
  const idClaims = tokens.claims()
  const subject = idClaims?.sub
  if (typeof subject !== 'string' || !subject) {
    throw createError({ statusCode: 400, message: '统一身份验证响应缺少用户标识' })
  }
  let profile: IdpProfile
  try {
    profile = await oidc.fetchUserInfo(config, tokens.access_token, subject) as IdpProfile
  } catch {
    throw createError({ statusCode: 400, message: '无法获取统一身份用户信息' })
  }
  const candidate = toMappingCandidate({ ...profile, sub: subject })
  const user = await findUserByMapping(event, candidate)
  if (!user) {
    throw ssoDenied('该账号未在本平台开通，请联系学校管理员', candidate.email)
  }
  if (user.status !== 'active') {
    throw ssoDenied('该账号已被停用，请联系学校管理员', candidate.email)
  }
  if (user.schoolId) {
    const [school] = await useDb(event).select({ status: schema.schools.status }).from(schema.schools)
      .where(eq(schema.schools.id, user.schoolId)).limit(1)
    if (!school || school.status !== 'active') {
      throw ssoDenied('该账号所属学校不可用，请联系管理员', candidate.email)
    }
  }
  if (user.oidcSubject !== candidate.subject) {
    await useDb(event).update(schema.users)
      .set({ oidcSubject: candidate.subject, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))
  }
  const role = user.role as AuthUser['role']
  return {
    id: user.id,
    schoolId: user.schoolId,
    email: user.email,
    name: user.name,
    role,
    roleLabel: ROLE_LABELS[role]
  }
}

/** 清除 SSO 流程 cookie（成功或失败后调用） */
export function clearSsoCookies(event: H3Event) {
  const opts = { ...ssoCookieOptions, maxAge: 0 }
  setCookie(event, SSO_STATE_COOKIE, '', opts)
  setCookie(event, SSO_VERIFIER_COOKIE, '', opts)
}
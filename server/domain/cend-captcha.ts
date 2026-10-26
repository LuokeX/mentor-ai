/**
 * C 端图形验证码（无短信 MVP）。
 *
 * 无状态实现：验证码与过期时间签名后放在 httpOnly Cookie 中，提交时校验签名与有效期，
 * 成功后立即清除。不依赖数据库，重启后已发出的验证码仍可校验到过期。
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'

const CAPTCHA_COOKIE = 'mentor_captcha'
const CAPTCHA_TTL_MS = 5 * 60 * 1000
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function sign(code: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`${code.toLowerCase()}:${expiresAt}`).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.SESSION_COOKIE_SECURE !== 'false',
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge })
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, char => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[char] ?? char))
}

function renderSvg(code: string): string {
  const colors = ['#0f766e', '#0369a1', '#7c3aed', '#b45309', '#be123c']
  const chars = code.split('').map((char, index) => {
    const x = 14 + index * 26 + randomInt(0, 5)
    const y = 28 + randomInt(-4, 5)
    const rotate = randomInt(-18, 19)
    const color = colors[randomInt(colors.length)]
    return `<text x="${x}" y="${y}" fill="${color}" font-size="24" font-family="monospace" font-weight="700" transform="rotate(${rotate} ${x} ${y})">${escapeXml(char)}</text>`
  }).join('')
  const lines = Array.from({ length: 3 }, () => {
    const y1 = randomInt(6, 34)
    const y2 = randomInt(6, 34)
    return `<line x1="0" y1="${y1}" x2="120" y2="${y2}" stroke="#94a3b8" stroke-width="1" opacity="0.55"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" role="img" aria-label="验证码"><rect width="120" height="40" rx="8" fill="#f8fafc"/>${lines}${chars}</svg>`
}

/** 生成验证码并写入 Cookie，返回可直接内嵌的 SVG。 */
export function createCaptcha(event: H3Event): { svg: string } {
  const secret = String(useRuntimeConfig(event).sessionSecret || 'development-only-change-me')
  const code = Array.from({ length: 4 }, () => CHARS[randomInt(CHARS.length)]).join('')
  const expiresAt = Date.now() + CAPTCHA_TTL_MS
  setCookie(event, CAPTCHA_COOKIE, `${expiresAt}.${sign(code, expiresAt, secret)}`, cookieOptions(CAPTCHA_TTL_MS / 1000))
  return { svg: renderSvg(code) }
}

/** 校验并消费验证码；无论成功失败都清除 Cookie，避免重复提交。 */
export function verifyCaptcha(event: H3Event, input: string): boolean {
  const secret = String(useRuntimeConfig(event).sessionSecret || 'development-only-change-me')
  const token = getCookie(event, CAPTCHA_COOKIE)
  setCookie(event, CAPTCHA_COOKIE, '', cookieOptions(0))
  if (!token) return false
  const [expiresRaw, signature] = token.split('.')
  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) return false
  const code = input.trim().toUpperCase()
  if (!code) return false
  return safeEqual(signature, sign(code, expiresAt, secret))
}

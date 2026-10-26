import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { getRequestIP } from 'h3'
import { z } from 'zod'
import { PHONE_PATTERN } from '../../../../../shared/contracts'
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from '../../../../domain/cend-rate-limit'
import { findCendSchool } from '../../../../domain/cend-school'
import { listUserRoles } from '../../../../domain/user-roles'
import { writeAudit } from '../../../../utils/audit'
import { createSession } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN),
  password: z.string().min(8).max(200)
})

/** C 端密码登录：校验密码后，会话激活租户固定为 C 端。 */
export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const rateKey = `${ip}:${body.phone}`
  const rate = loginRateLimit(rateKey)
  if (!rate.allowed) {
    throw createError({
      statusCode: 429,
      message: `登录尝试次数过多，请 ${rate.retryAfterSeconds} 秒后再试`,
      data: { retryAfterSeconds: rate.retryAfterSeconds }
    })
  }
  const db = useDb(event)
  const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)
  const valid = Boolean(user) && user!.status === 'active' && Boolean(user!.passwordHash)
    && await argon2.verify(user!.passwordHash!, body.password).catch(() => false)
  if (!valid) {
    recordLoginFailure(rateKey)
    await writeAudit(event, {
      action: 'cend.auth.login',
      result: 'denied',
      metadata: { phone: body.phone }
    })
    throw createError({ statusCode: 401, message: '手机号或密码不正确' })
  }
  clearLoginFailures(rateKey)

  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化，请联系平台管理员' })
  const roles = await listUserRoles(db, user!.id, cend.id)
  if (!roles.length) {
    throw createError({ statusCode: 403, message: '该账号尚未开通 C 端，请先注册或联系管理员' })
  }

  await createSession(event, user!.id, { activeSchoolId: cend.id })
  await writeAudit(event, {
    schoolId: cend.id,
    actorId: user!.id,
    action: 'cend.auth.login'
  })
  return {
    ok: true,
    schoolId: cend.id,
    schoolName: cend.name,
    role: roles[0]?.roleCode ?? 'teacher',
    roles: roles.map(entry => entry.roleCode)
  }
})

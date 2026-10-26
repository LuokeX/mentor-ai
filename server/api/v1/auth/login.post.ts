import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../utils/db'
import { createSession } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { listUserRoles } from '../../../domain/user-roles'
import { loginRequestSchema } from '../../../../shared/contracts'

export default defineEventHandler(async (event) => {
  const parsed = loginRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: '登录信息格式不正确' })
  }
  const body = parsed.data
  const [user] = await useDb(event).select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)
  const valid = !!user && user.status === 'active' && !!user.passwordHash && await argon2.verify(user.passwordHash, body.password).catch(() => false)
  if (!valid) {
    await writeAudit(event, { action: 'auth.login', result: 'denied', metadata: { phone: body.phone } })
    throw createError({ statusCode: 401, message: '手机号或密码不正确' })
  }

  await createSession(event, user.id)
  // 登录只更新 lastLoginAt，不触碰 updatedAt（避免并发控制字段被登录行为污染导致 409）
  await useDb(event).update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.login' })
  // role 为登录后的激活角色（默认主角色）；roles 为该账号持有的全部角色，供前端落地与角色切换使用
  const roles = (await listUserRoles(useDb(event), user.id, user.schoolId)).map(entry => entry.roleCode)
  return { ok: true, role: user.role, roles: roles.length ? roles : [user.role] }
})
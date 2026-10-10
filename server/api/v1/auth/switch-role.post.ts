import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { roleSchema } from '../../../../shared/contracts'
import { currentAuth } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({
  /** 目标激活角色；必须属于当前账号持有的角色集合 */
  role: roleSchema
})

/**
 * 切换当前会话的激活角色（多角色账号）。
 * 能力、落地页与可访问前缀都跟激活角色走；账号未持有的角色一律 403。
 * 切换本身是幂等的：已是目标角色时不重复写审计。
 */
export default defineEventHandler(async (event) => {
  const auth = await currentAuth(event)
  if (!auth) throw createError({ statusCode: 401, message: '请先登录' })
  const body = bodySchema.parse(await readBody(event))

  const roles = auth.user.roles ?? [auth.user.role]
  if (!roles.includes(body.role)) {
    await writeAudit(event, {
      schoolId: auth.user.schoolId,
      actorId: auth.user.id,
      action: 'auth.role_switch',
      result: 'denied',
      metadata: { from: auth.user.role, to: body.role }
    })
    throw createError({ statusCode: 403, message: '该账号未持有此角色' })
  }

  if (auth.user.role !== body.role) {
    await useDb(event).update(schema.sessions)
      .set({ activeRole: body.role })
      .where(eq(schema.sessions.id, auth.sessionId))
    await writeAudit(event, {
      schoolId: auth.user.schoolId,
      actorId: auth.user.id,
      action: 'auth.role_switch',
      metadata: { from: auth.user.role, to: body.role }
    })
  }

  return { ok: true, role: body.role }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentAuth } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { listUserRoles } from '../../../domain/user-roles'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({
  /** 目标租户（学校/C 端）；必须是当前账号实际持有角色的租户 */
  schoolId: z.string().uuid()
})

/**
 * 切换当前会话的激活租户（多租户工作区）。
 * 只允许切到账号在该租户下确实持有角色的学校；切换后 active_role 取该租户的角色。
 * 学校/C 端数据隔离由 AuthUser.schoolId（= 激活租户）保证。
 */
export default defineEventHandler(async (event) => {
  const auth = await currentAuth(event)
  if (!auth) throw createError({ statusCode: 401, message: '请先登录' })
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [school] = await db.select({ id: schema.schools.id, name: schema.schools.name, status: schema.schools.status })
    .from(schema.schools)
    .where(eq(schema.schools.id, body.schoolId))
    .limit(1)
  if (!school || school.status !== 'active') {
    throw createError({ statusCode: 404, message: '目标工作区不存在或已停用' })
  }

  const entries = await listUserRoles(db, auth.user.id, body.schoolId)
  if (!entries.length) {
    await writeAudit(event, {
      schoolId: body.schoolId,
      actorId: auth.user.id,
      action: 'auth.tenant_switch',
      result: 'denied',
      metadata: { from: auth.user.schoolId, to: body.schoolId }
    })
    throw createError({ statusCode: 403, message: '该账号未加入此工作区' })
  }

  const roles = entries.map(entry => entry.roleCode)
  const activeRole = roles.includes(auth.user.role) ? auth.user.role : roles[0]!
  if (auth.user.schoolId !== body.schoolId || auth.user.role !== activeRole) {
    await db.update(schema.sessions)
      .set({ activeSchoolId: body.schoolId, activeRole })
      .where(and(eq(schema.sessions.id, auth.sessionId), eq(schema.sessions.userId, auth.user.id)))
    await writeAudit(event, {
      schoolId: body.schoolId,
      actorId: auth.user.id,
      action: 'auth.tenant_switch',
      metadata: { from: auth.user.schoolId, to: body.schoolId, fromRole: auth.user.role, toRole: activeRole }
    })
  }

  return { ok: true, schoolId: school.id, schoolName: school.name, role: activeRole, roles }
})

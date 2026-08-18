import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { updatedAtMatches } from '../../../../utils/concurrency'
import { countRolePermissions } from '../../../../domain/roles'
import { platformAdminRoleUpdateSchema } from '../../../../../shared/contracts'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = platformAdminRoleUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1)
  if (!role) throw createError({ statusCode: 404, message: '角色不存在' })
  // 系统角色只允许调整权限清单，code/name/isSystem 等字段不可修改
  const updated = await db.update(schema.roles)
    .set({ permissions: body.permissions!, updatedAt: new Date() })
    .where(and(eq(schema.roles.id, id), updatedAtMatches(schema.roles.updatedAt, expectedUpdatedAt)))
    .returning()
  const [result] = updated
  if (!result) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '角色权限已被其他平台管理员修改，请刷新后重试' })
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.role.update',
    targetType: 'role',
    targetId: result.id,
    metadata: { code: result.code, ...countRolePermissions(result.permissions) },
  })
  return { ...result, ...countRolePermissions(result.permissions) }
})
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { countRolePermissions, normalizeRolePermissions } from '../../../../domain/roles'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1)
  if (!role) throw createError({ statusCode: 404, message: '角色不存在' })
  return {
    ...role,
    permissions: normalizeRolePermissions(role.permissions),
    ...countRolePermissions(role.permissions),
  }
})
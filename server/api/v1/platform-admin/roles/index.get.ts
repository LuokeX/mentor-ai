import { asc } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { countRolePermissions } from '../../../../domain/roles'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const rows = await db.select().from(schema.roles).orderBy(asc(schema.roles.code))
  const roles = rows.map((row) => {
    const counts = countRolePermissions(row.permissions)
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      updatedAt: row.updatedAt,
      ...counts,
    }
  })
  return { roles }
})
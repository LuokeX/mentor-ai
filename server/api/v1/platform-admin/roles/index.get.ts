import { and, asc, desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import {
  countRolePermissions,
  defaultRolePermissionsOf,
  effectiveRolePermissions,
  rolePermissionsEqual,
} from '../../../../domain/roles'
import type { RolePermissions } from '../../../../../shared/management'

/** 最近一次权限变更只取最近这些审计行，够覆盖全部内置角色即可 */
const LAST_CHANGE_SCAN = 40

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const rows = await db.select().from(schema.roles).orderBy(asc(schema.roles.code))

  // 最近一次权限变更（含操作人）：审计行数远小于全表，取最近若干条后在内存里按角色取首条
  const auditRows = await db
    .select({
      targetId: schema.auditLogs.targetId,
      actorName: schema.users.name,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(
      eq(schema.auditLogs.action, 'platform_admin.role.update'),
      eq(schema.auditLogs.targetType, 'role'),
    ))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(LAST_CHANGE_SCAN)
  const lastChangeByRole = new Map<string, { actorName: string | null, createdAt: string }>()
  for (const row of auditRows) {
    if (!row.targetId || lastChangeByRole.has(row.targetId)) continue
    lastChangeByRole.set(row.targetId, {
      actorName: row.actorName ?? null,
      createdAt: row.createdAt.toISOString(),
    })
  }

  const roles = rows.map((row) => {
    const stored = (row.permissions ?? { pages: {}, records: {} }) as RolePermissions
    const defaults = defaultRolePermissionsOf(row.code)
    // 缺键在运行时按代码默认回退生效，列表按生效值统计，避免「显示未配置、实际可用」的错位
    const permissions = effectiveRolePermissions(stored, defaults)
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      updatedAt: row.updatedAt,
      isDefault: defaults ? rolePermissionsEqual(permissions, defaults) : false,
      lastChange: lastChangeByRole.get(row.id) ?? null,
      ...countRolePermissions(permissions),
    }
  })
  return { roles }
})

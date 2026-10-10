import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import {
  countRolePermissions,
  defaultRolePermissionsOf,
  effectiveRolePermissions,
  inheritedRolePermissions,
  rolePermissionsEqual,
  sanitizeRolePermissions,
} from '../../../../domain/roles'
import type { RolePermissions } from '../../../../../shared/management'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1)
  if (!role) throw createError({ statusCode: 404, message: '角色不存在' })

  const stored = (role.permissions ?? { pages: {}, records: {} }) as RolePermissions
  // 系统内置默认清单：前端据此提供「恢复系统默认」并标注当前是否与默认一致
  const defaults = defaultRolePermissionsOf(role.code)
  // 缺键在运行时按代码默认回退生效，编辑器按「生效值」展示，否则会出现「显示未勾、实际生效」的错位
  const permissions = effectiveRolePermissions(stored, defaults)
  // 历史残留：库里已经有、但按当前白名单不会生效的项（保存时会被清理，页面需提前提示）
  const { dropped } = sanitizeRolePermissions(permissions)

  const [lastChange] = await db
    .select({
      actorName: schema.users.name,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(
      eq(schema.auditLogs.action, 'platform_admin.role.update'),
      eq(schema.auditLogs.targetType, 'role'),
      eq(schema.auditLogs.targetId, role.id),
    ))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(1)

  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    updatedAt: role.updatedAt,
    permissions,
    defaults,
    isDefault: defaults ? rolePermissionsEqual(permissions, defaults) : false,
    /** 库里未显式配置、当前按系统默认生效的目标类型（编辑器标注「继承默认」） */
    inherited: inheritedRolePermissions(stored),
    legacyPermissions: dropped,
    lastChange: lastChange
      ? { actorName: lastChange.actorName ?? null, createdAt: lastChange.createdAt.toISOString() }
      : null,
    ...countRolePermissions(permissions),
  }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { updatedAtMatches } from '../../../../utils/concurrency'
import {
  countRolePermissions,
  defaultRolePermissionsOf,
  diffRolePermissions,
  effectiveRolePermissions,
  sanitizeRolePermissions,
} from '../../../../domain/roles'
import { platformAdminRoleUpdateSchema } from '../../../../../shared/contracts'
import type { RolePermissions } from '../../../../../shared/management'

/** 审计里最多保留多少条差异，避免单次提交把审计元数据撑爆 */
const MAX_AUDIT_CHANGES = 40

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = platformAdminRoleUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
  if (!body.permissions) throw createError({ statusCode: 400, message: '缺少权限清单' })
  const db = useDb(event)
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1)
  if (!role) throw createError({ statusCode: 404, message: '角色不存在' })

  const stored = (role.permissions ?? { pages: {}, records: {} }) as RolePermissions
  // 差异基准取「生效值」：缺键在运行时按代码默认回退，等价于默认值，不该被记成改动
  const current = effectiveRolePermissions(stored, defaultRolePermissionsOf(role.code))
  // 写入前按共享白名单清洗：未知目标类型与不适用的能力一律不落库
  const { permissions: next, dropped } = sanitizeRolePermissions(body.permissions)
  const changes = diffRolePermissions(current, next)

  // 没有实际改动时不写库、不写审计，只把当前状态回给前端（避免无意义的版本推进与审计噪音）
  if (!changes.length) {
    return {
      ...role,
      permissions: current,
      unchanged: true,
      dropped,
      ...countRolePermissions(current),
    }
  }

  // 系统角色只允许调整权限清单，code/name/isSystem 等字段不可修改
  const updated = await db.update(schema.roles)
    .set({ permissions: next, updatedAt: new Date() })
    .where(and(eq(schema.roles.id, id), updatedAtMatches(schema.roles.updatedAt, expectedUpdatedAt)))
    .returning()
  const [result] = updated
  if (!result) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '角色权限已被其他平台管理员修改，请刷新后重试' })

  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.role.update',
    targetType: 'role',
    targetId: result.id,
    metadata: {
      code: result.code,
      changeCount: changes.length,
      // 逐条记录「哪个目标类型的哪些能力被加/删」，审计可回溯到具体开关
      changes: changes.slice(0, MAX_AUDIT_CHANGES).map(change => ({
        target: `${change.group}.${change.targetType}`,
        added: change.added,
        removed: change.removed,
      })),
      // 请求里带了但不会生效的项（历史配置或前端越界勾选），一并留痕
      droppedCount: dropped.length,
      dropped: dropped.slice(0, MAX_AUDIT_CHANGES),
      ...countRolePermissions(result.permissions),
    },
  })
  return { ...result, unchanged: false, dropped, ...countRolePermissions(result.permissions) }
})

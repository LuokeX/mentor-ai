/**
 * 管理页面能力解析。
 *
 * 能力只描述当前记录允许展示的操作入口；API 仍必须独立完成认证、
 * 租户、负责人、临时授权和状态校验。敏感详情授权由详情接口通过
 * requireAdminGrant 校验，不在列表中逐行查询，避免 N+1 和授权误判。
 *
 * 数据驱动化：resolveCapabilities / resolvePageCapabilities 先从 roles 表
 * 读取当前用户角色的权限清单（permissions jsonb），解析出页面级/记录级能力；
 * roles 表数据缺失或读取失败时回退到下方保留的硬编码逻辑（行为与改造前一致）。
 * 「角色能干什么」数据化；行级业务规则（跨校隔离、负责人过滤、平台管理员
 * 跨校只读旁路、归档/移交/删除/停用等状态门禁）仍保留在代码里。
 */
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import type { AuthUser } from '../../app/composables/useAuth'
import type { Capability, ManagedTargetType, RolePermissions } from '../../shared/management'
import { MANAGED_TARGET_TYPES } from '../../shared/management'
import { schema, useDb } from '../utils/db'

export type { ManagedTargetType } from '../../shared/management'

export interface CapabilityContext {
  user: AuthUser
  recordSchoolId?: string | null
  recordOwnerUserId?: string | null
  recordStatus?: string | null
  targetType: ManagedTargetType
  targetId?: string
  activatedAt?: Date | string | null
}

const ACTIVE_STATUSES = new Set(['active', 'open', 'draft', 'in_progress', 'created', 'acknowledged'])

const CAPABILITY_SET = new Set<Capability>([
  'view', 'view_sensitive', 'create', 'edit', 'inline_edit',
  'archive', 'restore', 'transfer', 'graduate', 'delete', 'disable',
])

/** 只读域目标类型：审计/导入/计划操作/访问申请（业务规则，不允许编辑类能力） */
const READ_ONLY_TARGET_TYPES: ReadonlySet<string> = new Set(['audit', 'import', 'plan_operation', 'access_request'])

/** 家校沟通类目标类型（教师归档仅 active 状态） */
const COMMUNICATION_TARGET_TYPES: ReadonlySet<string> = new Set(['communication', 'guardian_communication'])

// ============================================================
// 硬编码回退（原实现，保持不变）
// ============================================================

export function resolveCapabilitiesHardcoded(ctx: CapabilityContext): Capability[] {
  const {
    user,
    recordSchoolId,
    recordOwnerUserId,
    recordStatus,
    targetType,
  } = ctx

  if (user.role !== 'platform_admin' && recordSchoolId && recordSchoolId !== user.schoolId) return []

  if (user.role === 'teacher') {
    if (!user.schoolId || recordSchoolId !== user.schoolId || recordOwnerUserId !== user.id) return []
    const caps: Capability[] = ['view']
    if (recordStatus === 'archived') return caps

    if (targetType === 'student' || targetType === 'guardian') {
      caps.push('edit', 'inline_edit')
    } else if (targetType === 'communication' || targetType === 'guardian_communication') {
      caps.push('edit', 'inline_edit')
      if (recordStatus === 'active') caps.push('archive')
    } else if (targetType === 'student_event' || targetType === 'class_event') {
      caps.push('edit', 'archive')
    }
    return caps
  }

  if (user.role === 'psychologist') {
    return targetType === 'referral' ? ['view', 'edit'] : []
  }

  if (user.role === 'school_admin' || user.role === 'platform_admin') {
    const caps: Capability[] = ['view']
    if (targetType === 'audit' || targetType === 'import' || targetType === 'plan_operation' || targetType === 'access_request') {
      return caps
    }
    if (targetType === 'referral') {
      if (recordStatus === 'created') caps.push('transfer')
      return caps
    }
    if (targetType === 'user') {
      caps.push('edit')
      if (recordStatus === 'invited' && !ctx.activatedAt) caps.push('delete')
      if (recordStatus !== 'disabled') caps.push('disable')
      return caps
    }
    if (user.role === 'platform_admin' && targetType !== 'school') return caps

    caps.push('edit')
    if (recordStatus === 'archived') {
      caps.push('restore')
    } else if (!recordStatus || ACTIVE_STATUSES.has(recordStatus)) {
      if (['class', 'student', 'guardian', 'department'].includes(targetType)) caps.push('archive')
      if (['class', 'student', 'guardian'].includes(targetType)) caps.push('transfer')
      if (targetType === 'class') caps.push('graduate')
    }
    return caps
  }

  return []
}

export function resolvePageCapabilitiesHardcoded(
  user: AuthUser,
  targetType: ManagedTargetType,
): Capability[] {
  if (user.role === 'teacher') {
    return ['student', 'guardian', 'communication', 'student_event', 'class_event'].includes(targetType)
      ? ['view', 'create']
      : ['view']
  }
  if (user.role === 'psychologist') return targetType === 'referral' ? ['view'] : []
  if (user.role === 'school_admin') {
    return ['audit', 'import', 'plan_operation', 'access_request'].includes(targetType)
      ? ['view']
      : ['view', 'create']
  }
  if (user.role === 'platform_admin') {
    if (targetType === 'school' || targetType === 'user') return ['view', 'create']
    return ['view']
  }
  return []
}

// ============================================================
// 数据驱动解析（roles 表权限清单）
// ============================================================

/** 权限清单净化：非法值剔除，结构非法返回 null（调用方回退硬编码） */
function sanitizeCapabilityList(value: unknown): Capability[] | null {
  if (!Array.isArray(value)) return null
  const out: Capability[] = []
  for (const item of value) {
    if (typeof item === 'string' && CAPABILITY_SET.has(item as Capability) && !out.includes(item as Capability)) {
      out.push(item as Capability)
    }
  }
  return out
}

export function parseRolePermissions(raw: unknown): RolePermissions | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!record.pages || typeof record.pages !== 'object' || !record.records || typeof record.records !== 'object') return null
  const pages: Record<string, Capability[]> = {}
  const records: Record<string, Capability[]> = {}
  for (const [key, value] of Object.entries(record.pages as Record<string, unknown>)) {
    const list = sanitizeCapabilityList(value)
    if (!list) return null
    pages[key] = list
  }
  for (const [key, value] of Object.entries(record.records as Record<string, unknown>)) {
    const list = sanitizeCapabilityList(value)
    if (!list) return null
    records[key] = list
  }
  return { pages, records }
}

/**
 * 按角色从 roles 表读取权限清单，单请求内缓存（event.context.rolesByCode）。
 * 数据缺失 / 结构非法 / 查询失败一律返回 null，由调用方回退硬编码逻辑。
 */
async function loadRolePermissions(role: string, event: H3Event): Promise<RolePermissions | null> {
  const cache = (event.context.rolesByCode ??= {}) as Record<string, RolePermissions | null>
  const cached = cache[role]
  if (cached !== undefined) return cached
  let permissions: RolePermissions | null = null
  try {
    const db = useDb(event)
    const [row] = await db.select().from(schema.roles).where(eq(schema.roles.code, role)).limit(1)
    if (row) permissions = parseRolePermissions(row.permissions)
  } catch {
    permissions = null
  }
  cache[role] = permissions
  return permissions
}

/**
 * 数据驱动版记录级能力。返回 null 表示该 targetType 未在权限配置中，
 * 调用方应回退硬编码逻辑。返回空数组表示明确配置为无能力。
 */
export function resolveCapabilitiesFromRoleData(ctx: CapabilityContext, perm: RolePermissions): Capability[] | null {
  const { user, recordSchoolId, recordOwnerUserId, recordStatus, targetType } = ctx
  const rec = perm.records[targetType]
  if (rec === undefined) return null

  // ==== 行级业务规则（保留在代码，不数据化）====
  if (user.role !== 'platform_admin' && recordSchoolId && recordSchoolId !== user.schoolId) return []

  if (user.role === 'teacher') {
    if (!user.schoolId || recordSchoolId !== user.schoolId || recordOwnerUserId !== user.id) return []
    // 归档记录只读
    if (recordStatus === 'archived') return rec.filter(c => c === 'view')
    // 家校沟通类记录的归档仅在 active 状态开放
    if (COMMUNICATION_TARGET_TYPES.has(targetType) && recordStatus !== 'active') {
      return rec.filter(c => c !== 'archive')
    }
    return [...rec]
  }

  if (user.role === 'psychologist') {
    // 心理专员仅处理转介（业务边界）
    return targetType === 'referral' ? [...rec] : []
  }

  if (user.role === 'school_admin' || user.role === 'platform_admin') {
    // 只读域：审计/导入/计划操作/访问申请
    if (READ_ONLY_TARGET_TYPES.has(targetType)) return rec.filter(c => c === 'view')
    if (targetType === 'referral') {
      // 转介移交仅在待确认（created）状态开放
      return rec.filter(c => c !== 'transfer' || recordStatus === 'created')
    }
    if (targetType === 'user') {
      // 仅未激活邀请可删除；已停用账号不可再停用
      return rec.filter(c =>
        (c !== 'delete' || (recordStatus === 'invited' && !ctx.activatedAt)) &&
        (c !== 'disable' || recordStatus !== 'disabled'))
    }
    if (user.role === 'platform_admin' && targetType !== 'school') {
      // 平台管理员跨校记录只读旁路
      return rec.filter(c => c === 'view')
    }
    // 生命周期状态门禁
    if (recordStatus === 'archived') {
      return rec.filter(c => c === 'view' || c === 'edit' || c === 'restore')
    }
    if (recordStatus && !ACTIVE_STATUSES.has(recordStatus)) {
      return rec.filter(c => c === 'view' || c === 'edit')
    }
    return rec.filter(c => c === 'view' || c === 'edit' || c === 'archive' || c === 'transfer' || c === 'graduate')
  }

  return []
}

/** 数据驱动版页面级能力。返回 null 表示该 targetType 未配置，调用方回退硬编码。 */
export function resolvePageCapabilitiesFromRoleData(
  user: AuthUser,
  targetType: ManagedTargetType,
  perm: RolePermissions,
): Capability[] | null {
  const list = perm.pages[targetType]
  if (list === undefined) return null
  return [...list]
}

// ============================================================
// 对外入口：先查表，查不到回退硬编码
// ============================================================

/**
 * 解析记录级能力。传 event 时先查 roles 表权限配置（单请求内缓存），
 * 查不到 / 读取失败回退硬编码逻辑。
 */
export async function resolveCapabilities(ctx: CapabilityContext, event?: H3Event): Promise<Capability[]> {
  if (event) {
    const perm = await loadRolePermissions(ctx.user.role, event)
    if (perm) {
      const fromData = resolveCapabilitiesFromRoleData(ctx, perm)
      if (fromData !== null) return fromData
    }
  }
  return resolveCapabilitiesHardcoded(ctx)
}

/**
 * 解析页面级能力。传 event 时先查 roles 表权限配置（单请求内缓存），
 * 查不到 / 读取失败回退硬编码逻辑。
 */
export async function resolvePageCapabilities(
  user: AuthUser,
  targetType: ManagedTargetType,
  event?: H3Event,
): Promise<Capability[]> {
  if (event) {
    const perm = await loadRolePermissions(user.role, event)
    if (perm) {
      const fromData = resolvePageCapabilitiesFromRoleData(user, targetType, perm)
      if (fromData !== null) return fromData
    }
  }
  return resolvePageCapabilitiesHardcoded(user, targetType)
}

/** 受支持的目标类型全集（供角色权限编辑页 / 校验使用） */
export { MANAGED_TARGET_TYPES }
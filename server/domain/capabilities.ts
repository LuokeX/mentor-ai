/**
 * 统一能力解析器
 *
 * 按以下顺序解析用户对某条记录的操作能力：
 *   角色 → 学校 → 负责人/分配关系 → 记录状态 → 临时授权 → 具体动作
 *
 * 前端只能根据此函数返回的能力数组来隐藏/禁用按钮，
 * 不能自行推断真实权限。
 */
import type { H3Event } from 'h3'
import { and, eq, gte } from 'drizzle-orm'
import { useDb, schema } from '../utils/db'
import type { AuthUser } from '../../app/composables/useAuth'
import type { Capability } from '../../shared/management'

export type CapabilityContext = {
  user: AuthUser
  /** 目标记录所属学校 ID */
  recordSchoolId?: string | null
  /** 目标记录负责教师 ID */
  recordOwnerUserId?: string | null
  /** 目标记录当前状态 */
  recordStatus?: string | null
  /** 目标记录类型（用于临时授权匹配） */
  targetType?: string
  /** 目标记录 ID（用于临时授权匹配） */
  targetId?: string
  /** 委托管理 grant ID（平台管理员代管时传入） */
  delegatedGrantId?: string | null
}

/**
 * 解析用户对目标记录的全部操作能力。
 * 服务端 API 在返回记录列表或详情时调用，将结果注入 _capabilities 字段。
 */
export async function resolveCapabilities(ctx: CapabilityContext): Promise<Capability[]> {
  const capabilities: Capability[] = []
  const { user, recordSchoolId, recordOwnerUserId, recordStatus } = ctx

  // === 跨学校 ===
  if (recordSchoolId && user.schoolId && recordSchoolId !== user.schoolId) {
    // 平台管理员通过委托管理可跨校
    if (user.role !== 'platform_admin' || !ctx.delegatedGrantId) return []
  }

  // === 平台管理员 ===
  if (user.role === 'platform_admin') {
    if (ctx.delegatedGrantId) {
      capabilities.push('view')
      capabilities.push('edit')
      capabilities.push('archive')
      capabilities.push('restore')
      capabilities.push('transfer')
    }
    return capabilities
  }

  // === 心理专员 ===
  if (user.role === 'psychologist') {
    // 心理专员只能处理分配给自己的转介
    capabilities.push('view')
    return capabilities
  }

  // === 学校管理员 ===
  if (user.role === 'school_admin') {
    capabilities.push('view', 'create', 'edit', 'archive', 'restore', 'transfer')
    if (ctx.targetType && ctx.targetId) {
      const hasGrant = await checkAccessGrant(ctx)
      if (hasGrant) capabilities.push('view_sensitive')
    }
    return capabilities
  }

  // === 教师 ===
  if (user.role === 'teacher') {
    if (!recordSchoolId || recordSchoolId !== user.schoolId) return []
    capabilities.push('view')

    // 检查是否是负责人
    const isOwner = recordOwnerUserId === user.id
    if (isOwner && recordStatus && recordStatus !== 'archived') {
      capabilities.push('edit', 'inline_edit')
      if (recordStatus === 'active') {
        capabilities.push('archive')
      }
    }
    if (isOwner) {
      capabilities.push('create') // 在自己负责的记录下创建子记录
    }

    // 临时授权可查看敏感详情
    if (ctx.targetType && ctx.targetId) {
      const hasGrant = await checkAccessGrant(ctx)
      if (hasGrant) capabilities.push('view_sensitive')
    }
  }

  return capabilities
}

/**
 * 检查是否有有效的临时访问授权
 */
async function checkAccessGrant(ctx: CapabilityContext): Promise<boolean> {
  if (!ctx.targetType || !ctx.targetId) return false
  const db = useDb(ctx as unknown as H3Event)
  const [grant] = await db.select({ id: schema.adminAccessGrants.id })
    .from(schema.adminAccessGrants)
    .where(and(
      eq(schema.adminAccessGrants.userId, ctx.user.id),
      eq(schema.adminAccessGrants.targetType, ctx.targetType),
      eq(schema.adminAccessGrants.targetId, ctx.targetId),
      gte(schema.adminAccessGrants.expiresAt, new Date()),
    ))
    .limit(1)
  return !!grant && !!(ctx as any).grantRevoked !== true
}

/**
 * 检查页面级能力（不针对具体记录）
 */
export function resolvePageCapabilities(user: AuthUser, area: string): Capability[] {
  const caps: Capability[] = []
  switch (user.role) {
    case 'platform_admin':
      caps.push('view')
      if (area === 'platform') caps.push('create', 'edit')
      break
    case 'school_admin':
      caps.push('view', 'create', 'edit', 'archive', 'restore', 'transfer', 'graduate', 'disable')
      break
    case 'teacher':
      caps.push('view', 'create')
      break
    case 'psychologist':
      caps.push('view')
      break
  }
  return caps
}
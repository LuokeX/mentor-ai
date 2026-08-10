/**
 * 管理页面能力解析。
 *
 * 能力只描述当前记录允许展示的操作入口；API 仍必须独立完成认证、
 * 租户、负责人、临时授权和状态校验。敏感详情授权由详情接口通过
 * requireAdminGrant 校验，不在列表中逐行查询，避免 N+1 和授权误判。
 */
import type { AuthUser } from '../../app/composables/useAuth'
import type { Capability } from '../../shared/management'

export type ManagedTargetType =
  | 'class'
  | 'student'
  | 'guardian'
  | 'communication'
  | 'guardian_communication'
  | 'student_event'
  | 'class_event'
  | 'student_case'
  | 'department'
  | 'user'
  | 'school'
  | 'referral'
  | 'audit'
  | 'import'
  | 'plan_operation'
  | 'access_request'
  | 'delegated_management'

export interface CapabilityContext {
  user: AuthUser
  recordSchoolId?: string | null
  recordOwnerUserId?: string | null
  recordStatus?: string | null
  targetType: ManagedTargetType
  targetId?: string
  delegatedGrantId?: string | null
  activatedAt?: Date | string | null
}

const ACTIVE_STATUSES = new Set(['active', 'open', 'draft', 'in_progress', 'created', 'acknowledged'])

export function resolveCapabilities(ctx: CapabilityContext): Capability[] {
  const {
    user,
    recordSchoolId,
    recordOwnerUserId,
    recordStatus,
    targetType,
    delegatedGrantId,
  } = ctx

  if (user.role !== 'platform_admin' && recordSchoolId && recordSchoolId !== user.schoolId) return []
  if (user.role === 'platform_admin' && recordSchoolId && !delegatedGrantId && targetType !== 'school') return []

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
      caps.push('edit')
    }
    return caps
  }

  if (user.role === 'psychologist') {
    return targetType === 'referral' ? ['view', 'edit'] : []
  }

  if (user.role === 'school_admin' || (user.role === 'platform_admin' && delegatedGrantId)) {
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

  if (user.role === 'platform_admin' && targetType === 'school') {
    return ['view', 'edit']
  }

  return []
}

export function resolvePageCapabilities(
  user: AuthUser,
  targetType: ManagedTargetType,
  delegatedGrantId?: string | null,
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
    if (targetType === 'school') return ['view', 'create']
    return delegatedGrantId ? ['view', 'create'] : ['view']
  }
  return []
}

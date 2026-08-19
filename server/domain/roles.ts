/**
 * 角色默认权限清单（与 capabilities.ts 现有硬编码逻辑等价）。
 *
 * 用途：
 * 1. 迁移 SQL 中四角色 INSERT 默认数据以本文件为准（两者需人工保持同步，
 *    新增 targetType / 能力时必须同时更新本文件与迁移 SQL）。
 * 2. Vitest 用本文件验证「数据驱动解析结果 = 原硬编码结果」。
 *
 * 结构见 shared/management.ts 的 RolePermissions：
 *   pages   —— 页面级能力（键为 ManagedTargetType）
 *   records —— 记录级能力（键为 ManagedTargetType；行级业务规则仍留在代码里）
 *
 * 注意：这里的值是「能力全集」（跨状态的并集），状态门禁
 * （归档只读、移交仅待确认、删除仅未激活邀请、停用排除已停用等）由
 * capabilities.ts 的数据驱动分支在运行时过滤，不体现在本数据里。
 */
import type { AppRole } from '../../app/composables/useAuth'
import type { Capability, ManagedTargetType, RolePermissions } from '../../shared/management'
import { MANAGED_TARGET_TYPES } from '../../shared/management'

type TargetType = ManagedTargetType

const ALL_TARGET_TYPES: TargetType[] = [...MANAGED_TARGET_TYPES]

/** 全目标类型铺满默认值，未显式声明的类型给兜底值 */
function buildRecords(defaults: Partial<Record<TargetType, Capability[]>>, fallback: Capability[]): Record<TargetType, Capability[]> {
  const out = {} as Record<TargetType, Capability[]>
  for (const t of ALL_TARGET_TYPES) out[t] = defaults[t] ?? fallback
  return out
}

function buildPages(defaults: Partial<Record<TargetType, Capability[]>>, fallback: Capability[]): Record<TargetType, Capability[]> {
  const out = {} as Record<TargetType, Capability[]>
  for (const t of ALL_TARGET_TYPES) out[t] = defaults[t] ?? fallback
  return out
}

export const DEFAULT_ROLE_PERMISSIONS: Record<AppRole, RolePermissions> = {
  // 教师：本人负责记录可编辑；家校沟通类归档仅在 active 状态（代码门禁）
  teacher: {
    records: buildRecords({
      student: ['view', 'edit', 'inline_edit'],
      guardian: ['view', 'edit', 'inline_edit'],
      communication: ['view', 'edit', 'inline_edit', 'archive'],
      guardian_communication: ['view', 'edit', 'inline_edit', 'archive'],
      student_event: ['view', 'edit', 'archive'],
      class_event: ['view', 'edit', 'archive'],
    }, ['view']),
    pages: buildPages({
      student: ['view', 'create'],
      guardian: ['view', 'create'],
      communication: ['view', 'create'],
      student_event: ['view', 'create'],
      class_event: ['view', 'create'],
    }, ['view']),
  },
  // 心理专员：仅转介工作台（业务边界，代码强制仅 referral 生效）
  psychologist: {
    records: buildRecords({ referral: ['view', 'edit'] }, []),
    pages: buildPages({ referral: ['view'] }, []),
  },
  // 学校管理员：校内记录生命周期管理
  school_admin: {
    records: buildRecords({
      class: ['view', 'edit', 'archive', 'transfer', 'graduate', 'restore'],
      student: ['view', 'edit', 'archive', 'transfer', 'restore'],
      guardian: ['view', 'edit', 'archive', 'transfer', 'restore'],
      communication: ['view', 'edit', 'restore'],
      guardian_communication: ['view', 'edit', 'restore'],
      student_event: ['view', 'edit', 'restore'],
      class_event: ['view', 'edit', 'restore'],
      student_case: ['view', 'edit', 'restore'],
      department: ['view', 'edit', 'archive', 'restore'],
      user: ['view', 'edit', 'delete', 'disable'],
      school: ['view', 'edit', 'restore'],
      referral: ['view', 'transfer'],
      audit: ['view'],
      import: ['view'],
      plan_operation: ['view'],
      access_request: ['view'],
      assessment: ['view', 'edit', 'archive', 'delete', 'restore'],
      plan: ['view', 'edit', 'archive', 'delete', 'restore'],
      conversation: ['view', 'edit', 'archive', 'delete', 'restore'],
    }, ['view', 'edit']),
    pages: buildPages({
      audit: ['view'],
      import: ['view'],
      plan_operation: ['view'],
      access_request: ['view'],
    }, ['view', 'create']),
  },
  // 平台管理员：账号/学校管理 + 跨校记录只读旁路（代码门禁：非 school 目标类型仅 view）
  platform_admin: {
    records: buildRecords({
      user: ['view', 'edit', 'delete', 'disable'],
      school: ['view', 'edit', 'restore'],
      referral: ['view', 'transfer'],
      audit: ['view'],
      import: ['view'],
      plan_operation: ['view'],
      access_request: ['view'],
    }, ['view']),
    pages: buildPages({
      school: ['view', 'create'],
      user: ['view', 'create'],
    }, ['view']),
  },
}

/** 角色中文名（与 useDisplayLabels 的 ROLE_LABELS 一致，供迁移与 API 使用） */
export const ROLE_NAMES: Record<AppRole, string> = {
  teacher: '教师',
  psychologist: '心理专员',
  school_admin: '学校管理员',
  platform_admin: '平台管理员',
}

/** 补齐所有目标类型键（缺键按空数组），保证前端勾选清单与解析器行为稳定。 */
export function normalizeRolePermissions(perm: RolePermissions): RolePermissions {
  const records = {} as Record<string, Capability[]>
  const pages = {} as Record<string, Capability[]>
  for (const t of ALL_TARGET_TYPES) {
    records[t] = perm.records[t] ?? []
    pages[t] = perm.pages[t] ?? []
  }
  return { pages, records }
}

/** 权限清单概览计数（列表页展示）。 */
export function countRolePermissions(perm: RolePermissions): { recordCount: number, pageCount: number } {
  let recordCount = 0
  let pageCount = 0
  for (const list of Object.values(perm.records || {})) recordCount += list.length
  for (const list of Object.values(perm.pages || {})) pageCount += list.length
  return { recordCount, pageCount }
}
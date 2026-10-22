/**
 * 角色默认权限清单（与 capabilities.ts 现有硬编码逻辑等价）。
 *
 * 用途：
 * 1. 迁移 SQL 中四角色 INSERT 默认数据以本文件为准（两者需人工保持同步，
 *    新增 targetType / 能力时必须同时更新本文件与迁移 SQL）。
 * 2. Vitest 用本文件验证「数据驱动解析结果 = 原硬编码逻辑」，
 *    以及「默认清单只包含 shared/management.ts 能力白名单内的项」。
 * 3. 平台后台「角色权限配置」的「恢复系统默认」以本文件为基准。
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
import { MANAGED_TARGET_TYPES, normalizeRolePermissions } from '../../shared/management'

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

/**
 * 数据驾驶舱的四个页面目标类型（PRD 5.2 角色 × 看板模块矩阵）：
 * - 看板角色（校长 / 德育主任 / 年级主任）默认四个页面都勾选「查看」；
 * - 其他角色显式写空，避免吃到 buildRecords/buildPages 的兜底能力
 *   （回退路径里非看板角色即使被勾选也不会放行，见 capabilities.ts）。
 * 三个二级页可以按角色单独取消，取消后该页接口返回 403、导航不再出现。
 */
const NO_DASHBOARD_PAGES: Partial<Record<TargetType, Capability[]>> = {
  dashboard: [],
  dashboard_ai_questions: [],
  dashboard_plans: [],
  dashboard_alerts: [],
}
const DASHBOARD_PAGES: Partial<Record<TargetType, Capability[]>> = {
  dashboard: ['view'],
  dashboard_ai_questions: ['view'],
  dashboard_plans: ['view'],
  dashboard_alerts: ['view'],
}
/** 驾驶舱的四个页面级目标类型（列表页展示「可见看板页 N/4」） */


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
      // 数据驾驶舱只对看板角色开放：显式写空，避免吃到兜底能力
      ...NO_DASHBOARD_PAGES,
    }, ['view']),
    pages: buildPages({
      student: ['view', 'create'],
      guardian: ['view', 'create'],
      communication: ['view', 'create'],
      student_event: ['view', 'create'],
      class_event: ['view', 'create'],
      ...NO_DASHBOARD_PAGES,
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
      // 数据驾驶舱只对看板角色开放：显式写空，避免吃到兜底能力
      ...NO_DASHBOARD_PAGES,
    }, ['view', 'edit']),
    pages: buildPages({
      audit: ['view'],
      import: ['view', 'create'],
      plan_operation: ['view'],
      access_request: ['view'],
      ...NO_DASHBOARD_PAGES,
    }, ['view', 'create']),
  },
  // 学部校长（校长）：只读数据驾驶舱（聚合看板），不参与统一管理框架
  division_principal: {
    records: buildRecords({ ...DASHBOARD_PAGES }, []),
    pages: buildPages({ ...DASHBOARD_PAGES }, []),
  },
  // 德育主任：只读数据驾驶舱（一校一学部），数据口径为德育线（见 shared/dashboard.ts 的 DASHBOARD_MORAL_LINE）
  moral_education_director: {
    records: buildRecords({ ...DASHBOARD_PAGES }, []),
    pages: buildPages({ ...DASHBOARD_PAGES }, []),
  },
  // 年级主任：只读数据驾驶舱，范围按角色 scope.grades 收窄到所辖年级（可多选）
  grade_director: {
    records: buildRecords({ ...DASHBOARD_PAGES }, []),
    pages: buildPages({ ...DASHBOARD_PAGES }, []),
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
      // 平台管理员用平台后台，不看数据驾驶舱
      ...NO_DASHBOARD_PAGES,
    }, ['view']),
    pages: buildPages({
      school: ['view', 'create'],
      user: ['view', 'create'],
      ...NO_DASHBOARD_PAGES,
    }, ['view']),
  },
}

/** 角色中文名（与 useDisplayLabels 的 ROLE_LABELS 一致，供迁移与 API 使用） */
export const ROLE_NAMES: Record<AppRole, string> = {
  teacher: '教师',
  psychologist: '心理专员',
  school_admin: '学校管理员',
  division_principal: '学部校长',
  moral_education_director: '德育主任',
  grade_director: '年级主任',
  platform_admin: '平台管理员',
}

/**
 * 权限清单的纯函数工具集中在 shared/management.ts（前后端共用同一份实现）：
 * 归一化、白名单清洗、差异对比、等价判断与概览计数。这里只做再导出，
 * 让服务端调用方继续从 domain 引入，避免出现第二套口径。
 */
export {
  countRolePermissions,
  diffRolePermissions,
  effectiveRolePermissions,
  inheritedRolePermissions,
  rolePermissionsEqual,
  rolePermissionsMatchDefaults,
  sanitizeRolePermissions,
} from '../../shared/management'
export type {
  DroppedRolePermission,
  RolePermissionChange,
  RolePermissionCounts,
} from '../../shared/management'
// normalizeRolePermissions 同时被本文件的 defaultRolePermissionsOf 使用，单独导入后再导出
export { normalizeRolePermissions }

/** 角色的系统内置默认清单；目录里出现的新角色没有默认值时返回 null。 */
export function defaultRolePermissionsOf(code: string): RolePermissions | null {
  const defaults = DEFAULT_ROLE_PERMISSIONS[code as AppRole]
  return defaults ? normalizeRolePermissions(defaults) : null
}

// 统一管理框架：共享类型、契约和能力定义
// 跨越前后端的公共类型，不依赖服务端或前端具体实现

// ===== 管理目标类型（记录级能力按此分桶）=====
// 与 server/domain/capabilities.ts 的 ManagedTargetType 同源；
// roles 表 permissions.records 的键必须取自这里。
export const MANAGED_TARGET_TYPES = [
  'class',
  'student',
  'guardian',
  'communication',
  'guardian_communication',
  'student_event',
  'class_event',
  'student_case',
  'department',
  'user',
  'school',
  'referral',
  'audit',
  'import',
  'plan_operation',
  'access_request',
  'assessment',
  'plan',
  'conversation',
  // 数据驾驶舱：只读看板权限（只有「查看」一个能力，见 capabilities.ts 的只读域规则）。
  // dashboard 是入口与「数据总览」页，另外三个键对应二级看板页，
  // 平台后台「角色权限配置」可以按角色逐页取消可见性（PRD 5.2 角色 × 看板模块矩阵）。
  'dashboard',
  'dashboard_ai_questions',
  'dashboard_plans',
  'dashboard_alerts',
] as const
export type ManagedTargetType = typeof MANAGED_TARGET_TYPES[number]

// ===== 角色权限清单（roles 表 permissions jsonb）=====
// 结构：{ pages: { <targetType>: Capability[] }, records: { <targetType>: Capability[] } }
//   pages   —— 页面级能力（列表页顶部操作入口，如 create）
//   records —— 记录级能力（行级操作入口），仍受代码中的行级业务规则约束
//              （跨校隔离、负责人过滤、归档/移交/删除等状态门禁）。
// 键为 ManagedTargetType；缺键的目标类型回退到 capabilities.ts 硬编码逻辑。
export interface RolePermissions {
  pages: Record<string, Capability[]>
  records: Record<string, Capability[]>
}

// ===== 角色级范围（user_roles.scope jsonb）=====
// 一个账号可持有多个角色，每个角色可自带范围，决定该角色能看到多大组织范围的数据：
//   section —— 学部（primary/junior/senior/repeat，取值见 shared/school-section.ts）
//   grade   —— 年级（1-12）
// 当前阶段仅承载学部校长的所辖学部；德育主任/年级主任的范围字段在对应角色落地时补充。
export interface RoleScope {
  section?: string
  grade?: number
}

// ===== 能力（Capability）类型 =====
// 服务端返回的原子操作能力，前端根据这些能力渲染/隐藏按钮
export type Capability =
  | 'view'           // 查看基础信息
  | 'view_sensitive' // 查看敏感详情（需授权）
  | 'create'         // 创建
  | 'edit'           // 修改基础字段
  | 'inline_edit'    // 行内编辑（简单字段）
  | 'archive'        // 归档
  | 'restore'        // 恢复
  | 'transfer'       // 负责人移交
  | 'graduate'       // 班级毕业
  | 'delete'         // 仅限从未激活的邀请账号
  | 'disable'        // 停用账号

// ===== 目标类型分组（角色权限配置页的信息架构）=====
// 只影响展示顺序与分组标题，不参与鉴权；分组必须完整覆盖 MANAGED_TARGET_TYPES
// （tests/roles-permissions.test.ts 会校验覆盖率，漏掉的目标类型会直接报错）。
export interface TargetTypeGroup {
  id: string
  label: string
  /** 分组说明：一句话讲清这组目标类型在平台里对应哪些页面 */
  description: string
  targetTypes: ManagedTargetType[]
}

export const TARGET_TYPE_GROUPS: TargetTypeGroup[] = [
  {
    id: 'basic',
    label: '基础资料',
    description: '班级、学生、家长与部门档案',
    targetTypes: ['class', 'student', 'guardian', 'department']
  },
  {
    id: 'information',
    label: '信息中心',
    description: '家校沟通记录与学生 / 班级事件',
    targetTypes: ['communication', 'guardian_communication', 'student_event', 'class_event']
  },
  {
    id: 'case',
    label: '个案与关怀',
    description: '学生个案与心理转介工单',
    targetTypes: ['student_case', 'referral']
  },
  {
    id: 'plan',
    label: '评估与方案',
    description: '量表作答、方案、AI 对话记录与方案操作',
    targetTypes: ['assessment', 'plan', 'conversation', 'plan_operation']
  },
  {
    id: 'account',
    label: '账号与组织',
    description: '账号、学校设置与应急访问申请',
    targetTypes: ['user', 'school', 'access_request']
  },
  {
    id: 'platform',
    label: '平台运营',
    description: '数据导入与审计日志',
    targetTypes: ['import', 'audit']
  },
  {
    id: 'dashboard',
    label: '数据驾驶舱（只读）',
    description: '数据总览与三个二级看板页，只提供「查看」类能力',
    targetTypes: ['dashboard', 'dashboard_ai_questions', 'dashboard_plans', 'dashboard_alerts']
  }
]

// ===== 目标类型 × 能力白名单 =====
// 唯一事实来源：前端只渲染白名单内的可勾选项，服务端保存前按白名单清洗。
// 白名单之外的能力即使被写入数据库也不会生效（capabilities.ts 的运行时过滤），
// 因此在这里收敛，避免「勾了但没用」的假开关。
// 页面级能力只有 view / create；记录级能力按业务对象的真实生命周期给出。
export const TARGET_CAPABILITY_MATRIX: Record<ManagedTargetType, { pages: Capability[], records: Capability[] }> = {
  // 基础资料
  class: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'restore', 'transfer', 'graduate'] },
  student: { pages: ['view', 'create'], records: ['view', 'edit', 'inline_edit', 'archive', 'restore', 'transfer'] },
  guardian: { pages: ['view', 'create'], records: ['view', 'edit', 'inline_edit', 'archive', 'restore', 'transfer'] },
  department: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'restore'] },
  // 信息中心（家校沟通的归档只在 active 状态开放、恢复只在归档状态开放，状态门禁在代码里）
  communication: { pages: ['view', 'create'], records: ['view', 'edit', 'inline_edit', 'archive', 'restore'] },
  guardian_communication: { pages: ['view', 'create'], records: ['view', 'edit', 'inline_edit', 'archive', 'restore'] },
  student_event: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'restore'] },
  class_event: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'restore'] },
  // 个案与关怀（转介只有心理专员编辑、学校管理员移交）
  student_case: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'restore'] },
  referral: { pages: ['view', 'create'], records: ['view', 'edit', 'transfer'] },
  // 评估与方案（非归档可编辑 / 归档 / 删除，归档后可恢复）
  assessment: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'delete', 'restore'] },
  plan: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'delete', 'restore'] },
  conversation: { pages: ['view', 'create'], records: ['view', 'edit', 'archive', 'delete', 'restore'] },
  plan_operation: { pages: ['view'], records: ['view'] },
  // 账号与组织（删除仅限从未激活的邀请；停用排除已停用账号）
  user: { pages: ['view', 'create'], records: ['view', 'edit', 'delete', 'disable'] },
  school: { pages: ['view', 'create'], records: ['view', 'edit', 'restore'] },
  access_request: { pages: ['view'], records: ['view'] },
  // 平台运营：导入管理需要新建导入（CSV/xlsx 预检 + 提交），审计与运维只读
  import: { pages: ['view', 'create'], records: ['view'] },
  audit: { pages: ['view'], records: ['view'] },
  // 数据驾驶舱：只读看板；view_sensitive（个体明细）仅入口目标类型可按校开通
  dashboard: { pages: ['view'], records: ['view', 'view_sensitive'] },
  dashboard_ai_questions: { pages: ['view'], records: ['view'] },
  dashboard_plans: { pages: ['view'], records: ['view'] },
  dashboard_alerts: { pages: ['view'], records: ['view'] }
}

/** 某个目标类型下允许勾选的能力（白名单外的能力既展示不了、也不会生效）。 */
export function allowedCapabilities(targetType: string, group: 'pages' | 'records'): Capability[] {
  const entry = TARGET_CAPABILITY_MATRIX[targetType as ManagedTargetType]
  if (!entry) return []
  return entry[group]
}

/** 判断能力在目标类型下是否可用（前端置灰 / 服务端清洗共用）。 */
export function isCapabilityAllowedForTarget(targetType: string, group: 'pages' | 'records', capability: string): boolean {
  return allowedCapabilities(targetType, group).includes(capability as Capability)
}

/** 数据驾驶舱的四个页面级目标类型（由分组定义派生，避免多处重复维护）。 */
export const DASHBOARD_PAGE_TARGET_TYPES: ManagedTargetType[] =
  TARGET_TYPE_GROUPS.find(group => group.id === 'dashboard')?.targetTypes ?? []

// ===== 权限清单的工具函数（前后端共用同一份实现）=====
// 前端用它计算「未保存改动 / 不适用能力」，服务端用它做写入前清洗与审计差异，
// 两边口径完全一致；业务规则（跨校隔离、状态门禁）仍在 capabilities.ts 里。

/** 补齐所有目标类型键（缺键按空数组），保证前端勾选清单与解析器行为稳定。 */
export function normalizeRolePermissions(perm: RolePermissions): RolePermissions {
  const records: Record<string, Capability[]> = {}
  const pages: Record<string, Capability[]> = {}
  for (const targetType of MANAGED_TARGET_TYPES) {
    records[targetType] = [...(perm?.records?.[targetType] ?? [])]
    pages[targetType] = [...(perm?.pages?.[targetType] ?? [])]
  }
  return { pages, records }
}

/** 被清洗掉的权限项（未知目标类型，或该目标类型下不生效的能力）。 */
export interface DroppedRolePermission {
  group: 'pages' | 'records'
  targetType: string
  capability: string
}

/**
 * 权限清单清洗：按 TARGET_CAPABILITY_MATRIX 白名单丢弃未知目标类型与不适用能力，
 * 去重并按白名单顺序归一。白名单外的能力在运行时本来就不生效（capabilities.ts 的
 * 运行时过滤），写入前收敛可以避免库里留下「勾了但没用」的假开关。
 */
export function sanitizeRolePermissions(perm: RolePermissions): { permissions: RolePermissions, dropped: DroppedRolePermission[] } {
  const dropped: DroppedRolePermission[] = []
  const build = (group: 'pages' | 'records') => {
    const source = (perm?.[group] ?? {}) as Record<string, unknown>
    const out: Record<string, Capability[]> = {}
    for (const [targetType, value] of Object.entries(source)) {
      const list = Array.isArray(value) ? value as Capability[] : []
      const allowed = allowedCapabilities(targetType, group)
      if (!allowed.length) {
        // 未知目标类型：记录级与页面级都不可用，整条丢弃
        for (const capability of list) dropped.push({ group, targetType, capability })
        continue
      }
      for (const capability of list) {
        if (!allowed.includes(capability)) dropped.push({ group, targetType, capability })
      }
      out[targetType] = allowed.filter(capability => list.includes(capability))
    }
    return out
  }
  return {
    permissions: normalizeRolePermissions({ pages: build('pages'), records: build('records') }),
    dropped
  }
}

export interface RolePermissionChange {
  group: 'pages' | 'records'
  targetType: string
  added: Capability[]
  removed: Capability[]
}

/** 权限清单差异（审计留痕与「改了哪几项」提示共用）。 */
export function diffRolePermissions(before: RolePermissions, after: RolePermissions): RolePermissionChange[] {
  const changes: RolePermissionChange[] = []
  for (const group of ['pages', 'records'] as const) {
    const targetTypes = new Set([...Object.keys(before?.[group] ?? {}), ...Object.keys(after?.[group] ?? {})])
    for (const targetType of targetTypes) {
      const previous = before?.[group]?.[targetType] ?? []
      const next = after?.[group]?.[targetType] ?? []
      const added = next.filter(capability => !previous.includes(capability))
      const removed = previous.filter(capability => !next.includes(capability))
      if (added.length || removed.length) changes.push({ group, targetType, added, removed })
    }
  }
  return changes.sort((a, b) => a.group.localeCompare(b.group) || a.targetType.localeCompare(b.targetType))
}

/** 两份权限清单是否等价（忽略键顺序与未归一化的空值）。 */
export function rolePermissionsEqual(a: RolePermissions, b: RolePermissions): boolean {
  return diffRolePermissions(normalizeRolePermissions(a), normalizeRolePermissions(b)).length === 0
}

/**
 * 是否与系统默认清单一致（按生效值比较，忽略键顺序）。
 *
 * 缺键在运行时按代码硬编码回退（与默认值等价），所以不能把「缺键」当成「已清空」。
 */
export function rolePermissionsMatchDefaults(stored: RolePermissions, defaults: RolePermissions): boolean {
  return rolePermissionsEqual(effectiveRolePermissions(stored, defaults), defaults)
}

/**
 * 生效权限清单：把「库里没有写的目标类型」按系统默认补齐。
 *
 * 缺键在运行时回退到代码里的硬编码默认（`server/domain/capabilities.ts`，与
 * `server/domain/roles.ts` 的默认清单等价），因此编辑器必须按生效值展示，
 * 否则会出现「页面显示未勾选、实际生效」的错位；更危险的是保存一次就会把缺键
 * 写成显式空数组，静默关掉回退逻辑，让该目标类型真的失去能力。
 *
 * 默认清单缺失（目录表里出现的新角色）时按空数组补齐，与旧行为一致。
 */
export function effectiveRolePermissions(stored: RolePermissions, defaults: RolePermissions | null): RolePermissions {
  const records: Record<string, Capability[]> = {}
  const pages: Record<string, Capability[]> = {}
  for (const targetType of MANAGED_TARGET_TYPES) {
    records[targetType] = [...(stored?.records?.[targetType] ?? defaults?.records?.[targetType] ?? [])]
    pages[targetType] = [...(stored?.pages?.[targetType] ?? defaults?.pages?.[targetType] ?? [])]
  }
  return { pages, records }
}

/** 库里没有显式配置、当前按系统默认生效的目标类型（编辑器标注「继承默认」用）。 */
export function inheritedRolePermissions(stored: RolePermissions): Array<{ group: 'pages' | 'records', targetType: string }> {
  const inherited: Array<{ group: 'pages' | 'records', targetType: string }> = []
  for (const group of ['pages', 'records'] as const) {
    for (const targetType of MANAGED_TARGET_TYPES) {
      if (stored?.[group]?.[targetType] === undefined) inherited.push({ group, targetType })
    }
  }
  return inherited
}

export interface RolePermissionCounts {
  /** 记录级已勾选能力总数 */
  recordCount: number
  /** 页面级已勾选能力总数 */
  pageCount: number
  /** 至少配置了一项能力的目标类型数量 */
  targetTypeCount: number
  /** 数据驾驶舱可见页面数（入口 + 三个二级页，最多 4） */
  dashboardPageCount: number
}

/** 权限清单概览计数（角色列表与详情页展示）。 */
export function countRolePermissions(perm: RolePermissions): RolePermissionCounts {
  const dashboardTypes = new Set<string>(DASHBOARD_PAGE_TARGET_TYPES)
  let recordCount = 0
  let pageCount = 0
  let targetTypeCount = 0
  let dashboardPageCount = 0
  for (const targetType of MANAGED_TARGET_TYPES) {
    const records = perm?.records?.[targetType] ?? []
    const pages = perm?.pages?.[targetType] ?? []
    recordCount += records.length
    pageCount += pages.length
    if (records.length || pages.length) targetTypeCount += 1
    if (dashboardTypes.has(targetType) && pages.includes('view')) dashboardPageCount += 1
  }
  return { recordCount, pageCount, targetTypeCount, dashboardPageCount }
}

export interface ManagedColumn {
  key: string
  label: string
  sortable?: boolean
  /** 移动端低优先级列会隐藏，完整内容仍可在详情抽屉查看。 */
  mobileHidden?: boolean
  class?: string
}

export interface ManagedRow {
  id: string
  _capabilities: Capability[]
  [key: string]: unknown
}

/**
 * 管理列表行的最小约束。页面直接用自己的行类型做泛型参数，
 * 不必为了满足 ManagedRow 的索引签名而放弃字段类型。
 */
export interface ManagedRowBase {
  id: string
  _capabilities?: Capability[]
}

// ===== 标准列表查询 =====
export interface ManagedListQuery {
  page: number        // 1-based
  pageSize: 20 | 50 | 100
  q?: string          // 搜索关键词
  status?: string     // 状态筛选，'all' 表示全部
  sort: string        // 排序字段
  order: 'asc' | 'desc'
}

// ===== 标准列表响应 =====
export interface ManagedListResult<T> {
  rows: Array<T & { _capabilities: Capability[] }>
  page: number
  pageSize: number
  total: number
  capabilities: Capability[]  // 页面级能力（create, bulk_archive 等）
}

// ===== 修改与并发控制 =====
export interface ManagedPatch<T> {
  patch: T
  expectedUpdatedAt: string  // ISO 8601 datetime
}

// ===== 生命周期操作 =====
export type LifecycleAction = 'archive' | 'restore' | 'transfer' | 'graduate' | 'transfer_and_disable'

export interface LifecycleCommand {
  action: LifecycleAction
  reason: string          // 操作事由，10-500 字符
  toUserId?: string       // 移交目标用户 ID
  newPsychologistId?: string  // 心理转介新专员 ID
}

// ===== 排序白名单工具 =====
// 用于服务端构建排序白名单，防止 SQL 注入
export function createSortWhitelist<T extends string>(...fields: T[]): ReadonlySet<T> {
  return new Set(fields)
}

export function validateSort(sort: string, whitelist: ReadonlySet<string>, defaultSort: string): string {
  return whitelist.has(sort) ? sort : defaultSort
}

// ===== 编辑冲突错误码 =====
export const ERROR_CODES = {
  EDIT_CONFLICT: 'EDIT_CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  DELEGATION_EXPIRED: 'DELEGATION_EXPIRED',
  CROSS_SCHOOL: 'CROSS_SCHOOL',
  BUSINESS_REFERENCE: 'BUSINESS_REFERENCE',
  SENSITIVE_REQUIRES_GRANT: 'SENSITIVE_REQUIRES_GRANT',
} as const

// ===== 数据脱敏标记 =====
export const SENSITIVE_PLACEHOLDER = '***' as const
export const PHONE_MASKED_PREFIX = '1' as const  // 手机号脱敏：只保留首尾

// ===== 默认分页配置 =====
export const DEFAULT_PAGE_SIZE = 20
export const ALLOWED_PAGE_SIZES = [20, 50, 100] as const
export const MAX_PAGE_SIZE = 100
export const SEARCH_DEBOUNCE_MS = 300
export const MAX_BULK_OPERATION = 100

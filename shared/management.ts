// 统一管理框架：共享类型、契约和能力定义
// 跨越前后端的公共类型，不依赖服务端或前端具体实现

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

// 学校管理员的平台使用量看板契约（PRD 8.3 的 S1 / S2 / S4）。
//
// 角色定位：2026-10-08 起原「学校系统管理员」已并入学校管理员，本条链路只服务账号开通与权限维护，
// 可见范围仅限平台系统层面的运营数据（账号开通量、角色分布、使用量趋势、操作审计日志），
// 本看板自身不展示任何业务数据（评估、方案、对话、学生、家长、转介等）。
//
// S2 口径（2026-10-09 起）：「访问量 / 人均使用时长」由前端活跃心跳埋点支撑——
// 客户端每 USAGE_HEARTBEAT_INTERVAL_SECONDS 秒上报一次（仅页面可见时），
// 服务端按 (用户, 会话) 落 product_events 的 platform_active_beat；
// 访问人次 = 同一 (用户, 会话) 的心跳按空闲超过 USAGE_VISIT_IDLE_MINUTES 分钟切段后的段数，
// 人均使用时长 = 当日个人时长（心跳数 × 上报间隔，单人单日封顶 24 小时）÷ 当日去重账号数。
// 心跳只含时间与会话标识，不含任何业务内容。
// 心跳上线前没有真实访问人次与时长：趋势里另给「按产品事件估算的访问人次」补位，
// 口径与心跳不同（按账号 30 分钟空闲切段），仅用于观察历史趋势，不并入总访问人次。
import type { Capability, ManagedListResult } from './management'

/** 使用量看板的默认与最长统计天数（自然日，东八区）。 */
export const USAGE_DEFAULT_DAYS = 30
export const USAGE_MAX_DAYS = 90

/** 活跃心跳上报间隔（秒）：客户端按此间隔上报，服务端聚合按「心跳数 × 间隔」折算时长。 */
export const USAGE_HEARTBEAT_INTERVAL_SECONDS = 300

/** 访问切分空闲阈值（分钟）：同一 (用户, 会话) 相邻心跳超过该间隔即视为一次新的访问。 */
export const USAGE_VISIT_IDLE_MINUTES = 30

export interface UsageOverview {
  /** 开通账号数（未删除的全部账号，含待激活） */
  accounts: number
  /** 已激活账号数（status = active） */
  activated: number
  /** 待激活邀请账号数 */
  invited: number
  /** 已停用账号数 */
  disabled: number
  /** 周期内活跃账号数（最近登录时间落在统计区间内） */
  activeInPeriod: number
  /** 周期内去重活跃账号数（按产品事件统计的日活并集） */
  activeByEvents: number
  /** 周期内教师提问数 */
  aiQuestions: number
  /** 周期内新建方案数 */
  plans: number
  /** 周期内访问人次（活跃心跳按空闲切段；同一账号多次进出算多次） */
  visitsInPeriod: number
  /** 周期内人均使用时长（分钟；按当日去重账号数平均，无心跳时 null） */
  avgDurationMinutes: number | null
  /** 角色分布（按 user_roles 统计；一人多角色会计入多个角色） */
  roleDistribution: Array<{ roleCode: string, roleLabel: string, count: number }>
}

export interface UsageTrendPoint {
  date: string
  /** 当天有产品事件的去重账号数（活跃度代理指标） */
  activeUsers: number
  /** 当天教师提问数 */
  aiQuestions: number
  /** 当天访问人次（活跃心跳按空闲切段） */
  visits: number
  /**
   * 当天按产品事件（提问 / 量表 / 方案等，不含心跳）估算的访问人次。
   * 仅用于心跳上线前的趋势补位：口径与心跳不同，按账号 30 分钟空闲切段，数值偏保守。
   */
  estimatedVisits: number
  /** 当天人均使用时长（分钟；心跳未积累时 null） */
  avgDurationMinutes: number | null
}

export interface UsageAuditRow {
  id: string
  actorId: string | null
  actorName: string | null
  actorRoleLabel: string | null
  action: string
  targetType: string | null
  targetId: string | null
  result: string
  ipAddress: string | null
  createdAt: string
  /** 只读列表：行级能力恒为空数组（不参与统一管理框架） */
  _capabilities: Capability[]
}

export interface SchoolUsageResponse {
  period: { start: string, end: string }
  overview: UsageOverview
  trend: UsageTrendPoint[]
  audits: ManagedListResult<UsageAuditRow>
}

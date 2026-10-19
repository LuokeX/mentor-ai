/**
 * 数据驾驶舱 · 预警看板。
 *
 * 合并两类记录：安全事项（对话助手 / 量表提交命中安全规则）与学生事件（E1–E6）。
 * 学生列只返回「学生 A/B/C」脱敏标号（周期内稳定），不返回姓名；
 * 默认只看待解决（status=open）与高风险明细（riskLevel=high，含安全关注 / 严重），
 * 周期默认近 7 天、最长 1 年；status 与 riskLevel 都只作用于明细表。
 */
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import {
  ALERT_DEFAULT_RISK_LEVEL,
  ALERT_RISK_LEVEL_FILTERS,
  DASHBOARD_DEFAULT_DAYS,
  DASHBOARD_PERIOD_LIMITS
} from '../../../../shared/dashboard'
import {
  loadAlerts,
  parseAlertSourceParam,
  parseClassIdParam,
  resolveDashboardRange,
  type AlertFilters,
  type DashboardTableQuery
} from '../../../domain/dashboard-metrics'
import { requireDashboardScope, resolveDashboardSensitiveAccess } from '../../../domain/dashboard-scope'
import { trackDashboardView } from '../../../domain/dashboard-tracking'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  classIds: z.string().trim().max(4000).optional(),
  status: z.enum(['open', 'resolved', 'closed', 'all']).default('open'),
  sources: z.string().trim().max(200).optional(),
  /** 明细表风险档位：默认只看高风险（含安全关注 / 严重），与页面默认一致。 */
  riskLevel: z.enum(ALERT_RISK_LEVEL_FILTERS).default(ALERT_DEFAULT_RISK_LEVEL),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const scope = await requireDashboardScope(event, user, 'dashboard_alerts')
  const range = resolveDashboardRange(query, {
    defaultDays: DASHBOARD_DEFAULT_DAYS.alerts,
    maxDays: DASHBOARD_PERIOD_LIMITS.alerts
  })
  const filters: AlertFilters = {
    grade: query.grade,
    classIds: parseClassIdParam(query.classIds),
    status: query.status,
    sources: parseAlertSourceParam(query.sources),
    riskLevel: query.riskLevel
  }
  const table: DashboardTableQuery = { page: query.page, pageSize: query.pageSize, sort: query.sort ?? 'occurredAt', order: query.order }
  await trackDashboardView(event, {
    user,
    page: 'dashboard_alerts',
    rangeDays: range.days,
    line: scope.line,
    grade: filters.grade ?? null,
    classFilterCount: filters.classIds?.length ?? 0
  })
  // 具备个体明细查看能力时才下发学生 ID（供「查看个体」申请 15 分钟授权）
  const includeStudentId = await resolveDashboardSensitiveAccess(event, user)
  return loadAlerts(useDb(event), scope, range, filters, table, { includeStudentId })
})

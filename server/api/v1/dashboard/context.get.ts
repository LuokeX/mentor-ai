/**
 * 数据驾驶舱上下文：当前账号的看板范围（本校全部班级，或账号显式配置的学部）、
 * 年级分布、班级清单与班级数，以及本次可访问的看板页与数据口径。
 *
 * 看板页面用它渲染「数据范围」、年级/班级筛选与页内导航；导航只显示 pages 里的页面，
 * 三个二级页被平台后台逐页取消后不会出现（对应页接口同步返回 403）。
 * 账号未关联学校时返回 400；一页都不允许时返回 403。
 */
import type { DashboardContext } from '../../../../shared/dashboard'
import { DASHBOARD_LINE_LABELS } from '../../../../shared/dashboard'
import {
  requireDashboardEntry,
  requireDashboardScope,
  resolveDashboardSensitiveAccess
} from '../../../domain/dashboard-scope'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event): Promise<DashboardContext> => {
  const user = await requireUser(event)
  const pages = await requireDashboardEntry(event, user)
  // 入口校验放行的第一个可见页就是本次的统计范围来源（范围与口径按激活角色解析，与页面无关）
  const scope = await requireDashboardScope(event, user, pages[0]!)
  const canViewIndividual = await resolveDashboardSensitiveAccess(event, user)
  return {
    managedSection: scope.section,
    sectionLabel: scope.sectionLabel,
    grades: scope.grades,
    classCount: scope.classes.length,
    classes: scope.classes.map(item => ({
      id: item.id,
      name: item.name,
      grade: item.grade,
      gradeLabel: item.gradeLabel
    })),
    pages,
    line: scope.line,
    lineLabel: DASHBOARD_LINE_LABELS[scope.line],
    canViewIndividual
  }
})

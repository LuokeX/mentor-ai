/**
 * 数据驾驶舱的留痕与告警（PRD 第 4.2 条原则 5 与第 11 章）。
 *
 * 口径：
 * - 查看类行为写审计 `dashboard.view`（每次访问一条，含页码、区间、筛选与口径），
 *   同时保留低敏产品事件 `dashboard_view` 供聚合统计；
 * - 拒绝类行为（越权访问尝试）写审计 `dashboard.access_denied`，命中「跨租户目标」或
 *   「同一账号短时间多次被拒」时，额外写通知给本校学校管理员与平台管理员（去重）；
 * - 敏感动作（导出、个体明细）仍按原口径写审计与管理员访问事件，见 export.get.ts 与
 *   dashboard/individual/[targetType]/[targetId].get.ts。
 * metadata 只放页码、区间天数、年级/班级筛选与口径，不记录提问原文、姓名等业务正文。
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser } from '../../app/composables/useAuth'
import type { DashboardLine, DashboardPageKey } from '../../shared/dashboard'
import { schema, useDb } from '../utils/db'
import { writeAudit } from '../utils/audit'
import { userHasRole } from './user-roles'
import { trackProductEvent } from './product-events'

/** 重复越权判定窗口（分钟）与阈值：窗口内第 N 次被拒时通知管理员。 */
export const DASHBOARD_DENIED_WINDOW_MINUTES = 10
export const DASHBOARD_DENIED_NOTIFY_THRESHOLD = 3

export async function trackDashboardView(event: H3Event, input: {
  user: AuthUser
  page: DashboardPageKey
  rangeDays: number
  line: DashboardLine
  grade?: number | null
  classFilterCount?: number
}): Promise<void> {
  const metadata = {
    page: input.page,
    rangeDays: input.rangeDays,
    line: input.line,
    grade: input.grade ?? null,
    classFilterCount: input.classFilterCount ?? 0
  }
  // 查看行为 100% 入审计（PRD 4.2 原则 5）
  await writeAudit(event, {
    schoolId: input.user.schoolId,
    actorId: input.user.id,
    action: 'dashboard.view',
    targetType: input.page,
    metadata
  })
  // 产品事件保留：低敏、可聚合，供运营统计口径使用
  await trackProductEvent(event, {
    schoolId: input.user.schoolId,
    userId: input.user.id,
    eventName: 'dashboard_view',
    targetType: input.page,
    metadata
  })
}

export interface DashboardDeniedInput {
  /** 拒绝原因码：page_forbidden / entry_forbidden / no_individual_permission / out_of_scope_or_missing */
  reason: string
  page?: DashboardPageKey | null
  targetType?: string | null
  targetId?: string | null
  /** 是否跨租户目标（他校数据）：跨租户一律立即通知管理员 */
  crossSchool?: boolean
}

/**
 * 越权访问尝试的强制拦截留痕（PRD 4.4 红线：越权访问尝试系统强制拦截并告警）。
 * 任何异常都不向上抛：留痕失败不能把 403/404 变成 500。
 */
export async function recordDashboardAccessDenied(
  event: H3Event,
  user: AuthUser,
  input: DashboardDeniedInput
): Promise<void> {
  try {
    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'dashboard.access_denied',
      targetType: input.targetType ?? input.page ?? 'dashboard',
      result: 'denied',
      metadata: {
        reason: input.reason,
        page: input.page ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        crossSchool: Boolean(input.crossSchool)
      }
    })
    await notifyDashboardDenied(event, user, input)
  } catch {
    // 留痕失败不影响拦截结果
  }
}

/**
 * 告警：跨租户目标立即通知；同账号窗口内重复被拒达到阈值时通知。
 * 通知对象为本校学校管理员与平台管理员，按「操作者 + 原因 + 日期」去重（每人每天一条）。
 */
async function notifyDashboardDenied(event: H3Event, user: AuthUser, input: DashboardDeniedInput): Promise<void> {
  const db = useDb(event)
  const since = new Date(Date.now() - DASHBOARD_DENIED_WINDOW_MINUTES * 60_000)
  const [row] = (await db.execute(sql`
    select count(*)::int as value
    from audit_logs
    where action = 'dashboard.access_denied' and actor_id = ${user.id} and created_at >= ${since}
  `)).rows as Array<{ value: number }>
  const repeated = (row?.value ?? 0) >= DASHBOARD_DENIED_NOTIFY_THRESHOLD
  if (!input.crossSchool && !repeated) return
  const schoolId = user.schoolId
  if (!schoolId) return

  const recipients = [
    ...await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.schoolId, schoolId), userHasRole(db, 'school_admin'))),
    ...await db.select({ id: schema.users.id }).from(schema.users)
      .where(userHasRole(db, 'platform_admin'))
  ]
  if (!recipients.length) return

  const dayKey = new Date().toISOString().slice(0, 10)
  const title = input.crossSchool ? '数据驾驶舱越权访问告警' : '数据驾驶舱重复越权访问告警'
  const body = input.crossSchool
    ? `${user.name}（${user.roleLabel}）尝试查看其他学校的数据，已被系统拦截。`
    : `${user.name}（${user.roleLabel}）在 ${DASHBOARD_DENIED_WINDOW_MINUTES} 分钟内多次尝试查看看板范围外的数据，已被系统拦截。`
  for (const recipient of recipients) {
    await db.insert(schema.notifications).values({
      schoolId,
      userId: recipient.id,
      type: 'dashboard_access_denied',
      title,
      body,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      deduplicationKey: `dashboard-denied:${user.id}:${input.reason}:${recipient.id}:${dayKey}`
    }).onConflictDoNothing()
  }
}

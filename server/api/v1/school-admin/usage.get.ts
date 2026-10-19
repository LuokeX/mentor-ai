/**
 * 学校管理员 · 平台使用量看板（PRD 8.3 的 S1 / S2 / S4）。
 *
 * 2026-10-08 起原「学校系统管理员」（system_admin）已并入学校管理员（school_admin），
 * 使用量看板随之下放给学校管理员，能力口径不变：
 * 只返回平台系统层面的运营数据：账号开通量、角色分布、使用量趋势与操作审计日志；
 * 不返回任何业务数据（评估、方案、对话、学生、家长、转介等）。
 * 统计区间默认近 30 天、最长 90 天（东八区自然日）；S3（账号与权限管理）按 PRD
 * 标注「商业化后做 V1 不做」，此处不实现。
 * S2 口径：访问人次与人均使用时长来自活跃心跳埋点（`platform_active_beat`，见
 * server/domain/platform-usage.ts）；「活跃账号数 / 提问数」保留为业务动作口径，
 * 其中活跃账号数按产品事件去重但排除心跳事件，避免与访问人次重复计同一件事。
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import {
  USAGE_DEFAULT_DAYS,
  USAGE_MAX_DAYS,
  type SchoolUsageResponse,
  type UsageAuditRow,
  type UsageOverview,
  type UsageTrendPoint
} from '../../../../shared/school-usage'
import { addDays, daysBetween, enumerateDateKeys, parseDateKey, shanghaiDateKey, shanghaiDayEnd, shanghaiDayStart } from '../../../../shared/dashboard'
import { ROLE_LABELS } from '../../../utils/role-labels'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'
import { trackProductEvent } from '../../../domain/product-events'
import { USAGE_HEARTBEAT_EVENT, averageMinutesPerUser, loadEstimatedVisits, loadUsageActivity } from '../../../domain/platform-usage'

const querySchema = z.object({
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE)
})

async function rowsOf<T>(query: Promise<{ rows: unknown[] }>): Promise<T[]> {
  const result = await query
  return result.rows as T[]
}

export default defineEventHandler(async (event): Promise<SchoolUsageResponse> => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '账号未关联学校' })
  const query = querySchema.parse(getQuery(event))

  const todayKey = shanghaiDateKey(new Date())
  const endKey = query.end ? parseDateKey(query.end) : todayKey
  if (!endKey) throw createError({ statusCode: 400, message: '统计结束日期格式不正确（应为 YYYY-MM-DD）' })
  const startKey = query.start ? parseDateKey(query.start) : addDays(endKey, -(USAGE_DEFAULT_DAYS - 1))
  if (!startKey) throw createError({ statusCode: 400, message: '统计开始日期格式不正确（应为 YYYY-MM-DD）' })
  if (startKey > endKey) throw createError({ statusCode: 400, message: '统计开始日期不能晚于结束日期' })
  const days = daysBetween(startKey, endKey)
  if (days > USAGE_MAX_DAYS) throw createError({ statusCode: 400, message: `统计区间最长 ${USAGE_MAX_DAYS} 天，请缩小范围后重试` })
  const start = shanghaiDayStart(startKey)
  const end = shanghaiDayEnd(endKey)
  const schoolId = user.schoolId
  const db = useDb(event)

  const [accountRows, roleRows, trendRows, planRows, auditRows, auditTotalRows, activeUsersRow, loginActiveRow, activity, estimatedActivity] = await Promise.all([
    rowsOf<{ status: string, value: number }>(db.execute(sql`
      select status, count(*)::int as value
      from users
      where school_id = ${schoolId}
      group by 1
    `)),
    rowsOf<{ role_code: string, value: number }>(db.execute(sql`
      select ur.role_code as role_code, count(distinct ur.user_id)::int as value
      from user_roles ur
      join users u on u.id = ur.user_id
      where u.school_id = ${schoolId}
      group by 1 order by 2 desc, 1 asc
    `)),
    rowsOf<{ day: string, active_users: number, ai_questions: number }>(db.execute(sql`
      select day, sum(active_users)::int as active_users, sum(ai_questions)::int as ai_questions
      from (
        select to_char((pe.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
               count(distinct pe.user_id)::int as active_users, 0 as ai_questions
        from product_events pe
        where pe.school_id = ${schoolId} and pe.user_id is not null
          and pe.event_name <> ${USAGE_HEARTBEAT_EVENT}
          and pe.created_at >= ${start} and pe.created_at <= ${end}
        group by 1
        union all
        select to_char((cm.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
               0 as active_users, count(*)::int as ai_questions
        from chat_messages cm
        where cm.school_id = ${schoolId} and cm.role = 'user' and cm.deleted_at is null
          and cm.created_at >= ${start} and cm.created_at <= ${end}
        group by 1
      ) merged
      group by 1 order by 1
    `)),
    rowsOf<{ value: number }>(db.execute(sql`
      select count(*)::int as value from plans
      where school_id = ${schoolId} and created_at >= ${start} and created_at <= ${end}
    `)),
    rowsOf<{
      id: string
      actor_id: string | null
      actor_name: string | null
      actor_role: string | null
      action: string
      target_type: string | null
      target_id: string | null
      result: string
      ip_address: string | null
      created_at: Date
    }>(db.execute(sql`
      select al.id, al.actor_id, u.name as actor_name, u.role as actor_role,
             al.action, al.target_type, al.target_id, al.result, al.ip_address, al.created_at
      from audit_logs al
      left join users u on u.id = al.actor_id
      where al.school_id = ${schoolId}
        and al.created_at >= ${start} and al.created_at <= ${end}
        ${query.q
          ? sql` and (al.action ilike ${`%${query.q}%`} or u.name ilike ${`%${query.q}%`})`
          : sql``}
      order by al.created_at desc
      limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
    `)),
    rowsOf<{ value: number }>(db.execute(sql`
      select count(*)::int as value
      from audit_logs al
      left join users u on u.id = al.actor_id
      where al.school_id = ${schoolId}
        and al.created_at >= ${start} and al.created_at <= ${end}
        ${query.q
          ? sql` and (al.action ilike ${`%${query.q}%`} or u.name ilike ${`%${query.q}%`})`
          : sql``}
    `)),
    // 周期内去重活跃账号数（产品事件口径，排除心跳事件，只算业务动作）
    rowsOf<{ value: number }>(db.execute(sql`
      select count(distinct pe.user_id)::int as value
      from product_events pe
      where pe.school_id = ${schoolId} and pe.user_id is not null
        and pe.event_name <> ${USAGE_HEARTBEAT_EVENT}
        and pe.created_at >= ${start} and pe.created_at <= ${end}
    `)),
    // 最近登录时间落在区间内的账号数（登录口径）
    rowsOf<{ value: number }>(db.execute(sql`
      select count(*)::int as value from users
      where school_id = ${schoolId} and last_login_at is not null
        and last_login_at >= ${start} and last_login_at <= ${end}
    `)),
    // S2：活跃心跳（访问人次 + 使用时长），口径见 server/domain/platform-usage.ts
    loadUsageActivity(db, { schoolId, startKey, endKey, start, end }),
    // 心跳上线前的访问人次补位：产品事件按账号 30 分钟空闲切段（仅趋势参考）
    loadEstimatedVisits(db, { schoolId, startKey, endKey, start, end })
  ])

  const statusCount = (status: string) => accountRows.find(row => row.status === status)?.value ?? 0
  const accounts = accountRows.reduce((sum, row) => sum + row.value, 0)
  const activated = statusCount('active')
  const invited = statusCount('invited')
  const disabled = statusCount('disabled')

  const dateKeys = enumerateDateKeys(startKey, endKey)
  const trendMap = new Map(trendRows.map(row => [row.day, row]))
  const activityMap = new Map(activity.days.map(day => [day.date, day]))
  const estimatedMap = new Map(estimatedActivity.map(day => [day.date, day.visits]))
  const trend: UsageTrendPoint[] = dateKeys.map(date => {
    const dayActivity = activityMap.get(date)
    return {
      date,
      activeUsers: trendMap.get(date)?.active_users ?? 0,
      aiQuestions: trendMap.get(date)?.ai_questions ?? 0,
      visits: dayActivity?.visits ?? 0,
      estimatedVisits: estimatedMap.get(date) ?? 0,
      avgDurationMinutes: dayActivity ? averageMinutesPerUser(dayActivity.minutes, dayActivity.users) : null
    }
  })

  const overview: UsageOverview = {
    accounts,
    activated,
    invited,
    disabled,
    activeInPeriod: loginActiveRow[0]?.value ?? 0,
    activeByEvents: activeUsersRow[0]?.value ?? 0,
    aiQuestions: trend.reduce((sum, point) => sum + point.aiQuestions, 0),
    plans: planRows[0]?.value ?? 0,
    visitsInPeriod: activity.totals.visits,
    avgDurationMinutes: averageMinutesPerUser(activity.totals.minutes, activity.totals.users),
    roleDistribution: roleRows.map(row => ({
      roleCode: row.role_code,
      roleLabel: ROLE_LABELS[row.role_code as keyof typeof ROLE_LABELS] ?? row.role_code,
      count: row.value
    }))
  }

  const audits: UsageAuditRow[] = auditRows.map(row => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRoleLabel: row.actor_role ? ROLE_LABELS[row.actor_role as keyof typeof ROLE_LABELS] ?? row.actor_role : null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    ipAddress: row.ip_address,
    createdAt: new Date(row.created_at).toISOString(),
    // 只读列表：行级能力恒为空（不参与统一管理框架）
    _capabilities: []
  }))

  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'school_usage_view',
    metadata: { rangeDays: days, q: query.q ?? null, page: query.page }
  })

  return {
    period: { start: startKey, end: endKey },
    overview,
    trend,
    audits: {
      rows: audits,
      page: query.page,
      pageSize: query.pageSize,
      total: auditTotalRows[0]?.value ?? 0,
      capabilities: []
    }
  }
})

/**
 * 平台使用量（PRD 8.3 S2）的活跃心跳口径与聚合。
 *
 * 数据源：`product_events` 的 `platform_active_beat`（客户端每 5 分钟上报一次，服务端按会话节流）。
 * 口径：
 * - 访问人次：同一 (用户, 会话) 的相邻心跳间隔超过 USAGE_VISIT_IDLE_MINUTES 分钟即切分为一次新访问，
 *   段数（跨会话求和）即为当天的访问人次；
 * - 使用时长：心跳点数 × 上报间隔，单人单日封顶 USAGE_MAX_MINUTES_PER_USER_DAY（防御脏数据）；
 *   人均使用时长 = 当天总时长 ÷ 当天去重账号数。
 *
 * 只有聚合值会进入接口响应（`shared/school-usage.ts`），明细不出学校。
 */
import { sql } from 'drizzle-orm'
import { USAGE_HEARTBEAT_INTERVAL_SECONDS, USAGE_VISIT_IDLE_MINUTES } from '../../shared/school-usage'
import { enumerateDateKeys } from '../../shared/dashboard'
import type { DbClient } from '../utils/db'

/** 心跳事件名：客户端上报与服务端聚合共用同一常量。 */
export const USAGE_HEARTBEAT_EVENT = 'platform_active_beat'

/** 单人单日使用时长上限（分钟），防止异常心跳（如脚本刷）把时长算爆。 */
export const USAGE_MAX_MINUTES_PER_USER_DAY = 24 * 60

/** 每个 (自然日, 账号) 的访问段数与心跳点数（SQL 聚合后的中间结果）。 */
export interface UsageBeatBucket {
  day: string
  userId: string
  visits: number
  beats: number
}

export interface UsageActivityDay {
  date: string
  /** 当天访问人次 */
  visits: number
  /** 当天有心跳的去重账号数 */
  users: number
  /** 当天累计使用时长（分钟，已按账号封顶） */
  minutes: number
}

export interface UsageActivity {
  /** 按 dateKeys 补零后的每日活动 */
  days: UsageActivityDay[]
  /** 区间合计：访问人次、去重账号数、累计使用时长（分钟） */
  totals: { visits: number, users: number, minutes: number }
}

async function rowsOf<T>(query: Promise<{ rows: unknown[] }>): Promise<T[]> {
  const result = await query
  return result.rows as T[]
}

/**
 * 纯计算：把每个 (日, 账号) 的桶折算成每日活动（含封顶），并按 dateKeys 补零。
 * 单测覆盖封顶与去重聚合，SQL 只负责分组与切段。
 */
export function summarizeUsageActivity(
  buckets: readonly UsageBeatBucket[],
  dateKeys: readonly string[],
  intervalMinutes: number = USAGE_HEARTBEAT_INTERVAL_SECONDS / 60
): UsageActivityDay[] {
  const byDay = new Map<string, { visits: number, users: number, minutes: number }>()
  for (const bucket of buckets) {
    const entry = byDay.get(bucket.day) ?? { visits: 0, users: 0, minutes: 0 }
    entry.visits += Math.max(0, bucket.visits)
    entry.users += 1
    entry.minutes += Math.min(Math.max(0, bucket.beats) * intervalMinutes, USAGE_MAX_MINUTES_PER_USER_DAY)
    byDay.set(bucket.day, entry)
  }
  return dateKeys.map(date => {
    const entry = byDay.get(date)
    return {
      date,
      visits: entry?.visits ?? 0,
      users: entry?.users ?? 0,
      minutes: Math.round(entry?.minutes ?? 0)
    }
  })
}

/** 人均使用时长（分钟，保留 1 位小数）；当天没有心跳时返回 null。 */
export function averageMinutesPerUser(minutes: number, users: number): number | null {
  if (!users || users <= 0) return null
  return Math.round((minutes / users) * 10) / 10
}

/**
 * 读取区间内的活跃心跳并按「日 + 账号」聚合。
 *
 * 只统计 `school_id = schoolId` 的心跳；切段用窗口函数按 (东八区自然日, 账号, 会话) 分区，
 * 因此跨午夜的访问会自然拆成两天各一段。
 */
export async function loadUsageActivity(
  db: DbClient,
  input: { schoolId: string, startKey: string, endKey: string, start: Date, end: Date }
): Promise<UsageActivity> {
  const buckets = await rowsOf<{ day: string, user_id: string, visits: number, beats: number }>(db.execute(sql`
    with beats as (
      select pe.user_id,
             coalesce(pe.metadata->>'session', '') as session_id,
             ((pe.created_at at time zone 'Asia/Shanghai')::date) as day,
             pe.created_at,
             lag(pe.created_at) over (
               partition by ((pe.created_at at time zone 'Asia/Shanghai')::date), pe.user_id, coalesce(pe.metadata->>'session', '')
               order by pe.created_at
             ) as prev_at
      from product_events pe
      where pe.school_id = ${input.schoolId}
        and pe.event_name = ${USAGE_HEARTBEAT_EVENT}
        and pe.user_id is not null
        and pe.created_at >= ${input.start}
        and pe.created_at <= ${input.end}
    ),
    marked as (
      select user_id, day,
             case
               when prev_at is null or created_at - prev_at > ${USAGE_VISIT_IDLE_MINUTES} * interval '1 minute' then 1
               else 0
             end as is_new_visit,
             created_at
      from beats
    )
    select to_char(day, 'YYYY-MM-DD') as day,
           user_id,
           sum(is_new_visit)::int as visits,
           count(*)::int as beats
    from marked
    group by 1, 2
  `))

  const dateKeys = enumerateDateKeys(input.startKey, input.endKey)
  const days = summarizeUsageActivity(
    buckets.map(row => ({ day: row.day, userId: row.user_id, visits: row.visits, beats: row.beats })),
    dateKeys
  )
  return {
    days,
    totals: {
      visits: days.reduce((sum, day) => sum + day.visits, 0),
      // 周期内去重账号数按桶直接去重（不能对每日用户数求和/取最大）
      users: new Set(buckets.map(bucket => bucket.user_id)).size,
      minutes: days.reduce((sum, day) => sum + day.minutes, 0)
    }
  }
}

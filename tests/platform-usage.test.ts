/**
 * 平台使用量（S2 活跃心跳）口径的纯函数单测。
 *
 * 覆盖：按日补零、同一天多账号聚合、单人单日时长封顶、人均时长（无心跳时为 null）。
 */
import { describe, expect, it } from 'vitest'
import {
  USAGE_MAX_MINUTES_PER_USER_DAY,
  averageMinutesPerUser,
  summarizeUsageActivity,
  summarizeEstimatedVisits,
  type UsageBeatBucket
} from '../server/domain/platform-usage'

const bucket = (day: string, userId: string, visits: number, beats: number): UsageBeatBucket => ({ day, userId, visits, beats })

describe('summarizeUsageActivity', () => {
  it('按 dateKeys 补零并保留顺序', () => {
    const days = summarizeUsageActivity([], ['2026-10-01', '2026-10-02'])
    expect(days).toEqual([
      { date: '2026-10-01', visits: 0, users: 0, minutes: 0 },
      { date: '2026-10-02', visits: 0, users: 0, minutes: 0 }
    ])
  })

  it('同一天多账号：人次与人数分别累计，时长按 5 分钟折算', () => {
    const days = summarizeUsageActivity([
      bucket('2026-10-01', 'u1', 2, 6),
      bucket('2026-10-01', 'u2', 1, 3)
    ], ['2026-10-01'])
    expect(days[0]).toEqual({ date: '2026-10-01', visits: 3, users: 2, minutes: 45 })
  })

  it('单人单日时长封顶 24 小时（异常心跳不把时长算爆）', () => {
    const days = summarizeUsageActivity([bucket('2026-10-01', 'u1', 1, 10_000)], ['2026-10-01'])
    expect(days[0]?.minutes).toBe(USAGE_MAX_MINUTES_PER_USER_DAY)
  })

  it('忽略区间外的日期（只按 dateKeys 输出）', () => {
    const days = summarizeUsageActivity([bucket('2026-09-30', 'u1', 5, 5)], ['2026-10-01'])
    expect(days).toEqual([{ date: '2026-10-01', visits: 0, users: 0, minutes: 0 }])
  })
})

describe('averageMinutesPerUser', () => {
  it('无心跳时返回 null（前端显示 —）', () => {
    expect(averageMinutesPerUser(0, 0)).toBeNull()
  })

  it('按人数平均并保留一位小数', () => {
    expect(averageMinutesPerUser(45, 2)).toBe(22.5)
    expect(averageMinutesPerUser(10, 3)).toBe(3.3)
  })
})


describe('summarizeEstimatedVisits', () => {
  it('按日期汇总估算段数并按 dateKeys 补零', () => {
    const days = summarizeEstimatedVisits([
      { day: '2026-10-01', visits: 3 },
      { day: '2026-10-01', visits: 2 },
      { day: '2026-09-30', visits: 9 }
    ], ['2026-10-01', '2026-10-02'])
    expect(days).toEqual([
      { date: '2026-10-01', visits: 5 },
      { date: '2026-10-02', visits: 0 }
    ])
  })

  it('负数按 0 处理，避免脏数据把估算值拉低', () => {
    const days = summarizeEstimatedVisits([{ day: '2026-10-01', visits: -3 }], ['2026-10-01'])
    expect(days[0]?.visits).toBe(0)
  })
})

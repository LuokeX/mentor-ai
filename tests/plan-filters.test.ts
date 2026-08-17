import { describe, expect, it } from 'vitest'
import { parseDateOnly, resolveReviewDateRange } from '../server/domain/plan-filters'

describe('parseDateOnly', () => {
  it('接受真实日期并返回 UTC 零点', () => {
    const date = parseDateOnly('2026-08-17')
    expect(date?.toISOString()).toBe('2026-08-17T00:00:00.000Z')
    expect(parseDateOnly('2026-02-28')).not.toBeNull()
  })

  it('拒绝非法月份、日期与溢出日期', () => {
    expect(parseDateOnly('2026-99-99')).toBeNull()
    expect(parseDateOnly('2026-13-01')).toBeNull()
    expect(parseDateOnly('2026-00-10')).toBeNull()
    expect(parseDateOnly('2026-02-30')).toBeNull()
    expect(parseDateOnly('2026-04-31')).toBeNull()
    expect(parseDateOnly('2026-1-01')).toBeNull()
    expect(parseDateOnly('2026-01-1')).toBeNull()
    expect(parseDateOnly('abc')).toBeNull()
    expect(parseDateOnly('')).toBeNull()
  })

  it('闰年 2 月 29 日合法', () => {
    expect(parseDateOnly('2024-02-29')).not.toBeNull()
    expect(parseDateOnly('2026-02-29')).toBeNull()
  })
})

describe('resolveReviewDateRange', () => {
  it('单边日期按上海时区换算当日边界', () => {
    const range = resolveReviewDateRange('2026-08-17')
    // 上海 00:00 = UTC 前一日 16:00
    expect(range.reviewFrom?.toISOString()).toBe('2026-08-16T16:00:00.000Z')
    expect(range.reviewTo).toBeUndefined()
  })

  it('结束日期当日 23:59:59.999（上海）', () => {
    const range = resolveReviewDateRange(undefined, '2026-08-17')
    expect(range.reviewTo?.toISOString()).toBe('2026-08-17T15:59:59.999Z')
  })

  it('闭区间：起止同日', () => {
    const range = resolveReviewDateRange('2026-08-17', '2026-08-17')
    expect(range.reviewFrom?.getTime()).toBeLessThan(range.reviewTo!.getTime())
  })

  it('非法日期抛 400', () => {
    expect(() => resolveReviewDateRange('2026-99-99')).toThrowError(/无效/)
    expect(() => resolveReviewDateRange(undefined, '2026-02-30')).toThrowError(/无效/)
  })

  it('开始晚于结束抛 400', () => {
    expect(() => resolveReviewDateRange('2026-08-18', '2026-08-17')).toThrowError(/不能晚于/)
  })

  it('未传日期时返回空边界', () => {
    expect(resolveReviewDateRange()).toEqual({})
  })
})
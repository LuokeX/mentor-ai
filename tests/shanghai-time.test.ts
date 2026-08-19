import { describe, expect, it } from 'vitest'
import { SHANGHAI_OFFSET_MS, shanghaiDayStartUtc, shanghaiTomorrowUtc } from '../server/domain/shanghai-time'

describe('shanghai-time 上海时区日界', () => {
  it('shanghaiDayStartUtc(0) 返回上海当天 00:00 对应的 UTC 时刻', () => {
    // 北京时间 2026-08-19 12:00 = UTC 2026-08-19 04:00
    const now = Date.UTC(2026, 7, 19, 4, 0, 0)
    const dayStart = shanghaiDayStartUtc(0, now)
    // 上海 08-19 00:00 = UTC 08-18 16:00
    expect(dayStart.toISOString()).toBe('2026-08-18T16:00:00.000Z')
  })

  it('shanghaiTomorrowUtc 返回上海明天 00:00（跨越 UTC 日界）', () => {
    // 北京时间 2026-08-19 12:00 = UTC 2026-08-19 04:00，上海明天 = 08-20 00:00 = UTC 08-19 16:00
    const now = Date.UTC(2026, 7, 19, 4, 0, 0)
    expect(shanghaiTomorrowUtc(now).toISOString()).toBe('2026-08-19T16:00:00.000Z')
  })

  it('北京时间凌晨（UTC 日界之前）仍按上海日期计算', () => {
    // 北京时间 2026-08-19 01:00 = UTC 2026-08-18 17:00：上海还是 08-19，明天 08-20 00:00 = UTC 08-19 16:00
    const now = Date.UTC(2026, 7, 18, 17, 0, 0)
    expect(shanghaiTomorrowUtc(now).toISOString()).toBe('2026-08-19T16:00:00.000Z')
  })

  it('上海日期进位（月末/年末）正确', () => {
    // 上海 2026-08-31 12:00 = UTC 08-31 04:00，明天 = 09-01 00:00 = UTC 08-31 16:00
    const now = Date.UTC(2026, 7, 31, 4, 0, 0)
    expect(shanghaiTomorrowUtc(now).toISOString()).toBe('2026-08-31T16:00:00.000Z')
  })

  it('SHANGHAI_OFFSET_MS 为固定 8 小时', () => {
    expect(SHANGHAI_OFFSET_MS).toBe(8 * 60 * 60 * 1000)
  })
})
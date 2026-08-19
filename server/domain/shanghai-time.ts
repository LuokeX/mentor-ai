/**
 * 业务时区工具（纯函数，可单测）。
 *
 * 业务时区为上海（UTC+8，无夏令时）。数据库时间列是带时区的 timestamp，
 * 服务端日界判断（今天/明天到期）统一按上海日界线计算，避免依赖容器系统时区
 * （容器默认 UTC，会造成北京 00:00–08:00 期间日界偏移一天）。
 */

/** 上海与 UTC 的固定偏移（毫秒）。 */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 上海时区「今天 + offsetDays」的 00:00 对应的 UTC 时刻。
 * 例：北京时间 2026-08-20 00:00 = UTC 2026-08-19 16:00。
 */
export function shanghaiDayStartUtc(offsetDays = 0, now: number = Date.now()): Date {
  const shanghaiNow = new Date(now + SHANGHAI_OFFSET_MS)
  const dayStart = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate() + offsetDays,
  ) - SHANGHAI_OFFSET_MS
  return new Date(dayStart)
}

/** 上海时区「明天 00:00」对应的 UTC 时刻（工作台/通知的到期边界）。 */
export function shanghaiTomorrowUtc(now: number = Date.now()): Date {
  return shanghaiDayStartUtc(1, now)
}
/**
 * 方案列表日期筛选领域逻辑（纯函数，可单测）。
 *
 * 业务时区为上海（UTC+8，无夏令时）。数据库时间列是带时区的 timestamp，
 * 按本地日界线过滤：reviewFrom 当日 00:00 起、reviewTo 当日 23:59:59.999 止。
 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
/** 上海与 UTC 的固定偏移（毫秒）。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 日期筛选参数非法。h3 会把带 statusCode 的错误转成 400 响应。 */
export class DateFilterError extends Error {
  statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'DateFilterError'
  }
}

/** 解析并校验 YYYY-MM-DD 是否为真实存在的日期；非法返回 null（如 2026-99-99）。 */
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_RE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  // 构造后回读校验：2 月 30 日等溢出日期会被 JS 自动进位，回读不一致即非法
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}

export interface ReviewDateRange {
  reviewFrom?: Date
  reviewTo?: Date
}

/**
 * 把 YYYY-MM-DD 查询串解析为上海时区的当日边界。
 * 非法日期、开始晚于结束均抛 400。
 */
export function resolveReviewDateRange(reviewFrom?: string, reviewTo?: string): ReviewDateRange {
  const from = reviewFrom ? parseDateOnly(reviewFrom) : undefined
  const to = reviewTo ? parseDateOnly(reviewTo) : undefined
  if (reviewFrom && !from) {
    throw new DateFilterError('复盘开始日期无效（需为真实存在的 YYYY-MM-DD 日期）')
  }
  if (reviewTo && !to) {
    throw new DateFilterError('复盘结束日期无效（需为真实存在的 YYYY-MM-DD 日期）')
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw new DateFilterError('复盘开始日期不能晚于结束日期')
  }
  return {
    reviewFrom: from ? new Date(from.getTime() - SHANGHAI_OFFSET_MS) : undefined,
    reviewTo: to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1 - SHANGHAI_OFFSET_MS) : undefined
  }
}
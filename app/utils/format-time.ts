/**
 * 全系统统一北京时间（东八区，无夏令时）格式化工具。
 *
 * 背景：数据库以 TIMESTAMPTZ 存储 UTC 绝对时刻；展示层过去依赖
 * `toLocaleString('zh-CN')`，会跟随浏览器时区。这里统一用
 * `timeZone: 'Asia/Shanghai'` 强制北京时间，与浏览器时区解耦。
 * 输出格式与原先 `toLocaleString('zh-CN')` 一致（如 2026/8/20 15:00:44）。
 */
export const BEIJING_TZ = 'Asia/Shanghai'

const fullFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ,
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ,
  year: 'numeric', month: 'numeric', day: 'numeric',
})

const shortFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ,
  month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
})

function toDate(value: unknown): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 完整日期时间：2026/8/20 15:00:44（北京时间）。非法或空值返回 —。 */
export function formatDateTime(value: unknown): string {
  const d = toDate(value)
  return d ? fullFmt.format(d) : '—'
}

/** 纯日期：2026/8/20（北京时间）。非法或空值返回 —。 */
export function formatDate(value: unknown): string {
  const d = toDate(value)
  return d ? dateFmt.format(d) : '—'
}

/** 短日期时间：8/20 15:00（北京时间）。非法或空值返回 —。 */
export function formatDateTimeShort(value: unknown): string {
  const d = toDate(value)
  return d ? shortFmt.format(d) : '—'
}

/** 北京时间 datetime-local 输入值：YYYY-MM-DDTHH:mm。非法或空值返回空串。 */
export function toBeijingInput(value: unknown): string {
  const d = toDate(value)
  if (!d) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** 北京时间日期戳：YYYY-MM-DD（用于导出文件名，避免 UTC 日界差一天）。 */
export function formatBeijingDateStamp(value: unknown = new Date()): string {
  const d = toDate(value) ?? new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * 将 datetime-local 输入值（YYYY-MM-DDTHH:mm）按北京时间解析为绝对时刻。
 * `new Date('YYYY-MM-DDTHH:mm')` 会跟随浏览器时区，这里显式补 +08:00 偏移。
 * 非法或空值返回 null。
 */
export function parseBeijingInput(value: string | null | undefined): Date | null {
  if (!value) return null
  const norm = value.includes('T') ? value : value.replace(' ', 'T')
  const withOffset = norm.length === 16 ? `${norm}:00+08:00` : `${norm}+08:00`
  const d = new Date(withOffset)
  return Number.isNaN(d.getTime()) ? null : d
}
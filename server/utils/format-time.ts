/**
 * 服务端统一北京时间格式化（与 app/utils/format-time.ts 同口径）。
 * 数据库存 UTC 绝对时刻，展示/水印/文件名统一按东八区输出。
 */
const BEIJING_TZ = 'Asia/Shanghai'

const fullFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TZ,
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

/** 完整日期时间：2026/8/20 15:00:44（北京时间）。 */
export function formatDateTime(value: Date | string): string {
  return fullFmt.format(new Date(value))
}

/** 北京时间日期戳：YYYY-MM-DD（导出文件名，避免 UTC 日界差一天）。 */
export function formatBeijingDateStamp(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
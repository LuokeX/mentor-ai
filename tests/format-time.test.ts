import { describe, expect, it } from 'vitest'
import {
  formatBeijingDateStamp,
  formatDate,
  formatDateTime,
  formatDateTimeShort,
  parseBeijingInput,
  toBeijingInput,
} from '../app/utils/format-time'

describe('format-time 北京时间统一显示', () => {
  it('formatDateTime 将 UTC 时刻显示为北京时间（+8）', () => {
    // UTC 2026-08-19 06:00 = 北京 2026-08-19 14:00
    expect(formatDateTime('2026-08-19T06:00:00.000Z')).toBe('2026/8/19 14:00:00')
  })

  it('formatDateTime 跨 UTC 日界仍按北京日期', () => {
    // UTC 2026-08-19 16:30 = 北京 2026-08-20 00:30
    expect(formatDateTime('2026-08-19T16:30:00.000Z')).toBe('2026/8/20 00:30:00')
  })

  it('formatDateTime 午夜显示 00:00（与 toLocaleString(zh-CN) 原格式一致）', () => {
    // UTC 2026-08-19 16:00 = 北京 2026-08-20 00:00
    expect(formatDateTime('2026-08-19T16:00:00.000Z')).toBe('2026/8/20 00:00:00')
  })

  it('formatDate 按北京日期取日（凌晨跨日界）', () => {
    // UTC 2026-08-18 17:00 = 北京 2026-08-19 01:00
    expect(formatDate('2026-08-18T17:00:00.000Z')).toBe('2026/8/19')
  })

  it('formatDateTimeShort 输出 月/日 时:分', () => {
    expect(formatDateTimeShort('2026-08-19T06:00:00.000Z')).toBe('8/19 14:00')
  })

  it('formatDateTime 空值与非法值返回 —', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('toBeijingInput 生成 datetime-local 预填值（北京时间）', () => {
    expect(toBeijingInput('2026-08-19T06:00:00.000Z')).toBe('2026-08-19T14:00')
  })

  it('parseBeijingInput 将北京时间输入解析为绝对时刻', () => {
    expect(parseBeijingInput('2026-08-19T14:00')?.toISOString()).toBe('2026-08-19T06:00:00.000Z')
    expect(parseBeijingInput('2026-08-19 14:00')?.toISOString()).toBe('2026-08-19T06:00:00.000Z')
  })

  it('parseBeijingInput 空值/非法值返回 null', () => {
    expect(parseBeijingInput('')).toBeNull()
    expect(parseBeijingInput(null)).toBeNull()
    expect(parseBeijingInput('abc')).toBeNull()
  })

  it('parseBeijingInput 与 toBeijingInput 互为往返', () => {
    const round = toBeijingInput(parseBeijingInput('2026-08-19T14:00')!)
    expect(round).toBe('2026-08-19T14:00')
  })

  it('formatBeijingDateStamp 取北京时间日期（避免 UTC 日界差一天）', () => {
    // UTC 2026-08-18 17:00 = 北京 2026-08-19 01:00
    expect(formatBeijingDateStamp('2026-08-18T17:00:00.000Z')).toBe('2026-08-19')
    // UTC 2026-08-19 04:00 = 北京 2026-08-19 12:00
    expect(formatBeijingDateStamp('2026-08-19T04:00:00.000Z')).toBe('2026-08-19')
  })
})
import { sql, type SQL, type Column } from 'drizzle-orm'

/**
 * 并发控制时间戳比较。
 *
 * JS Date 只有毫秒精度，API 返回的 updatedAt（toISOString）与前端回传值
 * 在 JS 层天然一致；不一致发生在 SQL 层：node-postgres 将 JS Date 序列化为
 * 毫秒 ISO 字符串传入，而数据库 updated_at 由 now() 生成、保存微秒精度，
 * 直接相等比较必然失败。因此 where 条件统一按毫秒截断后比较，并发控制
 * 语义不变（同一毫秒内的两次写入视为同一版本，业务上可接受）。
 */
export function matchesExpectedUpdatedAt(recordUpdatedAt: Date, expected: string): boolean {
  return recordUpdatedAt.getTime() === new Date(expected).getTime()
}

/** 生成 SQL 条件：数据库列按毫秒截断后与期望值相等 */
export function updatedAtMatches(column: SQL | Column, expected: string): SQL {
  return sql`date_trunc('milliseconds', ${column}) = ${new Date(expected).toISOString()}`
}
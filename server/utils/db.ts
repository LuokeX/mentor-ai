import { Pool } from 'pg'
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import { type PgTransaction } from 'drizzle-orm/pg-core'
import { type ExtractTablesWithRelations } from 'drizzle-orm'
import type { H3Event } from 'h3'
import * as schema from '../db/schema'

let pool: Pool | undefined
let database: NodePgDatabase<typeof schema> | undefined

/** 事务回调内的客户端类型，与 db.transaction(cb) 的参数签名一致。 */
export type DbTx = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
/** 常规查询与事务回调共用的数据库客户端。 */
export type DbClient = NodePgDatabase<typeof schema> | DbTx

export function useDb(event?: H3Event) {
  if (database) return database
  const url = event ? useRuntimeConfig(event).databaseUrl : process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  pool = new Pool({ connectionString: url, max: 12, idleTimeoutMillis: 30_000 })
  database = drizzle(pool, { schema })
  return database
}

export function usePool(event?: H3Event) {
  useDb(event)
  if (!pool) throw new Error('Database pool was not initialized')
  return pool
}

export { schema }

import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import * as schema from '../db/schema'

let pool: Pool | undefined
let database: NodePgDatabase<typeof schema> | undefined

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

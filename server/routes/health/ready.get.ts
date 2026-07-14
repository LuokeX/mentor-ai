import { sql } from 'drizzle-orm'
import { useDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  try {
    await useDb(event).execute(sql`select 1`)
    return { status: 'ready', database: 'ok', timestamp: new Date().toISOString() }
  } catch {
    setResponseStatus(event, 503)
    return { status: 'not_ready', database: 'unavailable', timestamp: new Date().toISOString() }
  }
})

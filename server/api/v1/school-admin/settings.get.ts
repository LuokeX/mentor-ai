import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const db = useDb(event)
  const [[settings], psychologists] = await Promise.all([
    db.select().from(schema.schoolSettings).where(eq(schema.schoolSettings.schoolId, admin.schoolId!)).limit(1),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(and(
      eq(schema.users.schoolId, admin.schoolId!), eq(schema.users.role, 'psychologist'), eq(schema.users.status, 'active')
    ))
  ])
  return { ...settings, psychologists }
})

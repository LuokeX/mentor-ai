import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const rows = await useDb(event).select({
    id: schema.invitations.id,
    userId: schema.invitations.userId,
    name: schema.invitations.name,
    email: schema.invitations.email,
    role: schema.invitations.role,
    expiresAt: schema.invitations.expiresAt,
    acceptedAt: schema.invitations.acceptedAt,
    createdAt: schema.invitations.createdAt
  }).from(schema.invitations).where(eq(schema.invitations.schoolId, admin.schoolId)).orderBy(desc(schema.invitations.createdAt)).limit(100)
  const now = Date.now()
  return rows.map(row => ({
    ...row,
    status: row.acceptedAt ? 'accepted' : row.expiresAt.getTime() <= now ? 'expired' : 'pending'
  }))
})

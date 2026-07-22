import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationQuerySchema, roleSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['users'])
  const query = getQuery(event)
  const parsed = paginationQuerySchema.omit({ status: true }).extend({
    role: roleSchema.or(z.literal('all')).default('all'),
    status: z.enum(['active', 'invited', 'disabled', 'all']).default('all')
  }).parse(query)
  const db = useDb(event)
  const conditions = [eq(schema.users.schoolId, schoolId)]
  if (parsed.role !== 'all') conditions.push(eq(schema.users.role, parsed.role))
  if (parsed.status !== 'all') conditions.push(eq(schema.users.status, parsed.status))
  if (parsed.q) {
    conditions.push(or(ilike(schema.users.name, `%${parsed.q}%`), ilike(schema.users.email, `%${parsed.q}%`))!)
  }
  const orderBy = parsed.order === 'asc' ? asc(schema.users.updatedAt) : desc(schema.users.updatedAt)
  const [rows, [total]] = await Promise.all([
    db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
      activatedAt: schema.users.activatedAt,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt
    }).from(schema.users).where(and(...conditions)).orderBy(orderBy).limit(parsed.pageSize).offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.users).where(and(...conditions))
  ])
  return { rows, page: parsed.page, pageSize: parsed.pageSize, total: total?.value || 0 }
})

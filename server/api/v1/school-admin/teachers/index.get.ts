import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['teachers'])
  const query = getQuery(event)
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: z.enum(['active', 'invited', 'disabled', 'all']).default('all')
  }).parse(query)
  const db = useDb(event)
  const conditions = [eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'teacher')]
  if (parsed.status !== 'all') conditions.push(eq(schema.users.status, parsed.status))
  if (parsed.q) conditions.push(or(ilike(schema.users.name, `%${parsed.q}%`), ilike(schema.users.email, `%${parsed.q}%`))!)
  const [rows, [total]] = await Promise.all([
    db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      activatedAt: schema.users.activatedAt,
      lastLoginAt: schema.users.lastLoginAt,
      classCount: sql<number>`count(distinct ${schema.classes.id})::int`,
      studentCount: sql<number>`count(distinct ${schema.students.id})::int`,
      latestActivityAt: sql<Date | null>`max(${schema.productEvents.createdAt})`
    })
      .from(schema.users)
      .leftJoin(schema.classes, and(eq(schema.classes.ownerUserId, schema.users.id), eq(schema.classes.schoolId, schoolId)))
      .leftJoin(schema.students, and(eq(schema.students.ownerUserId, schema.users.id), eq(schema.students.schoolId, schoolId)))
      .leftJoin(schema.productEvents, and(eq(schema.productEvents.userId, schema.users.id), eq(schema.productEvents.schoolId, schoolId)))
      .where(and(...conditions))
      .groupBy(schema.users.id)
      .orderBy(desc(schema.users.updatedAt))
      .limit(parsed.pageSize)
      .offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.users).where(and(...conditions))
  ])
  return { rows, page: parsed.page, pageSize: parsed.pageSize, total: total?.value || 0 }
})

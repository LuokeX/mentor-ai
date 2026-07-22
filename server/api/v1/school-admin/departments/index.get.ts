import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { departmentTypeSchema } from '../../../../../shared/contracts'
import { countSql, offsetFrom, requireSchoolManagement } from '../../../../domain/school-management'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['departments'])
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
    status: z.enum(['active', 'archived']).or(z.literal('all')).default('all'),
    type: departmentTypeSchema.or(z.literal('all')).default('all'),
    order: z.enum(['asc', 'desc']).default('desc')
  }).parse(getQuery(event))
  const db = useDb(event)
  const conditions = [eq(schema.departments.schoolId, schoolId)]
  if (parsed.status !== 'all') conditions.push(eq(schema.departments.status, parsed.status))
  if (parsed.type !== 'all') conditions.push(eq(schema.departments.type, parsed.type))
  if (parsed.q) conditions.push(or(ilike(schema.departments.name, `%${parsed.q}%`), ilike(schema.departments.code, `%${parsed.q}%`))!)
  const orderBy = parsed.order === 'asc' ? asc(schema.departments.updatedAt) : desc(schema.departments.updatedAt)
  const [rows, [total]] = await Promise.all([
    db.select({
      id: schema.departments.id,
      parentId: schema.departments.parentId,
      leaderUserId: schema.departments.leaderUserId,
      leaderName: schema.users.name,
      name: schema.departments.name,
      code: schema.departments.code,
      type: schema.departments.type,
      description: schema.departments.description,
      status: schema.departments.status,
      memberCount: sql<number>`count(distinct ${schema.departmentMembers.userId})::int`,
      classCount: sql<number>`count(distinct ${schema.classes.id})::int`,
      createdAt: schema.departments.createdAt,
      updatedAt: schema.departments.updatedAt
    })
      .from(schema.departments)
      .leftJoin(schema.users, eq(schema.users.id, schema.departments.leaderUserId))
      .leftJoin(schema.departmentMembers, eq(schema.departmentMembers.departmentId, schema.departments.id))
      .leftJoin(schema.classes, and(eq(schema.classes.departmentId, schema.departments.id), eq(schema.classes.schoolId, schoolId)))
      .where(and(...conditions))
      .groupBy(schema.departments.id, schema.users.name)
      .orderBy(orderBy)
      .limit(parsed.pageSize)
      .offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.departments).where(and(...conditions))
  ])
  return { rows, page: parsed.page, pageSize: parsed.pageSize, total: total?.value || 0 }
})

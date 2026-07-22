import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { paginationQuerySchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { schoolId } = await requireSchoolManagement(event, ['classes'])
  const parsed = paginationQuerySchema.parse(getQuery(event))
  const db = useDb(event)
  const conditions = [eq(schema.classes.schoolId, schoolId)]
  if (parsed.status !== 'all') conditions.push(eq(schema.classes.status, parsed.status))
  if (parsed.q) conditions.push(or(ilike(schema.classes.name, `%${parsed.q}%`), ilike(schema.classes.externalCode, `%${parsed.q}%`))!)
  const orderBy = parsed.order === 'asc' ? asc(schema.classes.updatedAt) : desc(schema.classes.updatedAt)
  const [rows, [total]] = await Promise.all([
    db.select({
      id: schema.classes.id,
      name: schema.classes.name,
      externalCode: schema.classes.externalCode,
      grade: schema.classes.grade,
      studentCount: schema.classes.studentCount,
      establishedAt: schema.classes.establishedAt,
      status: schema.classes.status,
      departmentId: schema.classes.departmentId,
      departmentName: schema.departments.name,
      ownerUserId: schema.classes.ownerUserId,
      ownerName: schema.users.name,
      actualStudentCount: sql<number>`count(${schema.students.id})::int`,
      createdAt: schema.classes.createdAt,
      updatedAt: schema.classes.updatedAt
    })
      .from(schema.classes)
      .innerJoin(schema.users, eq(schema.users.id, schema.classes.ownerUserId))
      .leftJoin(schema.departments, eq(schema.departments.id, schema.classes.departmentId))
      .leftJoin(schema.students, and(eq(schema.students.classId, schema.classes.id), eq(schema.students.schoolId, schoolId), eq(schema.students.status, 'active')))
      .where(and(...conditions))
      .groupBy(schema.classes.id, schema.users.name, schema.departments.name)
      .orderBy(orderBy)
      .limit(parsed.pageSize)
      .offset(offsetFrom(parsed.page, parsed.pageSize)),
    db.select({ value: countSql }).from(schema.classes).where(and(...conditions))
  ])
  return { rows, page: parsed.page, pageSize: parsed.pageSize, total: total?.value || 0 }
})

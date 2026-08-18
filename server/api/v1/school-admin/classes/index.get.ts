import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'grade', 'studentCount', 'energyStage', 'status', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['classes'])
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = (['active', 'archived', 'graduated', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  const conditions = [eq(schema.classes.schoolId, schoolId)]
  if (status !== 'all') conditions.push(eq(schema.classes.status, status))
  if (q) conditions.push(or(ilike(schema.classes.name, `%${q}%`), ilike(schema.classes.externalCode, `%${q}%`))!)

  const sortCol = sort === 'name' ? schema.classes.name
    : sort === 'grade' ? schema.classes.grade
    : sort === 'studentCount' ? schema.classes.studentCount
    : sort === 'status' ? schema.classes.status
    : sort === 'createdAt' ? schema.classes.createdAt
    : schema.classes.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
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
      section: schema.classes.section,
      classType: schema.classes.classType,
      location: schema.classes.location,
      schoolYear: schema.classes.schoolYear,
      /** 能量场阶段（评估回写），管理员修正优先 */
      energyStage: sql<string | null>`coalesce(${schema.classes.overrides}->>'energyStage', ${schema.classes.energyStage})`,
      /** 管理员修正原始值（编辑表单回显用） */
      overrides: schema.classes.overrides,
      actualStudentCount: sql<number>`count(${schema.students.id})::int`,
      createdAt: schema.classes.createdAt,
      updatedAt: schema.classes.updatedAt,
    })
      .from(schema.classes)
      .innerJoin(schema.users, and(eq(schema.users.id, schema.classes.ownerUserId), eq(schema.users.schoolId, schoolId)))
      .leftJoin(schema.departments, and(eq(schema.departments.id, schema.classes.departmentId), eq(schema.departments.schoolId, schoolId)))
      .leftJoin(schema.students, and(eq(schema.students.classId, schema.classes.id), eq(schema.students.schoolId, schoolId), eq(schema.students.status, 'active')))
      .where(and(...conditions))
      .groupBy(schema.classes.id, schema.users.name, schema.departments.name)
      .orderBy(orderFn(sortCol))
      .limit(pageSize)
      .offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.classes).where(and(...conditions)),
    page,
    pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordOwnerUserId: row.ownerUserId,
      recordStatus: row.status,
      targetType: 'class',
      targetId: row.id,
    }, event)
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'archive', 'restore', 'transfer', 'graduate']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})

import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { departmentTypeSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'code', 'type', 'status', 'memberCount', 'classCount', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['departments'])
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = (['active', 'archived', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const depType = departmentTypeSchema.or(z.literal('all')).default('all').parse(query.type)
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  const conditions = [eq(schema.departments.schoolId, schoolId)]
  if (status !== 'all') conditions.push(eq(schema.departments.status, status))
  if (depType !== 'all') conditions.push(eq(schema.departments.type, depType))
  if (q) conditions.push(or(ilike(schema.departments.name, `%${q}%`), ilike(schema.departments.code, `%${q}%`))!)

  // 动态排序列映射（聚合字段用 sql 表达式）
  const sortCol = sort === 'name' ? schema.departments.name
    : sort === 'code' ? schema.departments.code
    : sort === 'type' ? schema.departments.type
    : sort === 'status' ? schema.departments.status
    : sort === 'memberCount' ? sql`count(distinct ${schema.departmentMembers.userId})`
    : sort === 'classCount' ? sql`count(distinct ${schema.classes.id})`
    : sort === 'createdAt' ? schema.departments.createdAt
    : schema.departments.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.departments.id,
      parentId: schema.departments.parentId,
      leaderUserId: schema.departments.leaderUserId,
      leaderName: schema.users.name,
      name: schema.departments.name,
      code: schema.departments.code,
      type: schema.departments.type,
      description: schema.departments.description,
      status: schema.departments.status,
      shortName: schema.departments.shortName,
      scope: schema.departments.scope,
      leaderTitle: schema.departments.leaderTitle,
      location: schema.departments.location,
      phone: schema.departments.phone,
      headcountLimit: schema.departments.headcountLimit,
      sortOrder: schema.departments.sortOrder,
      memberCount: sql<number>`count(distinct ${schema.departmentMembers.userId})::int`,
      classCount: sql<number>`count(distinct ${schema.classes.id})::int`,
      createdAt: schema.departments.createdAt,
      updatedAt: schema.departments.updatedAt,
    })
      .from(schema.departments)
      .leftJoin(schema.users, eq(schema.users.id, schema.departments.leaderUserId))
      .leftJoin(schema.departmentMembers, eq(schema.departmentMembers.departmentId, schema.departments.id))
      .leftJoin(schema.classes, and(eq(schema.classes.departmentId, schema.departments.id), eq(schema.classes.schoolId, schoolId)))
      .where(and(...conditions))
      .groupBy(schema.departments.id, schema.users.name)
      .orderBy(orderFn(sortCol))
      .limit(pageSize)
      .offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.departments).where(and(...conditions)),
    page,
    pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordStatus: row.status,
      targetType: 'department',
      targetId: row.id,
    })
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'archive', 'restore']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'phone', 'status', 'activatedAt', 'lastLoginAt', 'classCount', 'studentCount', 'latestActivityAt', 'updatedAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['teachers'], { allowPlatformAdmin: true })
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = (['active', 'invited', 'disabled', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  const conditions = [eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'teacher')]
  if (status !== 'all') conditions.push(eq(schema.users.status, status))
  if (q) conditions.push(or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.phone, `%${q}%`))!)

  // 动态排序列映射
  const sortCol = sort === 'name' ? schema.users.name
    : sort === 'phone' ? schema.users.phone
    : sort === 'status' ? schema.users.status
    : sort === 'activatedAt' ? schema.users.activatedAt
    : sort === 'lastLoginAt' ? schema.users.lastLoginAt
    : sort === 'classCount' ? sql`count(distinct ${schema.classes.id})`
    : sort === 'studentCount' ? sql`count(distinct ${schema.students.id})`
    : sort === 'latestActivityAt' ? sql`max(${schema.productEvents.createdAt})`
    : schema.users.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.users.id,
      name: schema.users.name,
      phone: schema.users.phone,
      status: schema.users.status,
      activatedAt: schema.users.activatedAt,
      lastLoginAt: schema.users.lastLoginAt,
      classCount: sql<number>`count(distinct ${schema.classes.id})::int`,
      studentCount: sql<number>`count(distinct ${schema.students.id})::int`,
      latestActivityAt: sql<Date | null>`max(${schema.productEvents.createdAt})`,
    })
      .from(schema.users)
      .leftJoin(schema.classes, and(eq(schema.classes.ownerUserId, schema.users.id), eq(schema.classes.schoolId, schoolId)))
      .leftJoin(schema.students, and(eq(schema.students.ownerUserId, schema.users.id), eq(schema.students.schoolId, schoolId)))
      .leftJoin(schema.productEvents, and(eq(schema.productEvents.userId, schema.users.id), eq(schema.productEvents.schoolId, schoolId)))
      .where(and(...conditions))
      .groupBy(schema.users.id)
      .orderBy(orderFn(sortCol))
      .limit(pageSize)
      .offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.users).where(and(...conditions)),
    page,
    pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordStatus: row.status,
      targetType: 'user',
      targetId: row.id,
    })
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'disable']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})
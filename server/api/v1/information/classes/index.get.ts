/**
 * 教师端班级列表 API（管理框架示例）
 *
 * 返回分页列表、每条记录的能力标记、页面级能力。
 * 教师只能看到自己负责的班级。
 */
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'

const SORT_WHITELIST = createSortWhitelist('name', 'grade', 'studentCount', 'status', 'updatedAt', 'createdAt')

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'graduated', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })

  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [
    eq(schema.classes.schoolId, user.schoolId),
    eq(schema.classes.ownerUserId, user.id),
  ]
  if (query.status !== 'all') conditions.push(eq(schema.classes.status, query.status))
  if (query.q) {
    conditions.push(or(ilike(schema.classes.name, `%${query.q}%`))!)
  }

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'name' ? schema.classes.name
    : validSort === 'grade' ? schema.classes.grade
    : validSort === 'studentCount' ? schema.classes.studentCount
    : validSort === 'status' ? schema.classes.status
    : validSort === 'createdAt' ? schema.classes.createdAt
    : schema.classes.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade,
      studentCount: schema.classes.studentCount, status: schema.classes.status,
      externalCode: schema.classes.externalCode, departmentId: schema.classes.departmentId,
      ownerUserId: schema.classes.ownerUserId, schoolId: schema.classes.schoolId,
      createdAt: schema.classes.createdAt, updatedAt: schema.classes.updatedAt,
    }).from(schema.classes).where(and(...conditions)).orderBy(orderFn(sortCol))
      .limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.classes).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })

  // 为每行注入能力
  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: row.schoolId,
      recordOwnerUserId: row.ownerUserId,
      recordStatus: row.status,
      targetType: 'class',
      targetId: row.id,
    })
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = ['view', 'create']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof result.rows[number]>
})
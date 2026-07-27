/**
 * 教师端学生列表 API
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

const SORT_WHITELIST = createSortWhitelist('name', 'gender', 'status', 'updatedAt', 'createdAt')

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  classId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })

  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [
    eq(schema.students.schoolId, user.schoolId),
    eq(schema.students.ownerUserId, user.id),
  ]
  if (query.status !== 'all') conditions.push(eq(schema.students.status, query.status))
  if (query.classId) conditions.push(eq(schema.students.classId, query.classId))
  if (query.q) conditions.push(or(ilike(schema.students.nameSearch, `%${query.q}%`))!)

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'name' ? schema.students.nameSearch
    : validSort === 'gender' ? schema.students.gender
    : validSort === 'status' ? schema.students.status
    : validSort === 'createdAt' ? schema.students.createdAt
    : schema.students.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.students.id, classId: schema.students.classId,
      gender: schema.students.gender, status: schema.students.status,
      ownerUserId: schema.students.ownerUserId, schoolId: schema.students.schoolId,
      createdAt: schema.students.createdAt, updatedAt: schema.students.updatedAt,
    }).from(schema.students).where(and(...conditions)).orderBy(orderFn(sortCol))
      .limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.students).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const caps = await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'student', targetId: row.id })
    return { ...row, name: '***', _capabilities: caps }
  }))

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<typeof result.rows[number]>
})
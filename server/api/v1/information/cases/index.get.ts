/**
 * 教师端案例列表 API
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'

const SORT_WHITELIST = createSortWhitelist('title', 'module', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['active', 'closed', 'archived', 'all']).default('all'),
  module: z.string().optional(),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.moduleCases.schoolId, user.schoolId), eq(schema.moduleCases.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.moduleCases.status, query.status))
  if (query.module) conditions.push(eq(schema.moduleCases.module, query.module))

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'title' ? schema.moduleCases.title
    : validSort === 'module' ? schema.moduleCases.module
    : validSort === 'status' ? schema.moduleCases.status
    : validSort === 'createdAt' ? schema.moduleCases.createdAt : schema.moduleCases.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({ id: schema.moduleCases.id, title: schema.moduleCases.title, module: schema.moduleCases.module, status: schema.moduleCases.status, subjectType: schema.moduleCases.subjectType, subjectId: schema.moduleCases.subjectId, ownerUserId: schema.moduleCases.ownerUserId, schoolId: schema.moduleCases.schoolId, createdAt: schema.moduleCases.createdAt, updatedAt: schema.moduleCases.updatedAt }).from(schema.moduleCases).where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.moduleCases).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const rows = await Promise.all(result.rows.map(async (row) => {
    const caps = await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'student_case', targetId: row.id })
    return { ...row, _capabilities: caps }
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<typeof result.rows[number]>
})
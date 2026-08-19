import { and, asc, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { countSql, requireSchoolManagement } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { parseDateOnly } from '../../../../domain/plan-filters'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  status: z.enum(['draft', 'submitted', 'archived']).optional(),
  module: moduleIdSchema.optional(),
  /** 教师姓名模糊搜索 */
  q: z.string().trim().max(120).optional(),
  /** 时间范围（YYYY-MM-DD，上海时区当日边界），作用于 submittedAt */
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
  // 排序白名单：仅 createdAt / submittedAt
  sort: z.enum(['createdAt', 'submittedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

/** 上海与 UTC 的固定偏移（毫秒），与 plan-filters.ts 口径一致 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['assessments'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  // 时间范围边界：submittedFrom 当日 00:00 起（上海）、submittedTo 当日 23:59:59.999 止
  let from: Date | undefined
  let to: Date | undefined
  if (query.submittedFrom) {
    const parsed = parseDateOnly(query.submittedFrom)
    if (!parsed) throw createError({ statusCode: 400, message: '开始日期无效（需为真实存在的 YYYY-MM-DD 日期）' })
    from = new Date(parsed.getTime() - SHANGHAI_OFFSET_MS)
  }
  if (query.submittedTo) {
    const parsed = parseDateOnly(query.submittedTo)
    if (!parsed) throw createError({ statusCode: 400, message: '结束日期无效（需为真实存在的 YYYY-MM-DD 日期）' })
    to = new Date(parsed.getTime() + 24 * 60 * 60 * 1000 - 1 - SHANGHAI_OFFSET_MS)
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw createError({ statusCode: 400, message: '开始日期不能晚于结束日期' })
  }

  const conditions = [eq(schema.assessmentAttempts.schoolId, schoolId)]
  if (query.status) conditions.push(eq(schema.assessmentAttempts.status, query.status))
  if (query.module) conditions.push(eq(schema.assessmentAttempts.module, query.module))
  if (query.q) conditions.push(ilike(schema.users.name, `%${query.q}%`))
  if (from) conditions.push(gte(schema.assessmentAttempts.submittedAt, from))
  if (to) conditions.push(lte(schema.assessmentAttempts.submittedAt, to))
  const where = and(...conditions)

  const sortColMap: Record<string, any> = {
    createdAt: schema.assessmentAttempts.createdAt,
    submittedAt: schema.assessmentAttempts.submittedAt,
  }
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.assessmentAttempts.id,
      ownerUserId: schema.assessmentAttempts.ownerUserId,
      teacherName: schema.users.name,
      module: schema.assessmentAttempts.module,
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      definitionVersion: schema.assessmentAttempts.definitionVersion,
      status: schema.assessmentAttempts.status,
      submittedAt: schema.assessmentAttempts.submittedAt,
      createdAt: schema.assessmentAttempts.createdAt,
      updatedAt: schema.assessmentAttempts.updatedAt
    }).from(schema.assessmentAttempts)
      .innerJoin(schema.users, eq(schema.assessmentAttempts.ownerUserId, schema.users.id))
      .where(where)
      .orderBy(orderFn(sortColMap[query.sort]))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    countQuery: db.select({ value: countSql }).from(schema.assessmentAttempts)
      .innerJoin(schema.users, eq(schema.assessmentAttempts.ownerUserId, schema.users.id))
      .where(where),
    page: query.page,
    pageSize: query.pageSize
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordStatus: row.status,
      targetType: 'assessment',
      targetId: row.id
    }, event)
    return { ...row, _capabilities: capabilities }
  }))

  const capabilities = await resolvePageCapabilities(user, 'assessment', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities } satisfies ManagedListResult<typeof rows[number]>
})
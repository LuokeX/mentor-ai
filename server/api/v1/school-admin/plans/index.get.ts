import { and, asc, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { countSql, requireSchoolManagement } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { resolveReviewDateRange } from '../../../../domain/plan-filters'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

/** 方案状态全集（含 archived），与教师端 server/api/v1/plans/index.get.ts 同源 */
const PLAN_STATUSES = [
  'pending_acceptance', 'accepted', 'in_progress', 'review_due',
  'adjustment_needed', 'escalated', 'completed', 'closed', 'archived'
] as const

const querySchema = z.object({
  status: z.enum(PLAN_STATUSES).optional(),
  module: moduleIdSchema.optional(),
  /** 标题模糊搜索（summary 是加密列，不能参与 SQL 模糊匹配） */
  q: z.string().trim().max(200).optional(),
  /** 复盘日期闭区间（YYYY-MM-DD），对 nextReviewAt 做 gte/lte 过滤 */
  reviewFrom: z.string().optional(),
  reviewTo: z.string().optional(),
  // 排序白名单：仅 updatedAt / createdAt / nextReviewAt / title
  sort: z.enum(['updatedAt', 'createdAt', 'nextReviewAt', 'title']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['plans'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  // 复盘日期边界按上海时区换算；非法日期或起止倒挂直接 400
  const { reviewFrom, reviewTo } = resolveReviewDateRange(query.reviewFrom, query.reviewTo)

  const conditions = [eq(schema.plans.schoolId, schoolId)]
  if (query.status) conditions.push(eq(schema.plans.status, query.status))
  if (query.module) conditions.push(eq(schema.plans.module, query.module))
  if (query.q) conditions.push(ilike(schema.plans.title, `%${query.q}%`))
  if (reviewFrom) conditions.push(gte(schema.plans.nextReviewAt, reviewFrom))
  if (reviewTo) conditions.push(lte(schema.plans.nextReviewAt, reviewTo))
  const where = and(...conditions)

  const sortColMap: Record<string, any> = {
    updatedAt: schema.plans.updatedAt,
    createdAt: schema.plans.createdAt,
    nextReviewAt: schema.plans.nextReviewAt,
    title: schema.plans.title
  }
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.plans.id,
      ownerUserId: schema.plans.ownerUserId,
      teacherName: schema.users.name,
      title: schema.plans.title,
      titleFull: schema.plans.titleFull,
      module: schema.plans.module,
      status: schema.plans.status,
      attributionKeywords: schema.plans.attributionKeywords,
      instrumentSnapshots: schema.plans.instrumentSnapshots,
      nextReviewAt: schema.plans.nextReviewAt,
      completedAt: schema.plans.completedAt,
      closedAt: schema.plans.closedAt,
      createdAt: schema.plans.createdAt,
      updatedAt: schema.plans.updatedAt
    }).from(schema.plans)
      .innerJoin(schema.users, eq(schema.plans.ownerUserId, schema.users.id))
      .where(where)
      .orderBy(orderFn(sortColMap[query.sort]))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    countQuery: db.select({ value: countSql }).from(schema.plans)
      .innerJoin(schema.users, eq(schema.plans.ownerUserId, schema.users.id))
      .where(where),
    page: query.page,
    pageSize: query.pageSize
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordStatus: row.status,
      targetType: 'plan',
      targetId: row.id
    }, event)
    return { ...row, _capabilities: capabilities }
  }))

  const capabilities = await resolvePageCapabilities(user, 'plan', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities } satisfies ManagedListResult<typeof rows[number]>
})
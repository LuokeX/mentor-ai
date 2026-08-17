/**
 * 方案列表。
 *
 * 在此之前系统里没有任何方案列表入口：教师只能从提交评估后的那一次 CTA、
 * 工作台的今日动作、或事件中心的待复盘进入方案。方案一旦不逾期也不待复盘，
 * 就再也点不到了——这是「量表 → 归因 → 工具 → 方案」闭环最后一段的断点。
 *
 * summary 是加密字段，这里不解密：列表只需要标题、模块、状态和时间，
 * 详情页才需要正文。少解一次密就少一次明文出现在响应里。
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const PLAN_STATUSES = [
  'pending_acceptance', 'accepted', 'in_progress', 'review_due',
  'adjustment_needed', 'escalated', 'completed', 'closed', 'archived'
] as const

// 返回 ManagedListResult 形状，直接对接 useManagedList / ManagedDataTable / TablePagination，
// 不为这一个页面另造一套列表机制。
const querySchema = z.object({
  status: z.enum([...PLAN_STATUSES, 'active']).optional(),
  module: moduleIdSchema.optional(),
  q: z.string().trim().max(200).optional(),
  // 复盘日期闭区间（YYYY-MM-DD），对 nextReviewAt 做 gte/lte 过滤
  reviewFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewFrom 需为 YYYY-MM-DD 日期').optional(),
  reviewTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewTo 需为 YYYY-MM-DD 日期').optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'nextReviewAt', 'title']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

/** 「进行中」= 还需要教师做点什么的状态 */
const ACTIVE_STATUSES = ['pending_acceptance', 'accepted', 'in_progress', 'review_due', 'adjustment_needed', 'escalated']

const SORT_COLUMNS = {
  updatedAt: schema.plans.updatedAt,
  createdAt: schema.plans.createdAt,
  nextReviewAt: schema.plans.nextReviewAt,
  title: schema.plans.title
} as const

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const filters = [eq(schema.plans.ownerUserId, user.id)]
  if (query.status === 'active') filters.push(inArray(schema.plans.status, ACTIVE_STATUSES))
  else if (query.status) filters.push(eq(schema.plans.status, query.status))
  if (query.module) filters.push(eq(schema.plans.module, query.module))
  // 只按标题搜。摘要是加密列，没法在 SQL 里做模糊匹配。
  if (query.q) filters.push(ilike(schema.plans.title, `%${query.q}%`))
  // 复盘日期闭区间：reviewFrom 当日 00:00 起，reviewTo 当日 23:59:59 止
  if (query.reviewFrom) filters.push(gte(schema.plans.nextReviewAt, new Date(`${query.reviewFrom}T00:00:00.000Z`)))
  if (query.reviewTo) filters.push(lte(schema.plans.nextReviewAt, new Date(`${query.reviewTo}T23:59:59.999Z`)))
  const where = and(...filters)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() }).from(schema.plans).where(where)

  const sortColumn = SORT_COLUMNS[query.sort]
  const rows = await db.select({
    id: schema.plans.id,
    title: schema.plans.title,
    titleFull: schema.plans.titleFull,
    sourceType: schema.plans.sourceType,
    module: schema.plans.module,
    status: schema.plans.status,
    studentId: schema.plans.studentId,
    classId: schema.plans.classId,
    guardianId: schema.plans.guardianId,
    attributionKeywords: schema.plans.attributionKeywords,
    instrumentSnapshots: schema.plans.instrumentSnapshots,
    nextReviewAt: schema.plans.nextReviewAt,
    completedAt: schema.plans.completedAt,
    createdAt: schema.plans.createdAt,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans)
    .where(where)
    .orderBy(query.order === 'asc' ? asc(sortColumn) : desc(sortColumn))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  return {
    rows: rows.map(row => ({ ...row, _capabilities: ['view'] as const })),
    total: Number(total),
    page: query.page,
    pageSize: query.pageSize,
    capabilities: []
  }
})

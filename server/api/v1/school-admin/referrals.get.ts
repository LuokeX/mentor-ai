import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../shared/management'
import { countSql, offsetFrom } from '../../../domain/school-management'
import { requireUser } from '../../../utils/auth'
import { paginateResult } from '../../../utils/pagination'
import { schema, useDb } from '../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['created', 'acknowledged', 'offline_handling', 'escalated', 'closed', 'all']).default('all'),
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const conditions = [eq(schema.referrals.schoolId, admin.schoolId)]
  if (query.status !== 'all') conditions.push(eq(schema.referrals.status, query.status))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.referrals.id,
      safetyEventId: schema.referrals.safetyEventId,
      psychologistId: schema.referrals.psychologistId,
      priority: schema.referrals.priority,
      status: schema.referrals.status,
      acknowledgeDueAt: schema.referrals.acknowledgeDueAt,
      escalationDueAt: schema.referrals.escalationDueAt,
      acknowledgedAt: schema.referrals.acknowledgedAt,
      escalatedAt: schema.referrals.escalatedAt,
      closedAt: schema.referrals.closedAt,
      severity: schema.safetyEvents.severity,
      teacherName: schema.users.name,
      createdAt: schema.referrals.createdAt,
      updatedAt: schema.referrals.updatedAt,
    }).from(schema.referrals)
      .innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
      .innerJoin(schema.users, eq(schema.safetyEvents.ownerUserId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.referrals.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.referrals).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({
    ...row,
    _capabilities: row.status === 'closed' || row.acknowledgedAt
      ? ['view'] as Capability[]
      : ['view', 'transfer'] as Capability[],
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

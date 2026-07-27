import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { requireUser } from '../../../../utils/auth'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('all'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const schoolId = user.schoolId
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const conditions = [eq(schema.adminAccessRequests.schoolId, schoolId)]
  if (query.status !== 'all') conditions.push(eq(schema.adminAccessRequests.status, query.status))
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.adminAccessRequests.id,
      requesterId: schema.adminAccessRequests.requesterId,
      requesterName: schema.users.name,
      targetType: schema.adminAccessRequests.targetType,
      targetId: schema.adminAccessRequests.targetId,
      reasonCategory: schema.adminAccessRequests.reasonCategory,
      reasonText: schema.adminAccessRequests.reasonText,
      status: schema.adminAccessRequests.status,
      reviewedAt: schema.adminAccessRequests.reviewedAt,
      expiresAt: schema.adminAccessRequests.expiresAt,
      createdAt: schema.adminAccessRequests.createdAt,
    }).from(schema.adminAccessRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.adminAccessRequests.requesterId))
      .where(and(...conditions))
      .orderBy(desc(schema.adminAccessRequests.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.adminAccessRequests).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({
    ...row,
    _capabilities: row.status === 'pending' ? ['view', 'edit'] as Capability[] : ['view'] as Capability[],
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

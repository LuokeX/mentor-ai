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
  status: z.enum(['pending', 'approved', 'rejected', 'revoked', 'all']).default('all'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const conditions = [eq(schema.delegatedManagementGrants.schoolId, user.schoolId)]
  if (query.status !== 'all') conditions.push(eq(schema.delegatedManagementGrants.status, query.status))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.delegatedManagementGrants.id,
      requesterName: schema.users.name,
      scopes: schema.delegatedManagementGrants.scopes,
      reason: schema.delegatedManagementGrants.reason,
      status: schema.delegatedManagementGrants.status,
      expiresAt: schema.delegatedManagementGrants.expiresAt,
      createdAt: schema.delegatedManagementGrants.createdAt,
    }).from(schema.delegatedManagementGrants)
      .innerJoin(schema.users, eq(schema.users.id, schema.delegatedManagementGrants.requesterId))
      .where(and(...conditions))
      .orderBy(desc(schema.delegatedManagementGrants.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.delegatedManagementGrants).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({
    ...row,
    _capabilities: row.status === 'pending' || row.status === 'approved' ? ['view', 'edit'] as Capability[] : ['view'] as Capability[],
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

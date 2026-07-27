import { desc, eq } from 'drizzle-orm'
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
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['platform_admin'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.delegatedManagementGrants.id,
      schoolId: schema.delegatedManagementGrants.schoolId,
      schoolName: schema.schools.name,
      scopes: schema.delegatedManagementGrants.scopes,
      reason: schema.delegatedManagementGrants.reason,
      status: schema.delegatedManagementGrants.status,
      expiresAt: schema.delegatedManagementGrants.expiresAt,
      createdAt: schema.delegatedManagementGrants.createdAt,
    }).from(schema.delegatedManagementGrants)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.delegatedManagementGrants.schoolId))
      .where(eq(schema.delegatedManagementGrants.requesterId, user.id))
      .orderBy(desc(schema.delegatedManagementGrants.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.delegatedManagementGrants)
      .where(eq(schema.delegatedManagementGrants.requesterId, user.id)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

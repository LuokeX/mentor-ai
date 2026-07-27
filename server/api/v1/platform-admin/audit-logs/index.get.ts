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
  await requireUser(event, ['platform_admin'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.auditLogs.id,
      schoolId: schema.auditLogs.schoolId,
      schoolName: schema.schools.name,
      actorId: schema.auditLogs.actorId,
      actorName: schema.users.name,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      result: schema.auditLogs.result,
      createdAt: schema.auditLogs.createdAt,
    }).from(schema.auditLogs)
      .leftJoin(schema.schools, eq(schema.schools.id, schema.auditLogs.schoolId))
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.auditLogs),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

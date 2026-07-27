import { and, desc, eq, ilike, or } from 'drizzle-orm'
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
  q: z.string().trim().max(120).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const schoolId = user.schoolId
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const conditions = [eq(schema.auditLogs.schoolId, schoolId)]
  if (query.q) conditions.push(or(
    ilike(schema.auditLogs.action, `%${query.q}%`),
    ilike(schema.auditLogs.targetType, `%${query.q}%`),
  )!)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      actorId: schema.auditLogs.actorId,
      actorName: schema.users.name,
      result: schema.auditLogs.result,
      createdAt: schema.auditLogs.createdAt,
    }).from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.auditLogs).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

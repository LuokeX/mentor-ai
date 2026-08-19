import { and, desc, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { requireUser } from '../../../../utils/auth'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'disabled', 'all']).default('all'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['platform_admin'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const conditions = []
  if (query.q) conditions.push(ilike(schema.schools.name, `%${query.q}%`))
  if (query.status !== 'all') conditions.push(eq(schema.schools.status, query.status))
  const where = conditions.length ? and(...conditions) : undefined
  const result = await paginateResult({
    dataQuery: db.select().from(schema.schools).where(where)
      .orderBy(desc(schema.schools.updatedAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.schools).where(where),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = await Promise.all(result.rows.map(async row => ({
    ...row,
    _capabilities: await resolveCapabilities({ user, recordSchoolId: row.id, recordStatus: row.status, targetType: 'school', targetId: row.id }, event),
  })))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'school', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})

import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolvePageCapabilities } from '../../../../domain/capabilities'
import { requireUser } from '../../../../utils/auth'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const schoolId = user.schoolId
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.planOperationEvents.id,
      eventType: schema.planOperationEvents.eventType,
      planId: schema.planOperationEvents.planId,
      actionId: schema.planOperationEvents.actionId,
      teacherName: schema.users.name,
      createdAt: schema.planOperationEvents.createdAt,
    }).from(schema.planOperationEvents)
      .innerJoin(schema.users, eq(schema.users.id, schema.planOperationEvents.ownerUserId))
      .where(eq(schema.planOperationEvents.schoolId, schoolId))
      .orderBy(desc(schema.planOperationEvents.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.planOperationEvents).where(eq(schema.planOperationEvents.schoolId, schoolId)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'plan_operation', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})

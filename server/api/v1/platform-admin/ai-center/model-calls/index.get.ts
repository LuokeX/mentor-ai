import { desc, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../../domain/school-management'
import { requireUser } from '../../../../../utils/auth'
import { paginateResult } from '../../../../../utils/pagination'
import { schema, useDb } from '../../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['success', 'failed', 'fallback']).optional(),
  purpose: z.string().trim().max(50).optional()
})

/** AI 调用审计列表（ai_model_calls）。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = []
  if (query.status) conditions.push(eq(schema.aiModelCalls.status, query.status))
  if (query.purpose) conditions.push(eq(schema.aiModelCalls.purpose, query.purpose))

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.aiModelCalls.id,
      schoolId: schema.aiModelCalls.schoolId,
      schoolName: schema.schools.name,
      ownerUserId: schema.aiModelCalls.ownerUserId,
      ownerName: schema.users.name,
      purpose: schema.aiModelCalls.purpose,
      provider: schema.aiModelCalls.provider,
      model: schema.aiModelCalls.model,
      status: schema.aiModelCalls.status,
      latencyMs: schema.aiModelCalls.latencyMs,
      promptTokens: schema.aiModelCalls.promptTokens,
      completionTokens: schema.aiModelCalls.completionTokens,
      errorCode: schema.aiModelCalls.errorCode,
      dataMode: schema.aiModelCalls.dataMode,
      createdAt: schema.aiModelCalls.createdAt
    }).from(schema.aiModelCalls)
      .leftJoin(schema.schools, eq(schema.schools.id, schema.aiModelCalls.schoolId))
      .leftJoin(schema.users, eq(schema.users.id, schema.aiModelCalls.ownerUserId))
      .where(conditions.length ? sql`${sql.join(conditions, sql` and `)}` : sql`true`)
      .orderBy(desc(schema.aiModelCalls.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.aiModelCalls).where(conditions.length ? sql`${sql.join(conditions, sql` and `)}` : sql`true`),
    page: query.page,
    pageSize: query.pageSize
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../shared/management'
import { countSql, offsetFrom } from '../../../domain/school-management'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { useDb, schema } from '../../../utils/db'
import { paginateResult } from '../../../utils/pagination'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['created', 'acknowledged', 'offline_handling', 'escalated', 'closed', 'all']).default('all'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const query = querySchema.parse(getQuery(event))
  const conditions = [eq(schema.referrals.psychologistId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.referrals.status, query.status))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      referral: schema.referrals,
      safety: schema.safetyEvents,
      teacherName: schema.users.name,
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
  const secret = useRuntimeConfig(event).encryptionKey
  const now = Date.now()
  const rows = result.rows.map(row => ({
    ...row.referral,
    severity: row.safety.severity,
    matchedRules: row.safety.matchedRules,
    summary: decryptSensitive(row.safety.summaryEnc, secret).slice(0, 1000),
    teacherName: row.teacherName,
    eventCreatedAt: row.safety.createdAt,
    acknowledgeRemainingSeconds: row.referral.acknowledgedAt ? null : Math.floor(((row.referral.acknowledgeDueAt?.getTime() || now) - now) / 1000),
    escalationRemainingSeconds: row.referral.escalatedAt || row.referral.acknowledgedAt ? null : Math.floor(((row.referral.escalationDueAt?.getTime() || now) - now) / 1000),
    _capabilities: ['view', 'edit'] as Capability[],
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

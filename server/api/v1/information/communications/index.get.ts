/**
 * 教师端沟通记录列表 API
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive } from '../../../../utils/crypto'

const SORT_WHITELIST = createSortWhitelist('riskLevel', 'parentType', 'occurredAt', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  riskLevel: z.enum(['low', 'medium', 'high', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.communications.schoolId, user.schoolId), eq(schema.communications.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.communications.status, query.status))
  if (query.riskLevel !== 'all') conditions.push(eq(schema.communications.riskLevel, query.riskLevel))

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'riskLevel' ? schema.communications.riskLevel
    : validSort === 'parentType' ? schema.communications.parentType
    : validSort === 'occurredAt' ? schema.communications.occurredAt
    : validSort === 'status' ? schema.communications.status
    : validSort === 'createdAt' ? schema.communications.createdAt : schema.communications.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.communications.id,
      summaryEnc: schema.communications.summaryEnc,
      parentType: schema.communications.parentType,
      riskLevel: schema.communications.riskLevel,
      attitudeType: schema.communications.attitudeType,
      status: schema.communications.status,
      occurredAt: schema.communications.occurredAt,
      guardianId: schema.communications.guardianId,
      studentId: schema.communications.studentId,
      ownerUserId: schema.communications.ownerUserId,
      schoolId: schema.communications.schoolId,
      createdAt: schema.communications.createdAt,
      updatedAt: schema.communications.updatedAt,
    }).from(schema.communications).where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.communications).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const secret = useRuntimeConfig(event).encryptionKey
  const rows = result.rows.map((row) => {
    const { summaryEnc, ...safeRow } = row
    const summary = decryptSensitive(summaryEnc, secret)
    return {
      ...safeRow,
      summaryPreview: summary.length > 80 ? `${summary.slice(0, 80)}…` : summary,
      _capabilities: resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'communication', targetId: row.id }),
    }
  })
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

/**
 * 教师端家长列表 API
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive, searchableHash } from '../../../../utils/crypto'

const SORT_WHITELIST = createSortWhitelist('relation', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.guardians.schoolId, user.schoolId), eq(schema.guardians.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.guardians.status, query.status))
  const secret = useRuntimeConfig(event).encryptionKey
  if (query.q) conditions.push(eq(schema.guardians.nameSearch, searchableHash(query.q, secret)))
  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'relation' ? schema.guardians.relation
    : validSort === 'status' ? schema.guardians.status
    : validSort === 'createdAt' ? schema.guardians.createdAt : schema.guardians.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.guardians.id,
      nameEnc: schema.guardians.nameEnc,
      phoneEnc: schema.guardians.phoneEnc,
      relation: schema.guardians.relation,
      status: schema.guardians.status,
      ownerUserId: schema.guardians.ownerUserId,
      schoolId: schema.guardians.schoolId,
      commRiskLevel: schema.guardians.commRiskLevel,
      guardianSnapshot: schema.guardians.guardianSnapshot,
      createdAt: schema.guardians.createdAt,
      updatedAt: schema.guardians.updatedAt,
    }).from(schema.guardians).where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.guardians).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const rows = await Promise.all(result.rows.map(async (row) => {
    const { nameEnc, phoneEnc, ...safeRow } = row
    const phone = decryptSensitive(phoneEnc, secret)
    return {
      ...safeRow,
      name: decryptSensitive(nameEnc, secret),
      phoneMasked: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null,
      _capabilities: await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'guardian', targetId: row.id }, event),
    }
  }))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'guardian', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})

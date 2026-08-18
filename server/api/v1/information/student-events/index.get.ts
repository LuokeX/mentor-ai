/**
 * 教师端学生事件列表 API
 */
import { and, asc, desc, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive } from '../../../../utils/crypto'

const SORT_WHITELIST = createSortWhitelist('eventType', 'severity', 'occurredAt', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['open', 'resolved', 'closed', 'all']).default('all'),
  q: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.studentEvents.schoolId, user.schoolId), eq(schema.studentEvents.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.studentEvents.status, query.status))
  if (query.q) conditions.push(ilike(schema.studentEvents.title, `%${query.q}%`))

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'eventType' ? schema.studentEvents.eventType
    : validSort === 'severity' ? schema.studentEvents.severity
    : validSort === 'occurredAt' ? schema.studentEvents.occurredAt
    : validSort === 'status' ? schema.studentEvents.status
    : validSort === 'createdAt' ? schema.studentEvents.createdAt : schema.studentEvents.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.studentEvents.id,
      eventType: schema.studentEvents.eventType,
      severity: schema.studentEvents.severity,
      title: schema.studentEvents.title,
      description: schema.studentEvents.description,
      resolution: schema.studentEvents.resolution,
      studentId: schema.studentEvents.studentId,
      studentNameEnc: schema.students.nameEnc,
      occurredAt: schema.studentEvents.occurredAt,
      status: schema.studentEvents.status,
      ownerUserId: schema.studentEvents.ownerUserId,
      schoolId: schema.studentEvents.schoolId,
      createdAt: schema.studentEvents.createdAt,
      updatedAt: schema.studentEvents.updatedAt,
    }).from(schema.studentEvents)
      .innerJoin(schema.students, and(
        eq(schema.students.id, schema.studentEvents.studentId),
        eq(schema.students.schoolId, user.schoolId),
      ))
      .where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.studentEvents).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const secret = useRuntimeConfig(event).encryptionKey
  const rows = await Promise.all(result.rows.map(async (row) => {
    const { studentNameEnc, ...safeRow } = row
    return {
      ...safeRow,
      studentName: decryptSensitive(studentNameEnc, secret),
      _capabilities: await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'student_event', targetId: row.id }, event),
    }
  }))
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: ['view', 'create'] as Capability[] } satisfies ManagedListResult<(typeof rows)[number]>
})

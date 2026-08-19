/**
 * 教师端班级事件列表 API（德育或班级重点事件）
 */
import { and, asc, desc, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'

const SORT_WHITELIST = createSortWhitelist('eventType', 'severity', 'occurredAt', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['open', 'resolved', 'closed', 'all']).default('all'),
  classId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.classEvents.schoolId, user.schoolId), eq(schema.classEvents.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.classEvents.status, query.status))
  if (query.classId) conditions.push(eq(schema.classEvents.classId, query.classId))
  if (query.q) conditions.push(ilike(schema.classEvents.title, `%${query.q}%`))

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'eventType' ? schema.classEvents.eventType
    : validSort === 'severity' ? schema.classEvents.severity
    : validSort === 'occurredAt' ? schema.classEvents.occurredAt
    : validSort === 'status' ? schema.classEvents.status
    : validSort === 'createdAt' ? schema.classEvents.createdAt : schema.classEvents.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.classEvents.id,
      eventType: schema.classEvents.eventType,
      severity: schema.classEvents.severity,
      title: schema.classEvents.title,
      description: schema.classEvents.description,
      resolution: schema.classEvents.resolution,
      classId: schema.classEvents.classId,
      className: schema.classes.name,
      occurredAt: schema.classEvents.occurredAt,
      status: schema.classEvents.status,
      ownerUserId: schema.classEvents.ownerUserId,
      schoolId: schema.classEvents.schoolId,
      createdAt: schema.classEvents.createdAt,
      updatedAt: schema.classEvents.updatedAt,
    }).from(schema.classEvents)
      .innerJoin(schema.classes, and(
        eq(schema.classes.id, schema.classEvents.classId),
        eq(schema.classes.schoolId, user.schoolId),
      ))
      .where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.classEvents).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const rows = await Promise.all(result.rows.map(async (row) => ({
    ...row,
    _capabilities: await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'class_event', targetId: row.id }, event),
  })))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'class_event', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})
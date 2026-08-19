import { and, asc, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('updatedAt', 'createdAt')
const ALLOWED_PAGE_SIZES = [20, 50, 100] as const

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = (ALLOWED_PAGE_SIZES.includes(Number(query.pageSize) as 20 | 50 | 100)
    ? Number(query.pageSize)
    : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = (['active', 'archived', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const contextType = (query.contextType as string)?.trim() || ''
  const fromRaw = (query.from as string)?.trim() || ''
  const toRaw = (query.to as string)?.trim() || ''
  if ((fromRaw && !z.string().datetime().safeParse(fromRaw).success) || (toRaw && !z.string().datetime().safeParse(toRaw).success)) {
    throw createError({ statusCode: 400, message: '时间范围参数必须为 ISO 8601 格式' })
  }
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  const conditions = [eq(schema.chatSessions.schoolId, user.schoolId)]
  if (status !== 'all') conditions.push(eq(schema.chatSessions.status, status))
  if (q) conditions.push(ilike(schema.users.name, `%${q}%`))
  if (contextType) conditions.push(eq(schema.chatSessions.contextType, contextType))
  if (fromRaw) conditions.push(gte(schema.chatSessions.updatedAt, new Date(fromRaw)))
  if (toRaw) conditions.push(lte(schema.chatSessions.updatedAt, new Date(toRaw)))

  const sortColMap: Record<string, any> = {
    updatedAt: schema.chatSessions.updatedAt,
    createdAt: schema.chatSessions.createdAt,
  }
  const sortCol = sortColMap[sort] || schema.chatSessions.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.chatSessions.id,
      ownerUserId: schema.chatSessions.ownerUserId,
      /** 教师姓名（join users） */
      teacherName: schema.users.name,
      title: schema.chatSessions.title,
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId,
      status: schema.chatSessions.status,
      /** 未软删消息数 */
      messageCount: sql<number>`(select count(*)::int from chat_messages cm where cm.session_id = ${schema.chatSessions.id} and cm.deleted_at is null)`,
      createdAt: schema.chatSessions.createdAt,
      updatedAt: schema.chatSessions.updatedAt,
    }).from(schema.chatSessions)
      .innerJoin(schema.users, eq(schema.chatSessions.ownerUserId, schema.users.id))
      .where(and(...conditions))
      .orderBy(orderFn(sortCol))
      .limit(pageSize).offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.chatSessions)
      .innerJoin(schema.users, eq(schema.chatSessions.ownerUserId, schema.users.id))
      .where(and(...conditions)),
    page,
    pageSize,
  })

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: user.schoolId,
      recordStatus: row.status,
      targetType: 'conversation',
      targetId: row.id,
    }, event)
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'conversation', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})
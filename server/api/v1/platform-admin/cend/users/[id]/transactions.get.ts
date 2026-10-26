import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { findCendSchool } from '../../../../../../domain/cend-school'
import { getPointBalance, listPointTransactions } from '../../../../../../domain/cend-points'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(20)
})

/** 平台后台：查看指定 C 端用户的积分流水。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const userId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化' })

  const [target] = await db.select({ id: schema.userRoles.id })
    .from(schema.userRoles)
    .where(and(
      eq(schema.userRoles.userId, userId),
      eq(schema.userRoles.schoolId, cend.id),
      eq(schema.userRoles.roleCode, 'teacher')
    )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: 'C 端用户不存在' })

  const [balance, transactions] = await Promise.all([
    getPointBalance(db, userId),
    listPointTransactions(db, userId, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    })
  ])
  return { balance, page: query.page, pageSize: query.pageSize, transactions }
})

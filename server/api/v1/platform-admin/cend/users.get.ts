import { and, count, desc, eq, gt, ilike, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { findCendSchool } from '../../../../domain/cend-school'
import { activeMembership, getPointBalance } from '../../../../domain/cend-points'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(20),
  q: z.string().trim().max(120).optional()
})

/** 平台后台：C 端用户列表（按 C 端租户的 teacher 角色识别）。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化' })

  const conditions = [
    eq(schema.userRoles.schoolId, cend.id),
    eq(schema.userRoles.roleCode, 'teacher')
  ]
  if (query.q) {
    conditions.push(or(
      ilike(schema.users.name, `%${query.q}%`),
      ilike(schema.users.phone, `%${query.q}%`)
    )!)
  }

  const rows = await db.select({
    userId: schema.users.id,
    name: schema.users.name,
    phone: schema.users.phone,
    status: schema.users.status,
    createdAt: schema.users.createdAt,
    lastLoginAt: schema.users.lastLoginAt
  })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(and(...conditions))
    .orderBy(desc(schema.users.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  const [totalRow] = await db.select({ value: count() })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(and(...conditions))

  const userIds = rows.map(row => row.userId)
  const [profiles, balances, memberships] = userIds.length
    ? await Promise.all([
        db.select({ userId: schema.cendProfiles.userId, nickname: schema.cendProfiles.nickname })
          .from(schema.cendProfiles).where(inArray(schema.cendProfiles.userId, userIds)),
        db.select({ userId: schema.cendPointAccounts.userId, balance: schema.cendPointAccounts.balance })
          .from(schema.cendPointAccounts).where(inArray(schema.cendPointAccounts.userId, userIds)),
        db.select({
          userId: schema.cendMemberships.userId,
          tier: schema.cendMemberships.tier,
          endAt: schema.cendMemberships.endAt
        }).from(schema.cendMemberships).where(and(
          inArray(schema.cendMemberships.userId, userIds),
          eq(schema.cendMemberships.status, 'active'),
          gt(schema.cendMemberships.endAt, new Date())
        ))
      ])
    : [[], [], []]
  const profileByUser = new Map(profiles.map(item => [item.userId, item.nickname]))
  const balanceByUser = new Map(balances.map(item => [item.userId, item.balance]))
  const membershipByUser = new Map(memberships.map(item => [item.userId, item]))

  return {
    cend,
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
    rows: await Promise.all(rows.map(async (row) => {
      const membership = membershipByUser.get(row.userId) ?? await activeMembership(db, row.userId)
      return {
        ...row,
        nickname: profileByUser.get(row.userId) ?? row.name,
        balance: balanceByUser.get(row.userId) ?? await getPointBalance(db, row.userId),
        membership: membership
          ? { tier: membership.tier, endAt: membership.endAt }
          : null
      }
    }))
  }
})

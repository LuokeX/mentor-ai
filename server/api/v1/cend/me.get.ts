import { and, eq } from 'drizzle-orm'
import { shanghaiDateKey } from '../../../../shared/dashboard'
import {
  activeMembership,
  getPointBalance,
  listCendTaskStatuses
} from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

/** C 端当前用户概览：资料、积分、会员、今日签到、任务状态。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const cend = await requireCendContext(event, user)
  const db = useDb(event)
  const today = shanghaiDateKey(new Date())

  const [profile] = await db.select().from(schema.cendProfiles)
    .where(eq(schema.cendProfiles.userId, user.id)).limit(1)
  const [balance, membership, tasks, checkin] = await Promise.all([
    getPointBalance(db, user.id),
    activeMembership(db, user.id),
    listCendTaskStatuses(db, user.id),
    db.select().from(schema.cendCheckins).where(and(
      eq(schema.cendCheckins.userId, user.id),
      eq(schema.cendCheckins.checkinDate, today)
    )).limit(1).then(rows => rows[0] ?? null)
  ])

  return {
    user: {
      id: user.id,
      nickname: profile?.nickname ?? user.name,
      phone: user.phone
    },
    school: { id: cend.id, name: cend.name },
    profile: profile ?? null,
    points: { balance },
    membership: membership
      ? { tier: membership.tier, startAt: membership.startAt, endAt: membership.endAt }
      : null,
    checkin: checkin
      ? { checkinDate: checkin.checkinDate, streak: checkin.streak, reward: checkin.reward }
      : null,
    tasks
  }
})

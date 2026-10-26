import { getPointBalance, listCendTaskStatuses, recentCheckins } from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

/** C 端任务中心：任务状态、连续使用进度、近 7 天签到。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  await requireCendContext(event, user)
  const db = useDb(event)
  const [tasks, balance, checkins] = await Promise.all([
    listCendTaskStatuses(db, user.id),
    getPointBalance(db, user.id),
    recentCheckins(db, user.id, 7)
  ])
  return {
    balance,
    tasks,
    checkins: checkins.map(item => ({
      checkinDate: item.checkinDate,
      streak: item.streak,
      reward: item.reward
    }))
  }
})

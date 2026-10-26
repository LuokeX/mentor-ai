import { checkIn } from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { writeAudit } from '../../../utils/audit'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

/** 每日签到：东八区自然日唯一；第 7 天额外奖励。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const cend = await requireCendContext(event, user)
  const result = await checkIn(useDb(event), user.id)
  if (!result.already) {
    await writeAudit(event, {
      schoolId: cend.id,
      actorId: user.id,
      action: 'cend.checkin',
      targetType: 'user',
      targetId: user.id,
      metadata: { streak: result.streak, reward: result.reward }
    })
  }
  return {
    ok: true,
    already: result.already,
    streak: result.streak,
    reward: result.reward,
    balance: result.balance
  }
})

import { getPointBalance } from '../../../../domain/cend-points'
import { requireCendContext } from '../../../../domain/cend-school'
import { requireUser } from '../../../../utils/auth'
import { useDb } from '../../../../utils/db'

/** C 端积分余额（顶栏展示用；不含流水分页）。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  await requireCendContext(event, user)
  const db = useDb(event)
  return { balance: await getPointBalance(db, user.id) }
})

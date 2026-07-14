import { currentUser, destroySession } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  await destroySession(event)
  if (user) await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'auth.logout' })
  return { ok: true }
})

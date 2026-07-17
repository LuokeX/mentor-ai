import { requireUser } from '../../../utils/auth'
import { resolveAiGovernance } from '../../../domain/ai-governance'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  return resolveAiGovernance(event, user.schoolId, user.id)
})

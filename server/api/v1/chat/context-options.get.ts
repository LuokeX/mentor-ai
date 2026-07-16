import { requireUser } from '../../../utils/auth'
import { listAssistantContextOptions } from '../../../domain/assistant-context'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  return listAssistantContextOptions(event, user)
})

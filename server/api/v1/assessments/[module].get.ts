import { assessmentDefinitions } from '../../../../shared/assessments'
import { moduleIdSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  return assessmentDefinitions[module]
})

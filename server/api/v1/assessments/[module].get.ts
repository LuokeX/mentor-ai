import { moduleIdSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { resolveAssessmentDefinition } from '../../../domain/module-resources'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))

  const resolved = await resolveAssessmentDefinition(event, module, user.schoolId)
  return resolved.payload
})

import { z } from 'zod'
import { moduleIdSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { resolveAssessmentDefinition } from '../../../domain/module-resources'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const query = getQuery(event)
  const instrumentCode = typeof query.instrumentCode === 'string' ? query.instrumentCode : undefined

  const resolved = await resolveAssessmentDefinition(event, module, user.schoolId, instrumentCode)
  return resolved.payload
})

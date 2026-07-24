// GET /api/v1/assessments/[module]/instruments/[code] — 获取单个量表定义
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { resolveAssessmentDefinition } from '../../../../../domain/module-resources'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const code = z.string().min(1).max(200).parse(getRouterParam(event, 'code'))

  const resolved = await resolveAssessmentDefinition(event, module, user.schoolId, code)
  return resolved.payload
})
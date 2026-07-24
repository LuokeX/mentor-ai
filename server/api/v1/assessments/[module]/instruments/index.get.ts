// GET /api/v1/assessments/[module]/instruments — 列出模块下所有量表
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { listAssessmentInstruments } from '../../../../../domain/module-resources'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const instruments = await listAssessmentInstruments(event, module, user.schoolId)
  return {
    instruments: instruments.map(i => ({
      code: i.code,
      title: i.title,
      description: i.description,
      questionCount: i.questions.length,
      estimatedMinutes: i.estimatedMinutes,
    }))
  }
})

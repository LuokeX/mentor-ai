// GET /api/v1/assessments/[module]/instruments — 列出模块下所有量表及其可选状态
//
// 状态判定见 server/domain/assessment-instruments.ts：
// 前置量表未完成 → locked（留空视为放行）；已完成互斥量表 → locked；做过 → completed。
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { listInstrumentOptions } from '../../../../../domain/assessment-instruments'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const instruments = await listInstrumentOptions(event, module, user)
  return { instruments }
})

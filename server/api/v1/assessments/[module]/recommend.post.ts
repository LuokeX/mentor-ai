// POST /api/v1/assessments/[module]/recommend — 按教师描述推荐做哪张量表
//
// 用于两个入口：
//   1. 首页 AI 分诊后进入模块，带上教师原话，让 AI 挑一张
//   2. 教师直接点进模块（不带描述），走规则兜底推必做那张
// 返回值同时包含完整的量表列表与门禁状态，前端一次请求即可渲染选择器。
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { recommendInstrument } from '../../../../domain/instrument-recommendation'

const bodySchema = z.object({
  text: z.string().trim().max(2000).optional(),
  sourceChatSessionId: z.string().uuid().optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event).catch(() => ({})))

  return recommendInstrument(event, {
    module,
    text: body.text,
    user,
    sessionId: body.sourceChatSessionId ?? null
  })
})

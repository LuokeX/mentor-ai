import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { buildAssistantBusinessContext } from '../../../../../domain/assistant-context'
import { bindChatSessionContext } from '../../../../../domain/chat-session-binding'

/**
 * 把某个咨询对象固定为当前会话的绑定对象（「本次按 X 回答」旁的按钮）。
 *
 * 场景：教师没有用 @ 选对象，但消息里写了学生姓名，助手按本轮对象回答；
 * 教师认可后点「固定为本会话对象」，后续轮次（跨会话记忆、方案与评估收口）都按它走。
 *
 * 归属：目标对象由 buildAssistantBusinessContext 按 schoolId + ownerUserId 校验，
 * 会话归属由 bindChatSessionContext 校验；两者任一不符都返回 404，不暴露越权目标是否存在。
 */
const bodySchema = z.object({
  contextType: z.enum(['student', 'class', 'guardian']),
  contextId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const sessionId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))

  const context = await buildAssistantBusinessContext(event, user, body.contextType, body.contextId)
  if (!context) throw createError({ statusCode: 404, message: '咨询对象不存在或不属于当前负责范围' })

  await bindChatSessionContext(event, {
    sessionId,
    userId: user.id,
    schoolId: user.schoolId,
    target: { type: context.type, id: context.id, label: context.label }
  })
  return { context: { type: context.type, id: context.id, label: context.label } }
})

import { z } from 'zod'
import { CHAT_CONTEXT_MAX, chatContextTypeSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { resolveAssistantContextRefs } from '../../../../../domain/assistant-context'
import { bindChatSessionContext } from '../../../../../domain/chat-session-binding'

/**
 * 把一组咨询对象固定为当前会话的绑定对象（「本次按 X 回答」旁的按钮）。
 *
 * 场景：教师没有用 @ 选对象，但消息里写了一个/多个学生姓名，助手按本轮对象回答；
 * 教师认可后点「固定为本会话对象」，后续轮次（跨会话记忆、方案与评估收口）都按这组对象走。
 *
 * 归属：目标对象由 resolveAssistantContextRefs 按 schoolId + ownerUserId 校验，
 * 会话归属由 bindChatSessionContext 校验；两者任一不符都返回 404，不暴露越权目标是否存在。
 */
const bodySchema = z.object({
  /** 单对象写法（历史前端）：等价于 contexts 只有一项 */
  contextType: chatContextTypeSchema.optional(),
  contextId: z.string().uuid().optional(),
  /** 对象集写法（首个为主对象） */
  contexts: z.array(z.object({
    type: chatContextTypeSchema,
    id: z.string().uuid()
  })).min(1).max(CHAT_CONTEXT_MAX).optional()
}).superRefine((value, context) => {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    context.addIssue({ code: 'custom', path: ['contextId'], message: 'contextType 和 contextId 必须同时提供' })
  }
  if (!value.contexts?.length && !value.contextType) {
    context.addIssue({ code: 'custom', path: ['contexts'], message: '请提供咨询对象' })
  }
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const sessionId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))

  const targets = await resolveAssistantContextRefs(
    event,
    user,
    body.contexts?.length
      ? body.contexts
      : (body.contextType && body.contextId ? [{ type: body.contextType, id: body.contextId }] : [])
  )
  if (!targets.length) throw createError({ statusCode: 404, message: '咨询对象不存在或不属于当前负责范围' })

  await bindChatSessionContext(event, {
    sessionId,
    userId: user.id,
    schoolId: user.schoolId,
    targets
  })
  // context 保留为主对象别名，兼容既有前端渲染
  return { context: targets[0], contexts: targets }
})

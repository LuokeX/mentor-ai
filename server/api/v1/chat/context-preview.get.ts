import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { buildAssistantBusinessContext } from '../../../domain/assistant-context'
import { governBusinessContext, resolveAiGovernance } from '../../../domain/ai-governance'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = getQuery(event)
  const type = z.enum(['student', 'class', 'guardian']).parse(query.type)
  const id = z.string().uuid().parse(query.id)
  const context = await buildAssistantBusinessContext(event, user, type, id)
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  const preview = governBusinessContext(context, governance.effectiveMode === 'local' ? 'redacted' : governance.effectiveMode)
  return {
    mode: governance.effectiveMode,
    noticeVersion: governance.noticeVersion,
    needsConsent: governance.needsConsent,
    context: preview ? { type: preview.type, label: preview.label, snapshot: preview.snapshot } : null,
    excludedFields: ['电话', '邮箱', '账号', '系统标识', '密码与密钥', '动态验证码']
  }
})

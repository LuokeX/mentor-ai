import { eq } from 'drizzle-orm'
import { surveyFeedbackSettingsPatchSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { schema, useDb } from '../../../utils/db'

/** 更新调研反馈入口配置（平台后台）：url 为 null = 清空并隐藏按钮。未传字段保留原值。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = surveyFeedbackSettingsPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })

  const db = useDb(event)
  const [existing] = await db.select({
    id: schema.surveyFeedbackSettings.id,
    enabled: schema.surveyFeedbackSettings.enabled,
    title: schema.surveyFeedbackSettings.title,
    url: schema.surveyFeedbackSettings.url
  }).from(schema.surveyFeedbackSettings).limit(1)

  const values = {
    enabled: parsed.data.enabled ?? existing?.enabled ?? true,
    title: parsed.data.title ?? existing?.title ?? '调研反馈',
    url: parsed.data.url !== undefined ? parsed.data.url : (existing?.url ?? null),
    updatedBy: admin.id
  }
  const [row] = existing
    ? await db.update(schema.surveyFeedbackSettings).set(values).where(eq(schema.surveyFeedbackSettings.id, existing.id)).returning()
    : await db.insert(schema.surveyFeedbackSettings).values(values).returning()
  if (!row) throw createError({ statusCode: 500, message: '调研反馈配置保存失败' })

  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.survey_feedback.update',
    targetType: 'survey_feedback_settings',
    targetId: row.id,
    metadata: { fields: Object.keys(parsed.data) }
  })
  return { enabled: row.enabled, title: row.title, url: row.url }
})
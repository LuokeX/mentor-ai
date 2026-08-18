import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const DEFAULT_TITLE = '调研反馈'
const DEFAULT_URL = 'https://v.wjx.cn/vm/tUqBMOv.aspx#'

/** 调研反馈入口配置（任意登录角色可读）：无配置行时返回内置默认值。 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const db = useDb(event)
  const [row] = await db.select({
    enabled: schema.surveyFeedbackSettings.enabled,
    title: schema.surveyFeedbackSettings.title,
    url: schema.surveyFeedbackSettings.url
  }).from(schema.surveyFeedbackSettings).limit(1)

  return row
    ? { initialized: true, enabled: row.enabled, title: row.title, url: row.url }
    : { initialized: false, enabled: true, title: DEFAULT_TITLE, url: DEFAULT_URL }
})
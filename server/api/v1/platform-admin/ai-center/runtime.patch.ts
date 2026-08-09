import { eq } from 'drizzle-orm'
import { aiRuntimeSettingsPatchSchema } from '../../../../../shared/contracts'
import { invalidateAiConfigCache } from '../../../../domain/ai-config'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

/** 更新运行时 AI 配置：null = 回落环境变量。立即热生效（失效缓存）。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = aiRuntimeSettingsPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.aiRuntimeSettings.id }).from(schema.aiRuntimeSettings).limit(1)
  const values = {
    routerModel: parsed.data.routerModel ?? null,
    generatorModel: parsed.data.generatorModel ?? null,
    timeoutMs: parsed.data.timeoutMs ?? null,
    embeddingModel: parsed.data.embeddingModel ?? null,
    embeddingEnabled: parsed.data.embeddingEnabled ?? null,
    updatedBy: admin.id
  }
  const [row] = existing
    ? await db.update(schema.aiRuntimeSettings).set(values).where(eq(schema.aiRuntimeSettings.id, existing.id)).returning()
    : await db.insert(schema.aiRuntimeSettings).values(values).returning()
  if (!row) throw createError({ statusCode: 500, message: '运行时配置保存失败' })
  invalidateAiConfigCache()
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.runtime.update',
    targetType: 'ai_runtime_settings',
    targetId: row.id,
    metadata: { fields: Object.keys(parsed.data).filter(key => parsed.data[key as keyof typeof parsed.data] !== undefined) }
  })
  return row
})
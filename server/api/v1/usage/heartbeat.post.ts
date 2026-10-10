/**
 * 平台使用量 · 活跃心跳（PRD 8.3 S2 的数据源）。
 *
 * 客户端在页面可见时每 USAGE_HEARTBEAT_INTERVAL_SECONDS 秒调用一次，本接口：
 * - 只接受已登录账号（走 currentAuth，同时拿到会话 id）；未关联学校（平台管理员）不落库，直接返回 recorded: false；
 * - 按 (用户, 会话) 做服务端节流：窗口内已有心跳就跳过，保证同一会话最多每 5 分钟一条，
 *   客户端重试/多标签页也不会重复计数；
 * - 只写低敏产品事件 platform_active_beat（metadata 仅含会话 id），不含任何业务内容。
 *
 * 聚合口径见 shared/school-usage.ts 顶部注释与 server/domain/platform-usage.ts。
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { USAGE_HEARTBEAT_INTERVAL_SECONDS } from '../../../../shared/school-usage'
import { currentAuth } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'
import { trackProductEvent } from '../../../domain/product-events'
import { USAGE_HEARTBEAT_EVENT } from '../../../domain/platform-usage'

/**
 * 节流窗口：略小于上报间隔（留 60 秒容差），
 * 既避免客户端时钟与网络抖动造成重复写入，也避免被高频调用刷数据。
 */
const THROTTLE_WINDOW_MS = (USAGE_HEARTBEAT_INTERVAL_SECONDS - 60) * 1000

export default defineEventHandler(async (event) => {
  const auth = await currentAuth(event)
  if (!auth) throw createError({ statusCode: 401, message: '请先登录' })
  // 平台管理员不属于任何学校：不计入学校的使用量口径，也不写事件
  if (!auth.user.schoolId) return { ok: true, recorded: false }

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.productEvents.id })
    .from(schema.productEvents)
    .where(and(
      eq(schema.productEvents.userId, auth.user.id),
      eq(schema.productEvents.eventName, USAGE_HEARTBEAT_EVENT),
      gte(schema.productEvents.createdAt, new Date(Date.now() - THROTTLE_WINDOW_MS)),
      sql`${schema.productEvents.metadata}->>'session' = ${auth.sessionId}`
    ))
    .limit(1)
  if (existing) return { ok: true, recorded: false }

  await trackProductEvent(event, {
    schoolId: auth.user.schoolId,
    userId: auth.user.id,
    eventName: USAGE_HEARTBEAT_EVENT,
    metadata: { session: auth.sessionId }
  }, db)
  return { ok: true, recorded: true }
})

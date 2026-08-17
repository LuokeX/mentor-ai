import type { H3Event } from 'h3'
import { schema, useDb, type DbClient } from '../utils/db'

const allowedMetadataTypes = new Set(['string', 'number', 'boolean'])

/**
 * 产品事件只允许低敏、可聚合字段。调用失败不得影响核心业务。
 */
export async function trackProductEvent(event: H3Event, input: {
  schoolId?: string | null
  userId?: string | null
  eventName: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}, db: DbClient = useDb(event)) {
  const metadata = Object.fromEntries(Object.entries(input.metadata || {})
    .filter(([, value]) => value === null || allowedMetadataTypes.has(typeof value))
    .slice(0, 20)) as Record<string, string | number | boolean | null>
  await db.insert(schema.productEvents).values({
    schoolId: input.schoolId || null,
    userId: input.userId || null,
    eventName: input.eventName.slice(0, 80),
    targetType: input.targetType,
    targetId: input.targetId,
    metadata
  }).catch(() => undefined)
}

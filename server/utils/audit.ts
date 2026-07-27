import type { H3Event } from 'h3'
import { getRequestIP } from 'h3'
import { useDb, schema } from './db'

export async function writeAudit(event: H3Event, input: {
  schoolId?: string | null
  actorId?: string | null
  action: string
  targetType?: string
  targetId?: string
  result?: 'success' | 'denied' | 'failure'
  metadata?: Record<string, unknown>
}, db = useDb(event)) {
  await db.insert(schema.auditLogs).values({
    schoolId: input.schoolId || null,
    actorId: input.actorId || null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    result: input.result || 'success',
    ipAddress: getRequestIP(event, { xForwardedFor: true }) || null,
    metadata: input.metadata || {}
  })
}

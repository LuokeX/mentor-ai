import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import type { AssistantBusinessContext } from './assistant-context'
import { redactPii } from '../integrations/deepseek'
import { schema, useDb } from '../utils/db'

export type AiDataMode = 'local' | 'redacted' | 'full_context'

const forbiddenKey = /(phone|email|account|password|secret|token|totp|uuid|(^|_)id$|Id$)/i

function sanitizeValue(value: unknown, mode: Exclude<AiDataMode, 'local'>, key = ''): unknown {
  if (forbiddenKey.test(key)) return undefined
  if (typeof value === 'string') {
    const safe = value
      .replace(/1[3-9]\d{9}/g, '[PHONE]')
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[SYSTEM_ID]')
      .replace(/(?:密码|密钥|token|secret|totp)\s*[:：=]?\s*\S+/gi, '[SECRET]')
    return (mode === 'redacted' ? redactPii(safe) : safe).slice(0, 2500)
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, mode)).filter(item => item !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, sanitizeValue(child, mode, childKey)])
      .filter(([, child]) => child !== undefined))
  }
  return value
}

export async function resolveAiGovernance(event: H3Event, schoolId: string, userId: string) {
  const db = useDb(event)
  const [settings] = await db.select().from(schema.schoolSettings)
    .where(eq(schema.schoolSettings.schoolId, schoolId)).limit(1)
  const requestedMode = (settings?.aiDataMode || 'redacted') as AiDataMode
  const noticeVersion = settings?.aiNoticeVersion || 'pilot-v1'
  const agreementVersion = String(useRuntimeConfig(event).deepseekAgreementVersion || '')
  const [consent] = await db.select({ id: schema.userConsents.id }).from(schema.userConsents).where(and(
    eq(schema.userConsents.userId, userId),
    eq(schema.userConsents.noticeVersion, noticeVersion),
    eq(schema.userConsents.dataMode, 'full_context'),
    isNull(schema.userConsents.revokedAt)
  )).limit(1)
  const fullContextReady = Boolean(
    requestedMode === 'full_context' &&
    settings?.aiApprovedAt &&
    settings.aiApprovalReference?.trim() &&
    agreementVersion &&
    consent
  )
  return {
    requestedMode,
    effectiveMode: (fullContextReady ? 'full_context' : requestedMode === 'local' ? 'local' : 'redacted') as AiDataMode,
    noticeVersion,
    agreementVersion,
    needsConsent: requestedMode === 'full_context' && !consent,
    fullContextReady
  }
}

export function governBusinessContext(context: AssistantBusinessContext | null, mode: AiDataMode) {
  if (!context || mode === 'local') return context
  const snapshot = sanitizeValue(context.snapshot, mode) as Record<string, unknown>
  return {
    ...context,
    id: '',
    label: mode === 'redacted' ? redactPii(context.label) : context.label,
    prompt: JSON.stringify(snapshot),
    snapshot
  }
}

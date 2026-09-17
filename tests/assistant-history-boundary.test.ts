import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
const { queries } = vi.hoisted(() => ({ queries: [] as unknown[] }))
vi.mock('../server/utils/db', async () => {
  const original = await vi.importActual<typeof import('../server/utils/db')>('../server/utils/db')
  return { ...original, useDb: () => ({ select: () => ({ from: () => ({ where: (query: unknown) => {
    queries.push(query); return { orderBy: () => ({ limit: async () => [] }) }
  } }) }) }) }
})
import { loadSessionHistoryForAgent } from '../server/domain/chat-stream'
const args = { event: {} as never, user: { id: 'teacher', schoolId: 'school' }, sessionId: 'session', contextSummary: null, summaryUptoAt: null, historyBudgetTokens: 24000, compactionKeepRatio: 0.5, dataMode: 'redacted' as const }
beforeEach(() => { queries.length = 0; vi.stubGlobal('useRuntimeConfig', () => ({ encryptionKey: 'test' })) })
it('普通/重新生成只装载目标提问之前、切换对象之后的本校本人消息', async () => {
  const before = new Date('2026-09-16T02:00:00Z')
  const since = new Date('2026-09-16T01:00:00Z')
  await loadSessionHistoryForAgent({ ...args, before, objectSince: since })
  const query = new PgDialect().sqlToQuery(queries[0] as never)
  expect(query.sql).toContain('"school_id"')
  expect(query.sql).toContain('"owner_user_id"')
  expect(query.sql).toContain('"created_at" <')
  expect(query.sql).toContain('"created_at" >=')
  expect(query.params).toContain(before.toISOString())
  expect(query.params).toContain(since.toISOString())
})
it('不带档案时排除助手旧回答/工具轨迹与旧摘要', async () => {
  const result = await loadSessionHistoryForAgent({ ...args, withoutRecord: true, contextSummary: '历史档案摘要', summaryUptoAt: new Date('2026-09-15') })
  expect(result.contextSummary).toBeNull()
  const query = new PgDialect().sqlToQuery(queries[0] as never)
  expect(query.sql).toContain('"role" =')
  expect(query.params).toContain('user')
})
it('换对象后不使用旧对象的结构化摘要', async () => {
  const result = await loadSessionHistoryForAgent({ ...args, objectSince: new Date('2026-09-16'), contextSummary: JSON.stringify({ version: 1, entries: [{ kind: 'fact', text: '旧对象事实', sourceId: 'old', occurredAt: '2026-09-15', sourceRole: 'user' }] }), summaryUptoAt: new Date('2026-09-15') })
  expect(result.contextSummary).toBeNull()
})

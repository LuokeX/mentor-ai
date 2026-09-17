import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { budgetText, serializeToolOutput, toolOutcome } from '../server/agent/tool-output'
import { AnswerDelivery } from '../server/agent/answer-delivery'
import { collectToolEvidence, inspectEvidenceClaims } from '../server/agent/evidence'
import { rankMemory, validateMemory } from '../server/domain/chat-memory'
import { buildAgentTools } from '../server/agent/tools'
import { assessmentNavigation, planNavigation } from '../server/agent/navigation'
import { assistantNavigationSchema } from '../shared/assistant'
import { searchKnowledgeChunksHybrid, type DrizzleDB } from '../server/domain/module-resource-knowledge-search'
import { scenarios } from '../scripts/ai-evaluation/scenarios'

describe('助手升级：边界与有效输出', () => {
  it('模型能读到300字之后的关键步骤，且不会给模型残缺JSON', () => {
    const content = '背景说明。'.repeat(65) + '\n关键步骤：让学生圈出条件，再解释算式。'
    expect(budgetText(content, 2000).text).toContain('关键步骤')
    const output = JSON.parse(serializeToolOutput({ items: [{ content: '长'.repeat(20000) }] }))
    expect(output.status).toBe('error')
    expect(output.truncated).toBe(true)
    expect(budgetText('完整句。不能切开的超长段落', 9)).toEqual({ text: '完整句。', truncated: true })
  })
  it('区分空结果与查询失败', () => {
    expect(toolOutcome({ plans: [] })).toBe('empty')
    expect(toolOutcome({ status: 'error', plans: [] })).toBe('error')
    expect(toolOutcome({ status: 'timeout' })).toBe('timeout')
  })
  it('逐句释放：命中复核词的句子单独扣住，其余句子照常流出', () => {
    const shown: string[] = []
    let holds = 0
    const stream = new AnswerDelivery('怎么沟通？', text => shown.push(text), () => { holds += 1 })
    stream.push('可以先听他描述')
    expect(shown).toEqual([])
    expect(holds).toBe(0)
    stream.push('困难。平台规'); stream.push('定总分是99。')
    // 无问题的句子正常释放；命中「规定/总分」的句子被扣住，不进入流式文本
    expect(shown).toEqual(['可以先听他描述困难。'])
    expect(stream.requiresReview).toBe(true)
    expect(holds).toBe(1)
    // 扣住一句不影响后面的内容：继续逐句流出
    stream.push('后面还有内容。')
    expect(shown).toEqual(['可以先听他描述困难。', '后面还有内容。'])
    // 再次扣住时再次提示（前端据此在静默时挂起状态条）
    stream.push('平台规定要跟进。')
    expect(shown).toEqual(['可以先听他描述困难。', '后面还有内容。'])
    expect(holds).toBe(2)

    // 教师提问命中复核词只决定「本轮要整轮校验」，不扣住回答内容、也不提示
    let questionHolds = 0
    const byQuestion = new AnswerDelivery('上次量表结果是什么？', text => shown.push(text), () => { questionHolds += 1 })
    byQuestion.push('先说结论。')
    expect(byQuestion.requiresReview).toBe(true)
    expect(questionHolds).toBe(0)
    expect(shown).toHaveLength(3)
  })
  it('来源存在不等于规则数字正确；失败工具不构成依据', () => {
    const evidence = collectToolEvidence('assessment_history', { submitted: [{ level: 'L1', score: 3 }] })
    expect(inspectEvidenceClaims('总分是33。等级为L3。', evidence)).toContain('rule_value_mismatch')
    expect(inspectEvidenceClaims('平台规定必须执行。', evidence)).toContain('missing_policy_evidence')
    expect(collectToolEvidence('knowledge_search', { status: 'error', items: [] })[0]?.kind).toBe('observation')
  })
  it('摘要拒绝伪造来源或把助手建议当成已执行事实，兼容旧摘要', () => {
    const source = { id: 'm1', createdAt: '2026-09-15T00:00:00Z', role: 'assistant' as const, content: '可以先单独沟通' }
    const entry = { sourceId: source.id, occurredAt: source.createdAt, sourceRole: source.role, text: source.content, kind: 'attempt' }
    expect(validateMemory(JSON.stringify({ version: 1, entries: [entry] }), [source], null)).toBeNull()
    expect(validateMemory(JSON.stringify({ version: 1, entries: [{ ...entry, kind: 'hypothesis' }] }), [source], '旧摘要')).not.toBeNull()
    expect(validateMemory(JSON.stringify({ version: 1, entries: [{ ...entry, sourceId: 'fake' }] }), [source], null)).toBeNull()
  })
  it('相关旧经历能被找回，并保留最近纠正', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ content: i === 19 ? '便签求助试过无效' : i === 0 ? '更正：主要是看不清黑板' : '其他事情', createdAt: new Date(2026, 0, 20 - i) }))
    expect(rankMemory(rows, '便签求助', 3).map(r => r.content)).toContain('便签求助试过无效')
    expect(rankMemory(rows, '便签求助', 3).map(r => r.content)).toContain('更正：主要是看不清黑板')
  })
  it('不带档案时不提供可读取档案或历史的工具', () => {
    const tools = buildAgentTools({ schoolId: 's', userId: 'u', sessionId: 'c', withoutRecord: true })
    expect(tools.map(t => t.name)).toEqual(['knowledge_search', 'module_route', 'resource_lookup'])
  })
  it('评估导航使用评估组ID，并拒绝模型任意URL', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const cards = assessmentNavigation({ submitted: [{ sessionId: id, module: 'self_growth' } as never], drafts: [], openSessions: [] }, '查看结果')
    expect(cards[0]?.to).toBe(`/assessments/${id}`)
    expect(assessmentNavigation({ submitted: [{ id } as never], drafts: [], openSessions: [] }, '')).toEqual([])
    expect(assistantNavigationSchema.safeParse({ ...cards[0], to: 'https://evil.example' }).success).toBe(false)
    expect(planNavigation([{ id, module: 'self_growth', title: '方案', status: 'review_due' } as never], '复盘')[0]?.to).toBe(`/plans/${id}#review`)
  })
  it('向量与关键词召回都使用发布状态、文档关联和学校范围', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = []
    const db = { execute: async (query: never) => { queries.push(new PgDialect().sqlToQuery(query)); return { rows: [] } } } as unknown as DrizzleDB
    await searchKnowledgeChunksHybrid(db, '合作方法', [1, 0], { schoolId: 'school-a', module: 'home_school' })
    expect(queries).toHaveLength(2)
    for (const q of queries) {
      expect(q.sql).toContain("v.status = 'published'")
      expect(q.sql).toContain("d.status = 'ready'")
      expect(q.sql).toContain('d.version_id = c.version_id')
      expect(q.sql).toContain("l.scope = 'school'")
      expect(q.params).toContain('school-a')
    }
  })
  it('评测覆盖五模块50场景，其中30个多轮、10个演示', () => {
    expect(scenarios).toHaveLength(50)
    expect(new Set(scenarios.map(s => JSON.stringify(s.turns))).size).toBe(50)
    expect(scenarios.filter(s => s.turns.length >= 4 && s.turns.length <= 8)).toHaveLength(30)
    expect(scenarios.filter(s => s.demo)).toHaveLength(10)
    for (const module of new Set(scenarios.map(s => s.module))) expect(scenarios.filter(s => s.module === module)).toHaveLength(10)
  })
})

import { describe, expect, it } from 'vitest'
import { buildInstrumentReason, pickInstrumentOption } from '../server/agent/tools/recommend-assessment'
import { getModulePlaybook, getModulePlaybookText, PLAYBOOK_BOUNDARY } from '../server/agent/module-playbooks'
import { classOverviewTool } from '../server/agent/tools/class-overview'
import { entityMemoryTool } from '../server/agent/tools/entity-memory'
import { planLookupTool } from '../server/agent/tools/plan-lookup'
import { resourceLookupTool } from '../server/agent/tools/resource-lookup'
import { teacherBriefTool } from '../server/agent/tools/teacher-brief'
import type { InstrumentOption } from '../server/domain/assessment-instruments'
import type { AgentToolContext } from '../server/agent/types'

const ctx = {
  event: {},
  user: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' }
} as unknown as AgentToolContext

function option(over: Partial<InstrumentOption>): InstrumentOption {
  return {
    code: 'SG_S1',
    title: '双维速查',
    shortName: null,
    description: '',
    questionCount: 12,
    estimatedMinutes: 4,
    role: null,
    isRequired: false,
    usageTiming: null,
    prerequisiteCodes: [],
    exclusiveCodes: [],
    status: 'available',
    triggerCondition: null,
    triggerConditionNote: null,
    triggerHit: false,
    triggerError: null,
    missingPrerequisites: [],
    blockingExclusives: [],
    lastSubmittedAt: null,
    lastLevel: null,
    lastLevelName: null,
    frequency: null,
    lastAverage: null,
    triggerEvidence: [],
    order: 0,
    ...over
  }
}

describe('量表推荐的确定性挑选', () => {
  it('优先业务判定「现在该做」的量表', () => {
    const picked = pickInstrumentOption([
      option({ code: 'A', status: 'available' }),
      option({ code: 'B', status: 'suggested' })
    ])
    expect(picked?.code).toBe('B')
  })

  it('没有 suggested 时优先必做且未被锁的量表', () => {
    const picked = pickInstrumentOption([
      option({ code: 'A', status: 'available' }),
      option({ code: 'B', status: 'not_needed', isRequired: true }),
      option({ code: 'C', status: 'completed', isRequired: true })
    ])
    expect(picked?.code).toBe('B')
  })

  it('只有被锁的量表时选不出（由调用方改推前置）', () => {
    expect(pickInstrumentOption([option({ code: 'A', status: 'locked' })])).toBeNull()
    expect(pickInstrumentOption([])).toBeNull()
  })
})

describe('量表推荐理由', () => {
  it('带上题量与时长，并说明为什么先做这张', () => {
    const reason = buildInstrumentReason(option({ status: 'suggested', triggerConditionNote: '总分达到阈值' }), 'self_growth')
    expect(reason).toContain('12 题')
    expect(reason).toContain('约 4 分钟')
    expect(reason).toContain('自我成长')
    // 触发条件原文不再进入推荐理由：只说明「触发条件已命中」，不把规则写成结论
    expect(reason).not.toContain('总分达到阈值')
    expect(reason).toContain('触发条件已命中')
  })

  it('命中触发条件时用实测依据说明（分数/结论/时间），而不是复述规则', () => {
    const reason = buildInstrumentReason(option({
      status: 'suggested',
      triggerConditionNote: '六维评估均分低于 4.0（出现风险迹象）时建议做红线检查',
      triggerEvidence: [{
        code: 'HS_S1',
        title: '家校沟通六维评估',
        average: 3,
        levelName: '3级·中度（定向干预）',
        submittedAt: '2026-09-04T08:01:47.926Z'
      }]
    }), 'home_school')
    expect(reason).toContain('2026-09-04')
    expect(reason).toContain('家校沟通六维评估')
    expect(reason).toContain('均分 3.0')
    expect(reason).toContain('3级·中度（定向干预）')
    expect(reason).not.toContain('出现风险迹象')
  })

  it('被前置锁住时说明改推原因', () => {
    const reason = buildInstrumentReason(option({ code: 'PRE' }), 'student_case', option({ code: 'DEEP', title: '深度诊断' }))
    expect(reason).toContain('深度诊断')
    expect(reason).toContain('先完成前置量表')
  })

  it('已做过的量表提示可重测，且不出现诊断性表述', () => {
    const reason = buildInstrumentReason(option({ lastSubmittedAt: '2026-08-01T00:00:00.000Z' }), 'home_school')
    expect(reason).toContain('重测')
    expect(reason).not.toMatch(/确诊|诊断|治愈/)
  })
})

describe('模块指导（playbook）', () => {
  it('五个模块都有指导文本，并统一带上边界声明', () => {
    for (const module of ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'] as const) {
      const text = getModulePlaybookText(module)
      expect(text.length).toBeGreaterThan(80)
      expect(text).toContain(PLAYBOOK_BOUNDARY)
    }
  })

  it('未知模块回退通用指导而不是抛错', () => {
    expect(getModulePlaybook('unknown_module')).toContain('建议动作路径')
    expect(getModulePlaybook(null)).toContain('建议动作路径')
  })

  it('指导文本不含具体分数阈值（阈值由确定性规则计算）', () => {
    for (const module of ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'] as const) {
      const text = getModulePlaybook(module)
      expect(text).not.toMatch(/\d+\s*分/)
      expect(text).not.toMatch(/确诊|抑郁症/)
    }
  })
})

describe('工具参数校验：非法参数返回空结果而不是抛错', () => {
  it('plan_lookup 参数非法时返回空方案与提示', async () => {
    const result = await planLookupTool.execute({ studentId: 'not-a-uuid' }, ctx) as { plans: unknown[], message?: string }
    expect(result.plans).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('class_overview 参数非法时返回空班级与提示', async () => {
    const result = await classOverviewTool.execute({ className: 'x' }, ctx) as { classes: unknown[], message?: string }
    expect(result.classes).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('resource_lookup 缺少必填模块时返回提示', async () => {
    const result = await resourceLookupTool.execute({}, ctx) as { items: unknown[], message?: string }
    expect(result.items).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('teacher_brief 无参数工具在读取失败时返回空简报而不是抛错', async () => {
    // ctx.event 是空对象：读取会抛错，工具必须吞掉异常并返回空简报
    const result = await teacherBriefTool.execute({}, ctx) as {
      overdueActions: unknown[]
      upcomingReviews: unknown[]
      unreadNotifications: number
    }
    expect(result.overdueActions).toEqual([])
    expect(result.upcomingReviews).toEqual([])
    expect(result.unreadNotifications).toBe(0)
  })

  it('entity_memory 未绑定对象且未给参数时返回提示，不读取任何跨会话内容', async () => {
    const result = await entityMemoryTool.execute({}, ctx) as { memories: unknown[], message?: string }
    expect(result.memories).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('entity_memory 参数非法时返回提示而不是抛错', async () => {
    const result = await entityMemoryTool.execute({ contextId: 'not-a-uuid' }, ctx) as { memories: unknown[], message?: string }
    expect(result.memories).toEqual([])
    expect(result.message).toBeTruthy()
  })
})

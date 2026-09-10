import { describe, expect, it } from 'vitest'
import {
  mergePlanActionDisplay,
  splitAttributionLabels,
  type PlanActionDisplayAction,
  type PlanToolPlacement
} from '../server/domain/plan-action-display'

function action(overrides: Partial<PlanActionDisplayAction>): PlanActionDisplayAction {
  return {
    id: overrides.id || 'a-1',
    sequence: overrides.sequence ?? 0,
    title: overrides.title || '针对「意义感流失」',
    detail: overrides.detail || '建议',
    decision: overrides.decision || 'pending',
    status: overrides.status || 'pending',
    dueAt: overrides.dueAt ?? null,
    completedAt: overrides.completedAt ?? null,
    executedAt: overrides.executedAt ?? null,
    executionNote: overrides.executionNote ?? null,
    ...overrides
  }
}

describe('splitAttributionLabels', () => {
  it('拆分「;」「；」「，」等分隔的多值归因清单并去重', () => {
    expect(splitAttributionLabels('意义感流失;效能感不足')).toEqual(['意义感流失', '效能感不足'])
    expect(splitAttributionLabels('意义感流失；效能感不足，意义感流失')).toEqual(['意义感流失', '效能感不足'])
    expect(splitAttributionLabels('  意义感流失  ')).toEqual(['意义感流失'])
    expect(splitAttributionLabels('')).toEqual([])
    expect(splitAttributionLabels(null)).toEqual([])
  })
})

describe('mergePlanActionDisplay', () => {
  it('把同一归因下的「使用工具」并进「针对归因」条，并移除独立的工具行', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「家校沟通冲突升级」', detail: '做一次周复盘' }),
      action({ id: 'tool-1', title: '使用工具「三步降温沟通卡」', detail: '1. 接住情绪…' }),
      action({ id: 'tool-2', title: '使用工具「边界话术」', detail: '1. 复述事实…' }),
      action({ id: 'grading-1', title: '按「橙色-高响应」干预', detail: '启动 S2 评估' })
    ]
    const binding = new Map([
      ['三步降温沟通卡', ['家校沟通冲突升级']],
      ['边界话术', ['家校沟通冲突升级']]
    ])
    const result = mergePlanActionDisplay(actions, new Map(), ['家校沟通冲突升级'], 5, binding)
    const attr = result.find(item => item.id === 'attr-1')!
    expect(attr.mergedTools).toEqual([
      { title: '三步降温沟通卡', content: '1. 接住情绪…' },
      { title: '边界话术', content: '1. 复述事实…' }
    ])
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
    expect(result.some(item => item.id === 'tool-2')).toBe(false)
    expect(result.some(item => item.id === 'grading-1')).toBe(true)
  })

  it('工具声明多个归因时，并入方案里第一个匹配的归因，不在多条归因下重复展示', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'attr-2', title: '针对「效能感不足」', detail: 'b' }),
      action({ id: 'tool-1', title: '使用工具「贡献清单」', detail: '1. 步骤' })
    ]
    const binding = new Map([['贡献清单', ['意义感流失', '效能感不足']]])
    const result = mergePlanActionDisplay(actions, new Map(), ['意义感流失', '效能感不足'], 3, binding)
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '贡献清单', content: '1. 步骤' }
    ])
    expect(result.find(item => item.id === 'attr-2')?.mergedTools).toBeUndefined()
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
  })

  it('同一工具重复落库时按标题去重，只保留首次正文', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'tool-1', title: '使用工具「贡献清单」', detail: '首次正文' }),
      action({ id: 'tool-2', title: '使用工具「贡献清单」', detail: '重复正文' })
    ]
    const binding = new Map([['贡献清单', ['意义感流失']]])
    const result = mergePlanActionDisplay(actions, new Map(), ['意义感流失'], 3, binding)
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '贡献清单', content: '首次正文' }
    ])
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
    expect(result.some(item => item.id === 'tool-2')).toBe(false)
  })

  it('无绑定归因的工具行降级保留原样单独展示（按标题去重）', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: '建议' }),
      action({ id: 'tool-1', title: '使用工具「未绑定工具」', detail: '1. 步骤' }),
      action({ id: 'tool-2', title: '使用工具「未绑定工具」', detail: '1. 重复' })
    ]
    const result = mergePlanActionDisplay(actions, new Map(), ['意义感流失'], 5)
    expect(result.filter(item => item.id === 'tool-1' || item.id === 'tool-2').length).toBe(1)
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toBeUndefined()
  })

  it('可执行条目（归因 + 等级干预）截断到 3 条，等级干预优先保留，其余按归因占比降序', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'grading-1', title: '按「橙色」干预', detail: '整体处置' }),
      action({ id: 'attr-1', title: '针对「归因A」', detail: 'a' }),
      action({ id: 'attr-2', title: '针对「归因B」', detail: 'b' }),
      action({ id: 'attr-3', title: '针对「归因C」', detail: 'c' }),
      action({ id: 'attr-4', title: '针对「归因D」', detail: 'd' }),
      action({ id: 'attr-5', title: '针对「归因E」', detail: 'e' })
    ]
    const order = ['归因A', '归因B', '归因C', '归因D', '归因E']
    const result = mergePlanActionDisplay(actions, new Map(), order, 3)
    // 等级干预占 1 名，归因按占比顺序取前 2
    const titles = result.filter(item => item.id !== 'grading-1').map(item => item.title)
    expect(titles).toEqual(['针对「归因A」', '针对「归因B」'])
    expect(result.some(item => item.id === 'attr-3')).toBe(false)
    expect(result.some(item => item.id === 'attr-4')).toBe(false)
    expect(result.some(item => item.id === 'attr-5')).toBe(false)
    expect(result[0]!.id).toBe('grading-1')
  })

  it('深度诊断待办与手动新增不参与 3 条名额', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'suggest-1', title: '建议完成深度诊断「量表X」', detail: '待办', kind: 'instrument_suggestion' }),
      action({ id: 'manual-1', title: '教师补充行动', detail: '手动' }),
      action({ id: 'attr-1', title: '针对「归因A」', detail: 'a' })
    ]
    const result = mergePlanActionDisplay(actions, new Map(), ['归因A'], 3)
    expect(result.some(item => item.id === 'suggest-1')).toBe(true)
    expect(result.some(item => item.id === 'manual-1')).toBe(true)
    expect(result.some(item => item.id === 'attr-1')).toBe(true)
  })
})

describe('工具归属按生成来源合并（placement 优先，回退只兜底）', () => {
  it('归因通道带出的工具按 attributionName 并进对应归因条', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'attr-2', title: '针对「效能感不足」', detail: 'b' }),
      action({ id: 'tool-1', title: '使用工具「贡献清单」', detail: '1. 步骤' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['贡献清单', { channel: 'attribution', attributionName: '意义感流失' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, ['意义感流失', '效能感不足'])
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '贡献清单', content: '1. 步骤' }
    ])
    expect(result.find(item => item.id === 'attr-2')?.mergedTools).toBeUndefined()
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
  })

  it('等级直选工具并进第一条「按「等级」干预」条，不再混进归因', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'grading-1', title: '按「C级」干预', detail: '处置一' }),
      action({ id: 'grading-2', title: '按「C级」干预', detail: '处置二' }),
      action({ id: 'tool-1', title: '使用工具「强制委托清单」', detail: '1. 步骤' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['强制委托清单', { channel: 'intervention' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, ['意义感流失'])
    expect(result.find(item => item.id === 'grading-1')?.mergedTools).toEqual([
      { title: '强制委托清单', content: '1. 步骤' }
    ])
    expect(result.find(item => item.id === 'grading-2')?.mergedTools).toBeUndefined()
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toBeUndefined()
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
  })

  it('⑤e 只配工具没配等级干预动作时，工具降级为独立工具行不丢正文', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'tool-1', title: '使用工具「强制委托清单」', detail: '1. 步骤' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['强制委托清单', { channel: 'intervention' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, ['意义感流失'])
    expect(result.some(item => item.id === 'tool-1')).toBe(true)
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toBeUndefined()
  })

  it('目标归因行被 3 条上限截断时，其下工具随行隐藏', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'grading-1', title: '按「橙色」干预', detail: 'g' }),
      action({ id: 'attr-1', title: '针对「归因A」', detail: 'a' }),
      action({ id: 'attr-2', title: '针对「归因B」', detail: 'b' }),
      action({ id: 'attr-3', title: '针对「归因C」', detail: 'c' }),
      action({ id: 'tool-1', title: '使用工具「只服务C的工具」', detail: '1. 步骤' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['只服务C的工具', { channel: 'attribution', attributionName: '归因C' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, ['归因A', '归因B', '归因C'], 3)
    expect(result.some(item => item.id === 'attr-3')).toBe(false)
    expect(result.some(item => item.id === 'tool-1')).toBe(false)
  })

  it('有来源标记的工具不再走回退绑定；无标记的工具才用回退绑定', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'attr-1', title: '针对「意义感流失」', detail: 'a' }),
      action({ id: 'attr-2', title: '针对「效能感不足」', detail: 'b' }),
      action({ id: 'tool-1', title: '使用工具「有标记工具」', detail: '1. a' }),
      action({ id: 'tool-2', title: '使用工具「无标记工具」', detail: '1. b' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['有标记工具', { channel: 'attribution', attributionName: '效能感不足' }]
    ])
    const fallbackBinding = new Map([['有标记工具', ['意义感流失']], ['无标记工具', ['意义感流失']]])
    const result = mergePlanActionDisplay(actions, placement, ['意义感流失', '效能感不足'], 3, fallbackBinding)
    // 有标记的按 placement 挂到次归因，不被回退绑定改挂到主归因
    expect(result.find(item => item.id === 'attr-2')?.mergedTools).toEqual([
      { title: '有标记工具', content: '1. a' }
    ])
    // 无标记的走回退绑定
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '无标记工具', content: '1. b' }
    ])
  })
})

describe('单个动作下的配套工具上限', () => {
  function attributionWithTools(toolTitles: string[]): PlanActionDisplayAction[] {
    return [
      action({ id: 'attr-1', title: '针对「归属感缺失」', detail: '建议' }),
      ...toolTitles.map((title, index) => action({
        id: `tool-${index + 1}`,
        sequence: index + 1,
        title: `使用工具「${title}」`,
        detail: `1. ${title} 步骤`
      }))
    ]
  }

  function allAttributionPlacement(toolTitles: string[]): Map<string, PlanToolPlacement> {
    return new Map(toolTitles.map(title => [title, { channel: 'attribution' as const, attributionName: '归属感缺失' }]))
  }

  it('同一归因下工具超过 2 条时只并入优先级最高的前 2 条，其余随行隐藏', () => {
    const actions = attributionWithTools(['工具甲', '工具乙', '工具丙'])
    const result = mergePlanActionDisplay(actions, allAttributionPlacement(['工具甲', '工具乙', '工具丙']), ['归属感缺失'])
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '工具甲', content: '1. 工具甲 步骤' },
      { title: '工具乙', content: '1. 工具乙 步骤' }
    ])
    // 被截断的工具不降级为独立「使用工具」行
    expect(result.some(item => item.id === 'tool-3')).toBe(false)
    expect(result.some(item => item.title.startsWith('使用工具「'))).toBe(false)
  })

  it('上限可按需调整（每条归因只保留 1 条工具）', () => {
    const actions = attributionWithTools(['工具甲', '工具乙'])
    const result = mergePlanActionDisplay(
      actions, allAttributionPlacement(['工具甲', '工具乙']), ['归属感缺失'], 3, new Map(), 1
    )
    expect(result.find(item => item.id === 'attr-1')?.mergedTools).toEqual([
      { title: '工具甲', content: '1. 工具甲 步骤' }
    ])
  })

  it('等级干预条的直选工具同样受上限约束，超出的随行隐藏', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'grading-1', title: '按「橙色」干预', detail: 'g' }),
      action({ id: 'tool-1', title: '使用工具「直选甲」', detail: '1. a' }),
      action({ id: 'tool-2', title: '使用工具「直选乙」', detail: '1. b' }),
      action({ id: 'tool-3', title: '使用工具「直选丙」', detail: '1. c' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['直选甲', { channel: 'intervention' }],
      ['直选乙', { channel: 'intervention' }],
      ['直选丙', { channel: 'intervention' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, [])
    expect(result.find(item => item.id === 'grading-1')?.mergedTools).toEqual([
      { title: '直选甲', content: '1. a' },
      { title: '直选乙', content: '1. b' }
    ])
    // 被截断的直选工具不降级为独立「使用工具」行
    expect(result.some(item => item.id === 'tool-3')).toBe(false)
  })

  it('等级干预条的上限同样可按需调整（只保留 1 条）', () => {
    const actions: PlanActionDisplayAction[] = [
      action({ id: 'grading-1', title: '按「橙色」干预', detail: 'g' }),
      action({ id: 'tool-1', title: '使用工具「直选甲」', detail: '1. a' }),
      action({ id: 'tool-2', title: '使用工具「直选乙」', detail: '1. b' })
    ]
    const placement = new Map<string, PlanToolPlacement>([
      ['直选甲', { channel: 'intervention' }],
      ['直选乙', { channel: 'intervention' }]
    ])
    const result = mergePlanActionDisplay(actions, placement, [], 3, new Map(), 1)
    expect(result.find(item => item.id === 'grading-1')?.mergedTools).toEqual([
      { title: '直选甲', content: '1. a' }
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { resolveToolAttributionPlacement } from '../server/domain/plan-actions'
import { buildPlanToolPlacement } from '../server/domain/plan-action-display-context'

const attributions = [
  { code: 'SG_AT_16', share: 0.6, name: '意义感流失' },
  { code: 'SG_AT_19', share: 0.4, name: '效能感不足' }
]

describe('resolveToolAttributionPlacement', () => {
  it('工具声明多条归因时，按本次占比降序取第一条命中的归因', () => {
    const tool = { attributionCode: 'SG_AT_16', attributionCodes: ['SG_AT_16', 'SG_AT_19'] }
    expect(resolveToolAttributionPlacement(tool, attributions)).toEqual({ code: 'SG_AT_16', name: '意义感流失' })
  })

  it('工具只声明次归因时取次归因', () => {
    const tool = { attributionCode: 'SG_AT_19', attributionCodes: [] }
    expect(resolveToolAttributionPlacement(tool, attributions)).toEqual({ code: 'SG_AT_19', name: '效能感不足' })
  })

  it('工具声明的归因都不在本次结果里时返回 null（交给回退解析）', () => {
    expect(resolveToolAttributionPlacement({ attributionCode: 'SG_AT_99' }, attributions)).toBeNull()
    expect(resolveToolAttributionPlacement({}, attributions)).toBeNull()
  })

  it('归因名称缺失时用编码占位，保证归属不丢', () => {
    expect(resolveToolAttributionPlacement({ attributionCode: 'SG_AT_16' }, [{ code: 'SG_AT_16', share: 1 }]))
      .toEqual({ code: 'SG_AT_16', name: 'SG_AT_16' })
  })
})

describe('buildPlanToolPlacement', () => {
  it('读取 plans.tools 的 sourceChannel：归因通道要名称，等级通道只要标记', () => {
    const placement = buildPlanToolPlacement([
      { title: '贡献清单', sourceChannel: 'attribution', attributionCode: 'SG_AT_16', attributionName: '意义感流失' },
      { title: '强制委托清单', sourceChannel: 'intervention' }
    ])
    expect(placement.get('贡献清单')).toEqual({ channel: 'attribution', attributionName: '意义感流失' })
    expect(placement.get('强制委托清单')).toEqual({ channel: 'intervention' })
  })

  it('老方案（无标记）与归因名称缺失的条目都不产生 placement', () => {
    const placement = buildPlanToolPlacement([
      { title: '老工具' },
      { title: '缺名称工具', sourceChannel: 'attribution' },
      { title: '' }
    ])
    expect(placement.size).toBe(0)
  })
})

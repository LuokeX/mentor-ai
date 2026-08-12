/**
 * 代入试算（v4 模板 ⑪ 推演算例的交互版）测试。
 *
 * 验证：向导输入 + 每维度 1..5 强度 → 走编译→解析→规则引擎真实链路，
 * 结果与「上线后真实运行」同源（同一 executeRules）。
 * 样例为 home_school 六维度框架（全题反向计分，得分越高状况越差）。
 */
import { describe, expect, it } from 'vitest'
import { simulateWizardRun } from '../server/domain/business-wizard-simulate'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { WIZARD_SAMPLE } from './fixtures/wizard-sample'

/** 维度强度：某张量表全部维度设同一强度 */
function dimAnswers(scaleName: string, intensity: number) {
  const scale = WIZARD_SAMPLE.scales.find(s => s.name === scaleName)!
  const dims = [...new Set(scale.questions.map(q => q.dimension))]
  return { [scaleName]: Object.fromEntries(dims.map(d => [d, intensity])) }
}

describe('business-wizard-simulate', () => {
  it('编译结果可用（前置条件）', () => {
    const compiled = compileWizardInput(WIZARD_SAMPLE)
    expect(compiled.libraries.map(l => l.libraryType)).toEqual(
      expect.arrayContaining(['assessment', 'attribution'])
    )
  })

  it('全部维度 3 分：每张量表都能算出结果且不报错', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 3))
    expect(result.scales).toHaveLength(WIZARD_SAMPLE.scales.length)
    for (const s of result.scales) {
      expect(s.error).toBeUndefined()
      expect(s.levelName).toBeTruthy()
    }
  })

  it('全部维度 1 分（状况最严重）：触发 E 级保护通道红线', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 1))
    const entry = result.scales.find(s => s.name === '家校沟通六维速查')!
    expect(entry.error).toBeUndefined()
    // 全 1 分 → 反向计分后第 6 题=5 ≥ 4 → E 级红线
    expect(entry.redLine).toBe(true)
    expect(entry.levelName).toBe('E 级保护通道')
  })

  it('全部维度 5 分（状况良好）：落入兜底等级', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 5))
    const entry = result.scales.find(s => s.name === '家校沟通六维速查')!
    expect(entry.error).toBeUndefined()
    expect(entry.redLine).toBe(false)
    expect(entry.levelName).toBe('常规沟通即可')
  })

  it('维度级差异化作答：不同维度强度产生不同归因排序', () => {
    const scale = WIZARD_SAMPLE.scales.find(s => s.name === '家校沟通六维速查')!
    const dims = [...new Set(scale.questions.map(q => q.dimension))]
    expect(dims.length).toBeGreaterThanOrEqual(4)
    const answers: Record<string, Record<string, number>> = {
      家校沟通六维速查: Object.fromEntries(dims.map((d, i) => [d, i === 0 ? 1 : 5]))
    }
    const result = simulateWizardRun(WIZARD_SAMPLE, answers)
    const entry = result.scales.find(s => s.name === '家校沟通六维速查')!
    expect(entry.error).toBeUndefined()
    // 强度 1 的维度（沟通质量最差）应贡献主要归因
    expect(entry.attributions[0]?.strength).toBe('primary')
    expect(entry.attributions[0]?.name).toBeTruthy()
    expect(entry.primaryAttribution).toBe(entry.attributions[0]?.name)
  })

  it('试算不写入任何状态：同一输入两次调用结果一致', () => {
    const a = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 2))
    const b = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 2))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('answers 缺失的量表（未提供强度）也能算：默认按 3 分', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, {})
    for (const s of result.scales) {
      expect(s.error).toBeUndefined()
      expect(s.levelName).toBeTruthy()
    }
  })

  it('逐题覆盖：维度全高分但第 6 题单独答最差 → 触发 E 级红线（维度模式测不出）', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 5), {
      perQuestion: { 家校沟通六维速查: { q6: 1 } }
    })
    const entry = result.scales.find(s => s.name === '家校沟通六维速查')!
    expect(entry.error).toBeUndefined()
    // 全 5 分本应落入兜底等级（现有用例已断言），q6 覆盖 raw=1 → 反向分 5 ≥ 4 → E 级红线
    expect(entry.redLine).toBe(true)
    expect(entry.levelName).toBe('E 级保护通道')
  })

  it('跨量表联动：入口量表沟通质量偏高 → 深度量表触发条件满足；入口量表自身无触发条件', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 3))
    const entry = result.scales.find(s => s.name === '家校沟通六维速查')!
    const deep = result.scales.find(s => s.name === '家长分型与沟通策略评估')!
    expect(entry.trigger).toBeNull()
    expect(deep.trigger).not.toBeNull()
    // 强度 3 → 反向分 3 ≥ 3，触发「沟通质量 ≥ 3 或 均分 ≥ 3.2」
    expect(deep.trigger!.met).toBe(true)
    // 挂在入口表上的计算变量在深度表上仍算不出（引擎语义不变），但挂载量表已作答，不提示补作答
    expect(deep.unavailableVariables).toContain('沟通压力指数')
    expect(deep.missingAnswerScales).not.toContain('沟通压力指数')
  })

  it('跨量表联动：入口量表全部正常（强度 5）→ 深度量表触发条件不满足', () => {
    const result = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家校沟通六维速查', 5))
    const deep = result.scales.find(s => s.name === '家长分型与沟通策略评估')!
    expect(deep.trigger!.met).toBe(false)
  })

  it('计算变量：挂载量表作答后能算出值；挂载量表没作答时提示补作答', () => {
    // 全部作答：入口表上 沟通压力指数 = 沟通质量(3) + 参与效能(3) = 6
    const all = simulateWizardRun(WIZARD_SAMPLE, {
      ...dimAnswers('家校沟通六维速查', 3),
      ...dimAnswers('家长分型与沟通策略评估', 3)
    })
    const entry = all.scales.find(s => s.name === '家校沟通六维速查')!
    expect(entry.computedValues['沟通压力指数']).toBe(6)
    expect(entry.unavailableVariables).not.toContain('沟通压力指数')
    expect(entry.missingAnswerScales).toEqual([])

    // 只给深度表作答：挂在入口表上的变量算不出，且提示入口表没作答
    const onlyDeep = simulateWizardRun(WIZARD_SAMPLE, dimAnswers('家长分型与沟通策略评估', 3))
    const deep = onlyDeep.scales.find(s => s.name === '家长分型与沟通策略评估')!
    expect(deep.unavailableVariables).toContain('沟通压力指数')
    expect(deep.missingAnswerScales).toContain('沟通压力指数')
  })
})
/**
 * 业务填写向导的往返无损测试。
 *
 * 核心承诺：业务在向导里填的内容，走完
 *   编译（compileWizardInput）→ 真实导入器（parseModuleResourceFile）→ 反编译（decompileToWizardInput）
 * 之后回到向导里一字不差。这条链是「载入现有内容 → 继续改 → 保存」的根基——
 * 有任一字段在往返中丢失，业务点一次保存就会毁掉数据，而且界面上完全看不出来。
 *
 * 断言不追求全量 JSON 相等（编译端会补自动规则、调整编码风格），
 * 而是钉住「业务亲自填过的每一个字段」必须无损。
 */
import { describe, expect, it } from 'vitest'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { decompileToWizardInput } from '../server/domain/business-wizard-decompile'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { WIZARD_SAMPLE } from './fixtures/wizard-sample'

describe('向导往返无损', () => {
  const compiled = compileWizardInput(WIZARD_SAMPLE)
  const parse = (libraryType: string) => parseModuleResourceFile({
    module: WIZARD_SAMPLE.module, libraryType: libraryType as any,
    filename: `${libraryType}.xlsx`, contentBase64: compiled.libraries.find(l => l.libraryType === libraryType)!.buffer.toString('base64')
  })
  const payloads = {
    assessment: parse('assessment'),
    attribution: parse('attribution'),
    tool: parse('tool'),
    keyword_route: parse('keyword_route'),
    output_template: parse('output_template')
  }
  const round = decompileToWizardInput(WIZARD_SAMPLE.module, payloads)

  it('没有任何「会丢失」的 unsupported', () => {
    expect(round.unsupported).toEqual([])
  })

  it('模块级默认设置无损', () => {
    for (const key of Object.keys(WIZARD_SAMPLE.defaults)) {
      const expected = (WIZARD_SAMPLE.defaults as any)[key]
      const actual = (round.input.defaults as any)[key]
      // 熔断后动作是多段文本，导入按分隔符切成数组、反编译用「；」接回，分词归一后应一致
      if (typeof expected === 'string' && expected.includes('，')) {
        expect(String(actual).split(/[，；]/)).toEqual(expected.split(/[，；]/))
      } else {
        expect(actual, `defaults.${key}`).toBe(expected)
      }
    }
  })

  it('量表：名称/角色/题目/维度/提示/维度属性无损', () => {
    expect(round.input.scales.map(s => s.name)).toEqual(WIZARD_SAMPLE.scales.map(s => s.name))
    expect(round.input.scales.map(s => s.role)).toEqual(WIZARD_SAMPLE.scales.map(s => s.role))
    for (let i = 0; i < WIZARD_SAMPLE.scales.length; i++) {
      const expectQ = WIZARD_SAMPLE.scales[i]!.questions
      const actualQ = round.input.scales[i]!.questions
      expect(actualQ.map(q => q.text)).toEqual(expectQ.map(q => q.text))
      expect(actualQ.map(q => q.dimension)).toEqual(expectQ.map(q => q.dimension))
      expect(actualQ.map(q => q.optionGroup)).toEqual(expectQ.map(q => q.optionGroup))
      expect(actualQ.map(q => q.reverse)).toEqual(expectQ.map(q => q.reverse))
      expect(actualQ.map(q => q.help)).toEqual(expectQ.map(q => q.help))
      // 维度属性（计算方式/权重/说明）按维度名对齐
      const defByName = (list: any[]) => Object.fromEntries(list.map(d => [d.name, d]))
      const expectDefs = defByName(WIZARD_SAMPLE.scales[i]!.dimensionDefs || [])
      for (const d of round.input.scales[i]!.dimensionDefs || []) {
        const e = expectDefs[d.name]
        if (!e) continue
        expect(d.calcMethod).toBe(e.calcMethod)
        expect(d.weight).toBe(e.weight)
        expect(d.description).toBe(e.description)
        expect(d.highInterpretation).toBe(e.highInterpretation)
      }
    }
  })

  it('原因：名称/典型诱因/标签/权重无损', () => {
    expect(round.input.attributions.map(a => a.name)).toEqual(WIZARD_SAMPLE.attributions.map(a => a.name))
    expect(round.input.attributions.map(a => a.typicalTrigger)).toEqual(WIZARD_SAMPLE.attributions.map(a => a.typicalTrigger))
    expect(round.input.attributions.map(a => a.tags)).toEqual(WIZARD_SAMPLE.attributions.map(a => a.tags))
    expect(round.input.attributions.map(a => a.weight)).toEqual(WIZARD_SAMPLE.attributions.map(a => a.weight))
  })

  it('计算变量：名称/表达式/归属量表无损', () => {
    expect(round.input.computedVariables).toEqual(WIZARD_SAMPLE.computedVariables)
  })

  it('自定义选项组：引用稳定，选项文本与分值无损', () => {
    // 题目对自定义组的引用：第 6 题用的是 cg-1，往返后应仍指向同一组
    const q6Group = round.input.scales[0]!.questions[5]!.optionGroup
    const expectGroup = WIZARD_SAMPLE.optionGroups[0]!
    expect(q6Group).not.toBe('FREQ_5')
    // 反编译拿不到组的原名（④b 没有名称列），按签名还原；断言选项文本与分值一致
    const actual = round.input.optionGroups.find(g => g.id === q6Group)
    expect(actual).toBeTruthy()
    expect(actual!.options).toEqual(expectGroup.options)
  })

  it('命中规则：条件结构无损', () => {
    expect(round.input.evidences.map(e => e.attribution)).toEqual(WIZARD_SAMPLE.evidences.map(e => e.attribution))
    expect(round.input.evidences.map(e => e.scale)).toEqual(WIZARD_SAMPLE.evidences.map(e => e.scale))
    expect(round.input.evidences.map(e => e.weight)).toEqual(WIZARD_SAMPLE.evidences.map(e => e.weight))
    for (let i = 0; i < WIZARD_SAMPLE.evidences.length; i++) {
      const conds = round.input.evidences[i]!.conditions
      const expectConds = WIZARD_SAMPLE.evidences[i]!.conditions
      expect(conds).toEqual(expectConds)
    }
  })

  it('等级：名称/条件/红线/通知模板/升级参数无损', () => {
    expect(round.input.levels.map(l => l.name)).toEqual(WIZARD_SAMPLE.levels.map(l => l.name))
    expect(round.input.levels.map(l => l.redLine)).toEqual(WIZARD_SAMPLE.levels.map(l => l.redLine))
    expect(round.input.levels.map(l => l.notificationTemplate)).toEqual(WIZARD_SAMPLE.levels.map(l => l.notificationTemplate))
    expect(round.input.levels.map(l => l.escalationCondition)).toEqual(WIZARD_SAMPLE.levels.map(l => l.escalationCondition))
    expect(round.input.levels.map(l => l.escalationTarget)).toEqual(WIZARD_SAMPLE.levels.map(l => l.escalationTarget))
    expect(round.input.levels.map(l => l.reAssessTrigger)).toEqual(WIZARD_SAMPLE.levels.map(l => l.reAssessTrigger))
    for (let i = 0; i < WIZARD_SAMPLE.levels.length; i++) {
      expect(round.input.levels[i]!.conditions).toEqual(WIZARD_SAMPLE.levels[i]!.conditions)
    }
    expect(round.input.defaultLevelName).toBe(WIZARD_SAMPLE.defaultLevelName)
    expect(round.input.defaultMessage).toBe(WIZARD_SAMPLE.defaultMessage)
  })

  it('工具：名称/形式/严重度/步骤与步骤细节/作用维度/预期效果无损', () => {
    expect(round.input.tools.map(t => t.name)).toEqual(WIZARD_SAMPLE.tools.map(t => t.name))
    expect(round.input.tools.map(t => t.form)).toEqual(WIZARD_SAMPLE.tools.map(t => t.form))
    expect(round.input.tools.map(t => t.severity)).toEqual(WIZARD_SAMPLE.tools.map(t => t.severity))
    expect(round.input.tools.map(t => t.whenToUse)).toEqual(WIZARD_SAMPLE.tools.map(t => t.whenToUse))
    expect(round.input.tools.map(t => t.steps)).toEqual(WIZARD_SAMPLE.tools.map(t => t.steps))
    expect(round.input.tools.map(t => t.expectedEffect)).toEqual(WIZARD_SAMPLE.tools.map(t => t.expectedEffect))
    expect(round.input.tools.map(t => t.effectNote)).toEqual(WIZARD_SAMPLE.tools.map(t => t.effectNote))
    expect(round.input.tools.map(t => t.dimensions)).toEqual(WIZARD_SAMPLE.tools.map(t => t.dimensions))
    expect(round.input.tools.map(t => t.timePerSession)).toEqual(WIZARD_SAMPLE.tools.map(t => t.timePerSession))
    expect(round.input.tools.map(t => t.duration)).toEqual(WIZARD_SAMPLE.tools.map(t => t.duration))
    expect(round.input.tools.map(t => t.evidenceSource)).toEqual(WIZARD_SAMPLE.tools.map(t => t.evidenceSource))
    expect(round.input.tools.map(t => t.reAssessmentIntervalDays)).toEqual(WIZARD_SAMPLE.tools.map(t => t.reAssessmentIntervalDays))
    expect(round.input.tools.map(t => t.alternativeTools)).toEqual(WIZARD_SAMPLE.tools.map(t => t.alternativeTools))
    for (let i = 0; i < WIZARD_SAMPLE.tools.length; i++) {
      // 步骤细节：全空对象等价「没填」；有内容的字段必须逐项一致
      const expectDetails = (WIZARD_SAMPLE.tools[i]!.stepDetails || []).filter(d => Object.keys(d).some(k => d[k]))
      const actualDetails = (round.input.tools[i]!.stepDetails || []).filter(d => Object.keys(d).some(k => d[k]))
      expect(actualDetails.length).toBe(expectDetails.length)
      for (let s = 0; s < expectDetails.length; s++) {
        const e = expectDetails[s] || {}
        const a = actualDetails[s] || {}
        for (const key of Object.keys(e)) {
          expect((a as any)[key], `工具${i} 步骤${s} 的 ${key}`).toBe((e as any)[key])
        }
      }
    }
  })

  it('关键词：词/匹配模式/工具关联/风险/情境无损', () => {
    expect(round.input.keywords.map(k => k.core)).toEqual(WIZARD_SAMPLE.keywords.map(k => k.core))
    expect(round.input.keywords.map(k => k.exclude)).toEqual(WIZARD_SAMPLE.keywords.map(k => k.exclude))
    expect(round.input.keywords.map(k => k.matchMode)).toEqual(WIZARD_SAMPLE.keywords.map(k => k.matchMode))
    expect(round.input.keywords.map(k => k.tool)).toEqual(WIZARD_SAMPLE.keywords.map(k => k.tool))
    expect(round.input.keywords.map(k => k.risk)).toEqual(WIZARD_SAMPLE.keywords.map(k => k.risk))
    // 空字符串与 undefined 等价（导入器读空列返回空串，反编译归一成 undefined）
    expect(round.input.keywords.map(k => k.contextConstraint || '')).toEqual(WIZARD_SAMPLE.keywords.map(k => k.contextConstraint || ''))
  })
})
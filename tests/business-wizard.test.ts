/**
 * 业务填写向导的回归测试。
 *
 * 最关键的一条：编译器内嵌的 v4 表头必须和当前模板逐列一致。
 * 模板改了而编译器没跟上，生成的文件会被解析器静默丢列——不报错，只是数据没了。
 */
import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { resolve } from 'node:path'
import { V4_HEADERS } from '../server/domain/business-wizard'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { wizardInputSchema } from '../shared/business-wizard'
import { WIZARD_SAMPLE } from './fixtures/wizard-sample'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { checkCrossReferences } from '../server/domain/module-resource-cross-ref'
import { executeRules } from '../server/domain/rules-executor'
import { scoreTools } from '../server/domain/plan-actions'

const TEMPLATE = resolve('business-libraries/templates/三库填写模板_v4.xlsx')

describe('编译器与 v4 模板的表头一致性', () => {
  it('每张填写页的列名与列序都和当前模板逐列相同', () => {
    const wb = XLSX.readFile(TEMPLATE)
    for (const [sheetName, expected] of Object.entries(V4_HEADERS)) {
      const sheet = wb.Sheets[sheetName]
      expect(sheet, `模板里找不到 ${sheetName}`).toBeTruthy()
      const actual = (XLSX.utils.sheet_to_json<any[]>(sheet!, { header: 1 })[0] || [])
        .map(v => String(v ?? '').trim())
      expect(actual, `${sheetName} 列不一致`).toEqual(expected)
    }
  })
})

describe('样例输入能编译出一整套可用的三库', () => {
  const input = wizardInputSchema.parse(WIZARD_SAMPLE)
  const compiled = compileWizardInput(input)

  it('编译期没有 error 级问题', () => {
    expect(compiled.issues.filter(i => i.severity === 'error')).toEqual([])
  })

  it('5 个库都能被真实导入器解析并通过校验', () => {
    for (const lib of compiled.libraries) {
      const payload = parseModuleResourceFile({
        module: input.module, libraryType: lib.libraryType,
        filename: 'x.xlsx', contentBase64: lib.buffer.toString('base64')
      })
      const v = validateModuleResourcePayload({ module: input.module, libraryType: lib.libraryType, payload })
      expect(v.errors.map(e => e.message), `${lib.label} 校验未通过`).toEqual([])
    }
  })

  it('跨库引用零错误', () => {
    const payloads = new Map<string, any>()
    const libs: any[] = []
    for (const lib of compiled.libraries) {
      payloads.set(lib.libraryType, parseModuleResourceFile({
        module: input.module, libraryType: lib.libraryType,
        filename: 'x.xlsx', contentBase64: lib.buffer.toString('base64')
      }))
      libs.push({ id: lib.libraryType, libraryType: lib.libraryType })
    }
    const report = checkCrossReferences(input.module, libs, payloads)
    expect(report.issues.filter(i => i.severity === 'error').map(i => i.message)).toEqual([])
  })

  it('业务全程不接触编码，但编译出的条件表达式是引擎认识的语法', () => {
    const attribution: any = parseModuleResourceFile({
      module: input.module, libraryType: 'attribution',
      filename: 'x.xlsx', contentBase64: compiled.libraries.find(l => l.libraryType === 'attribution')!.buffer.toString('base64')
    })
    // 业务选的是「维度：配合度 达到或超过 3.5」，编译成 维度[HS_S1D1] >= 3.5
    expect(attribution.evidences[0].condition).toMatch(/^维度\[HS_S1D\d\] >= 3\.5$/)
    // 多条件用「且」连接
    expect(attribution.evidences.some((e: any) => e.condition.includes(' 且 '))).toBe(true)
  })

  it('深度量表的触发条件用跨量表语法指向入口量表', () => {
    const assessment: any = parseModuleResourceFile({
      module: input.module, libraryType: 'assessment',
      filename: 'x.xlsx', contentBase64: compiled.libraries.find(l => l.libraryType === 'assessment')!.buffer.toString('base64')
    })
    const deep = assessment.instruments.find((i: any) => i.instrumentRole === 'deep_dive')
    expect(deep.triggerCondition).toMatch(/^量表\[HS_S1\]\.维度\[HS_S1D\d\] >= 3$/)
    expect(deep.prerequisiteCodes).toEqual(['HS_S1'])
  })

  it('真引擎能跑出等级、归因和工具', () => {
    const load = (t: any) => parseModuleResourceFile({
      module: input.module, libraryType: t, filename: 'x.xlsx',
      contentBase64: compiled.libraries.find(l => l.libraryType === t)!.buffer.toString('base64')
    }) as any
    const inst = load('assessment').instruments[0]
    const cfg = load('attribution')
    const tools = load('tool').tools

    // 对立严重的画像：应判出红线并算出多个归因
    const result = executeRules(cfg, { q1: 1, q2: 5, q3: 2, q4: 4, q5: 2, q6: 4 }, inst, {})
    expect(result.blocked).toBe(true)
    expect(result.attributions.length).toBeGreaterThan(1)

    // 中等画像：不熔断，能匹配到工具
    const mid = executeRules(cfg, { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 3 }, inst, {})
    expect(mid.blocked).toBe(false)
    expect(mid.levelName).toBeTruthy()
    const matched = scoreTools(tools, {
      dimensions: mid.dimensions, severity: mid.severity,
      attributions: mid.attributions.map(a => ({ code: a.code, share: a.share })),
      toolTags: mid.toolTags
    })
    expect(matched.length).toBeGreaterThan(0)
  })

  it('回读稿是纯中文，不含任何编码', () => {
    const text = compiled.readback.join('\n')
    expect(text).not.toMatch(/HS_S\d|HS_AT_|HS_RX_|维度\[|题\[|>=/)
    expect(text).toContain('家校沟通双维速查')
  })

  it('自定义选项组写进 ④b 并被题目引用', () => {
    const assessment: any = parseModuleResourceFile({
      module: input.module, libraryType: 'assessment',
      filename: 'x.xlsx', contentBase64: compiled.libraries.find(l => l.libraryType === 'assessment')!.buffer.toString('base64')
    })
    const q6 = assessment.instruments[0].questions.find((q: any) => q.id === 'q6')
    // 自定义组「沟通频率四点」：选项文本与分值逐项落地
    expect(q6.options.map((o: any) => o.label)).toEqual(['没有', '偶尔', '较多', '频繁'])
    expect(q6.options.map((o: any) => o.value)).toEqual([1, 2, 3, 4])
  })
})

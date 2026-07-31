/**
 * 全链路防回归测试：量表 → 归因 → 工具 → 方案。
 *
 * 存在的理由：质量校验和交叉引用只覆盖「引用的编码存不存在」，
 * 覆盖不到「某条归因命中时能不能匹配到工具」。这个盲区曾经让
 * 「25 条分支全部匹配 0 个工具」一路漏到线上数据里，界面上只表现为
 * 方案里没有工具，没有任何报错。
 *
 * 数据源是仓库里已提交的 business-libraries/test-data/**，不需要数据库。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAssessmentFile, toAssessmentPayload } from '../scripts/import-business-data/transformers/assessment'
import { parseAttributionFile } from '../scripts/import-business-data/transformers/attribution'
import { parseStandardToolFile } from '../scripts/import-business-data/transformers/tool'
import { parseKeywordRouteFile } from '../scripts/import-business-data/transformers/keyword-route'
import { parseOutputTemplateFile } from '../scripts/import-business-data/transformers/output-template'
import { checkCrossReferences } from '../server/domain/module-resource-cross-ref'
import { executeRules } from '../server/domain/rules-executor'
import { scoreTools } from '../server/domain/plan-actions'
import { createTemplateAssessmentReport } from '../server/domain/reports'
import type { AttributionConfig, LibraryType, ModuleId } from '../shared/contracts'
import type { AssessmentDefinition } from '../shared/assessments'

const BASE = resolve('business-libraries/test-data')
const MODULES: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
const TYPES: LibraryType[] = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']

function load(module: ModuleId) {
  const file = (type: LibraryType) => `${BASE}/${module}/${type}.xlsx`
  return {
    assessments: parseAssessmentFile(file('assessment'), module).map(i => toAssessmentPayload(i, module)) as AssessmentDefinition[],
    attribution: parseAttributionFile(file('attribution'), module) as AttributionConfig,
    tools: parseStandardToolFile(file('tool')) as Array<Record<string, unknown>>,
    routes: parseKeywordRouteFile(file('keyword_route'), module),
    templates: parseOutputTemplateFile(file('output_template'), module)
  }
}

/** 穷举作答样本：全低、全中、全高，加上固定种子的伪随机样本 */
function sampleAnswers(questions: Array<{ id: string }>, seed: number) {
  const out: Record<string, number> = {}
  let state = seed
  for (const q of questions) {
    state = (state * 1103515245 + 12345) % 2147483648
    out[q.id] = 1 + (state % 5)
  }
  return out
}

describe.each(MODULES)('三库链路 — %s', (module) => {
  it('五个库文件都存在', () => {
    for (const type of TYPES) {
      expect(existsSync(`${BASE}/${module}/${type}.xlsx`), `缺少 ${module}/${type}.xlsx`).toBe(true)
    }
  })

  it('五个库都能解析出内容', () => {
    const data = load(module)
    expect(data.assessments.length).toBeGreaterThan(0)
    expect(data.attribution.attributionItems.length).toBeGreaterThan(0)
    expect(data.attribution.evidences.length).toBeGreaterThan(0)
    expect(data.attribution.gradingRules.length).toBeGreaterThan(0)
    expect(data.tools.length).toBeGreaterThan(0)
    expect(data.routes.length).toBeGreaterThan(0)
    expect(data.templates.length).toBeGreaterThan(0)
  })

  it('交叉引用无 error', () => {
    const data = load(module)
    const payloads = new Map<string, Record<string, unknown>>([
      ['assessment', { instruments: data.assessments }],
      ['attribution', data.attribution as unknown as Record<string, unknown>],
      ['tool', { tools: data.tools }],
      ['keyword_route', { routes: data.routes }],
      ['output_template', { templates: data.templates }]
    ])
    const report = checkCrossReferences(module, TYPES.map(t => ({ libraryType: t })), payloads)
    const errors = report.issues.filter(i => i.severity === 'error')
    expect(errors.map(e => `${e.sourceLibraryType}.${e.sourceCode}.${e.sourceField}="${e.sourceValue}" → ${e.message}`)).toEqual([])
  })

  it('兜底分级规则的优先级是最大值', () => {
    const { gradingRules } = load(module).attribution
    const fallbacks = gradingRules.filter(rule => !rule.when)
    expect(fallbacks.length).toBeGreaterThan(0)
    const maxPri = Math.max(...gradingRules.map(rule => rule.pri))
    for (const rule of fallbacks) {
      expect(rule.pri, `兜底规则 ${rule.ruleId} 的优先级不是最大值，其余规则将永远不可达`).toBe(maxPri)
    }
  })

  it('每张量表都有能判出非兜底等级的分级规则', () => {
    // 只被模块兜底规则覆盖的量表，无论怎么作答都只会得到同一个等级——
    // 归因算出「信任基础薄弱」而等级永远是「常规」，二者自相矛盾，且不会报错。
    const data = load(module)
    const failures: string[] = []
    for (const instrument of data.assessments) {
      const applicable = data.attribution.gradingRules
        .filter(rule => !rule.assessmentCode || rule.assessmentCode === instrument.code)
      if (!applicable.length) {
        failures.push(`${instrument.code} 没有任何适用的分级规则`)
      } else if (!applicable.some(rule => rule.when?.trim())) {
        failures.push(`${instrument.code} 只有兜底规则可用，等级恒定`)
      }
    }
    expect(failures).toEqual([])
  })

  it('每条归因项都至少有一条证据规则', () => {
    const { attributionItems, evidences } = load(module).attribution
    const covered = new Set(evidences.map(e => e.attributionCode))
    const orphans = attributionItems.filter(item => !covered.has(item.code)).map(item => item.code)
    expect(orphans, '这些归因项没有证据规则，永远算不出分').toEqual([])
  })

  it('每条归因项被命中时都能匹配到至少一个工具', () => {
    const data = load(module)
    const { attributionItems } = data.attribution
    const tools = data.tools
    const failures: string[] = []
    for (const item of attributionItems) {
      // 最宽松假设：该归因独占 100% 占比
      const matched = scoreTools(tools, {
        dimensions: {},
        attributions: [{ code: item.code, share: 1 }],
        toolTags: item.toolTags
      })
      if (!matched.length) failures.push(item.code)
    }
    expect(failures, '这些归因命中时匹配不到任何工具，班主任会拿到没有工具的方案').toEqual([])
  })

  it('任意作答都不会产生「未熔断但没有工具」的方案', () => {
    const data = load(module)
    const failures: string[] = []
    for (const definition of data.assessments) {
      for (let seed = 1; seed <= 60; seed++) {
        const answers = sampleAnswers(definition.questions, seed)
        const result = executeRules(data.attribution, answers, definition)
        if (result.blocked) continue // 红线走转介，本就不出方案
        if (result.attributions.length === 0) continue // 无归因证据命中，属于数据覆盖问题，另有断言
        const matched = scoreTools(data.tools, {
          dimensions: result.dimensions,
          severity: result.severity,
          attributions: result.attributions.map(a => ({ code: a.code, share: a.share })),
          toolTags: result.toolTags
        })
        if (!matched.length) failures.push(`${definition.code} seed=${seed} 归因=${result.attributions.map(a => a.code).join(',')}`)
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
  })

  it('每张量表都能跑完引擎并渲染出报告', () => {
    const data = load(module)
    for (const definition of data.assessments) {
      for (const value of [1, 3, 5]) {
        const answers = Object.fromEntries(definition.questions.map(q => [q.id, value]))
        const result = executeRules(data.attribution, answers, definition)
        expect(() => createTemplateAssessmentReport({ module, result })).not.toThrow()
      }
    }
  })

  it('同样的作答每次得到同样的归因与排序', () => {
    const data = load(module)
    const definition = data.assessments[0]!
    const answers = sampleAnswers(definition.questions, 42)
    const first = executeRules(data.attribution, answers, definition)
    const second = executeRules(data.attribution, answers, definition)
    expect(second.attributions).toEqual(first.attributions)
    expect(second.matchedRuleIds).toEqual(first.matchedRuleIds)
  })

  it('输出模板覆盖了分级规则产出的所有等级', () => {
    const data = load(module)
    const levels = new Set(data.attribution.gradingRules.map(rule => rule.level))
    const covered = new Set(data.templates.map(t => t.attributionLevel))
    const missing = [...levels].filter(level => !covered.has(level))
    expect(missing, '这些等级命中时方案文案会空缺').toEqual([])
  })
})

// 合成用例：针对链 8（工具→④c 维度编码）与链 5b（等级→模板覆盖）的定向验证，
// 不依赖 golden 数据，避免业务数据演进把断言语义冲掉。
describe('跨库引用校验 — 合成用例', () => {
  const module: ModuleId = 'home_school'
  const libs = ['assessment', 'attribution', 'tool', 'output_template'].map(libraryType => ({ libraryType }))
  const base = new Map<string, Record<string, unknown>>([
    ['assessment', {
      instruments: [{
        code: 'HS_SIX_DIM',
        dimensionDefs: [{ code: 'HS_DIM_TRUST', name: '信任关系', questionIds: ['q1'], calcMethod: 'mean' }]
      }]
    }],
    ['attribution', {
      attributionItems: [{ code: 'HS_AT_TRUST_LOSS', name: '信任缺失' }],
      evidences: [],
      gradingRules: [
        { ruleId: 'G1', pri: 10, when: '均分 < 3', level: 'orange', severity: 'high' },
        { ruleId: 'G2', pri: 999, level: 'none', severity: 'low' }
      ]
    }]
  ])
  const withParts = (parts: Record<string, Record<string, unknown>>) => new Map([...base, ...Object.entries(parts)])

  it('工具作用维度编码与 ④c 不一致时给 warning（链 8），一致时不报', () => {
    const bad = checkCrossReferences(module, libs, withParts({
      tool: { tools: [{ code: 'RX1', name: 't', attributionCode: 'HS_AT_TRUST_LOSS', dimensions: ['TRUST'] }] },
      output_template: { templates: [{ code: 'T1', attributionLevel: 'orange' }, { code: 'T2', attributionLevel: 'none' }] }
    }))
    const dimIssues = bad.issues.filter(i => i.sourceField === 'dimensions')
    expect(dimIssues).toHaveLength(1)
    expect(dimIssues[0]!.severity).toBe('warning')
    expect(dimIssues[0]!.sourceValue).toBe('TRUST')

    const good = checkCrossReferences(module, libs, withParts({
      tool: { tools: [{ code: 'RX1', name: 't', attributionCode: 'HS_AT_TRUST_LOSS', dimensions: ['HS_DIM_TRUST'] }] },
      output_template: { templates: [{ code: 'T1', attributionLevel: 'orange' }, { code: 'T2', attributionLevel: 'none' }] }
    }))
    expect(good.issues.filter(i => i.sourceField === 'dimensions')).toEqual([])
  })

  it('等级无专属模板但有兜底时给 info，无兜底时升级为 warning（链 5b）', () => {
    const withFallback = checkCrossReferences(module, libs, withParts({
      tool: { tools: [] },
      output_template: { templates: [{ code: 'T2', attributionLevel: 'none' }] }
    }))
    const info = withFallback.issues.filter(i => i.message.includes('没有专属输出模板'))
    expect(info.map(i => i.sourceCode)).toEqual(['orange'])
    expect(info[0]!.severity).toBe('info')

    const noFallback = checkCrossReferences(module, libs, withParts({
      tool: { tools: [] },
      output_template: { templates: [{ code: 'T1', attributionLevel: 'orange' }] }
    }))
    const warnings = noFallback.issues.filter(i => i.severity === 'warning')
    expect(warnings.some(i => i.message.includes('缺少 none/default 兜底模板'))).toBe(true)
    expect(warnings.some(i => i.sourceCode === 'none' && i.message.includes('没有任何可用输出模板'))).toBe(true)
  })
})

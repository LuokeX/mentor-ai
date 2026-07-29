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

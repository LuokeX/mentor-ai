import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { evaluateImportQuality } from '../scripts/import-business-data/quality'
import { parseAttributionFile } from '../scripts/import-business-data/transformers/attribution'
import { importAll } from '../scripts/import-business-data/importers'
import {
  goldenAssessmentPayload,
  goldenAttributionPayload,
  goldenModule,
  goldenToolPayload
} from './fixtures/business-resource-golden'
import { parseAssessmentFile } from '../scripts/import-business-data/transformers/assessment'

describe('business import transformers', () => {
  it('parses attribution rules from a business xlsx template', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['module', 'version', 'variableName', 'expression', 'description'],
      ['home_school', '1.0.0', 'conflict', 'MAX(scores)', '冲突最高分']
    ]), '归因变量')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['module', 'version', 'priority', 'when', 'level', 'blocked', 'ruleId', 'primaryAttribution', 'secondaryAttributions', 'reasons', 'toolTags'],
      ['home_school', '1.0.0', '10', 'conflict >= 4', 'high', '否', 'home-school-high', '家校沟通冲突升级', '沟通边界不清;家长期待不一致', '冲突题项偏高，需要先降温。', 'home_school;conflict;high'],
      ['home_school', '1.0.0', '100', '', 'stable', '否', 'home-school-default', '家校沟通状态稳定', '', '进入常规维护。', 'home_school;stable']
    ]), '归因规则')

    const filePath = join(mkdtempSync(join(tmpdir(), 'mentor-attribution-')), 'attribution.xlsx')
    XLSX.writeFile(workbook, filePath)

    const parsed = parseAttributionFile(filePath, 'home_school')
    expect(parsed.computed.conflict).toBe('MAX(scores)')
    expect(parsed.branches).toHaveLength(2)
    expect(parsed.branches[0]?.primaryAttribution).toBe('家校沟通冲突升级')
    expect(parsed.branches[0]?.secondaryAttributions).toEqual(['沟通边界不清', '家长期待不一致'])
    expect(parsed.branches[1]?.when).toBeUndefined()
  })

  it('cleans assessment rows by filtering metadata and making repeated ids unique', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['题号', '维度/量表', '题干', '计分'],
      ['维度1 职业倦怠', '', '', ''],
      ['EE-1', '情绪耗竭', '我的工作让我感到情绪耗竭', '0=从不 … 6=每天'],
      ['【阈值分级】', '', '低/中/高阈值说明', ''],
      ['EE-1', '情绪耗竭', '下班后我感觉精力完全耗尽', '0=从不 … 6=每天']
    ]), '六维深度评估')

    const filePath = join(mkdtempSync(join(tmpdir(), 'mentor-assessment-clean-')), 'assessment.xlsx')
    XLSX.writeFile(workbook, filePath)

    const parsed = parseAssessmentFile(filePath, 'self_growth')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.questions.map(question => question.id)).toEqual(['EE-1', 'EE-1-2'])
    expect(parsed[0]?.questions.map(question => question.text)).not.toContain('低/中/高阈值说明')
  })

  it('parses home-school assessment index rows as usable questions', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['评估编码', '评估名称', '评估维度', '主要评估维度', '评估工具_形式'],
      ['EV01', '九级容器状态速查卡', '情绪容器功能', 'DM06 情绪容器功能', '观察+对照卡'],
      ['EV02', 'A-E级分类评定速查', '家校关系状态', 'DM02 家校关系状态', '行为对照表']
    ]), '评估库')

    const filePath = join(mkdtempSync(join(tmpdir(), 'mentor-assessment-index-')), 'assessment.xlsx')
    XLSX.writeFile(workbook, filePath)

    const parsed = parseAssessmentFile(filePath, 'home_school')
    expect(parsed[0]?.questions).toHaveLength(2)
    expect(parsed[0]?.questions[0]).toMatchObject({
      id: 'EV01',
      text: '九级容器状态速查卡',
      dimension: '情绪容器功能'
    })
  })
})

describe('business import quality gates', () => {
  it('accepts golden assessment samples and reports coverage metrics', () => {
    const report = evaluateImportQuality({
      module: goldenModule,
      libraryType: 'assessment',
      payload: goldenAssessmentPayload
    })
    expect(report.status).toBe('pass')
    expect(report.summary.assessmentCount).toBe(1)
    expect(report.metrics.averageQuestions).toBe(2)
    expect(report.metrics.dimensionCoverage).toBe(1)
  })

  it('accepts golden attribution samples and keeps fallback visible', () => {
    const report = evaluateImportQuality({
      module: goldenModule,
      libraryType: 'attribution',
      payload: goldenAttributionPayload
    })
    expect(report.status).toBe('pass')
    expect(report.summary.attributionRuleCount).toBe(2)
    expect(report.metrics.fallbackRuleCount).toBe(1)
    expect(report.metrics.toolTaggedRuleRatio).toBe(1)
  })

  it('accepts golden tool samples and reports operational completeness', () => {
    const report = evaluateImportQuality({
      module: goldenModule,
      libraryType: 'tool',
      payload: goldenToolPayload
    })
    expect(report.status).toBe('pass')
    expect(report.summary.toolCount).toBe(1)
    expect(report.metrics.toolMatchHintRatio).toBe(1)
    expect(report.metrics.toolScriptRatio).toBe(1)
    expect(report.metrics.toolProhibitionRatio).toBe(1)
    expect(report.metrics.toolExpectedEffectRatio).toBe(1)
  })

  it('fails imports when strict quality sees warnings', () => {
    const report = evaluateImportQuality({
      module: goldenModule,
      libraryType: 'tool',
      strict: true,
      payload: {
        tools: [{
          code: 'HS-WARN-T1',
          name: '弱结构工具',
          form: '清单',
          symptoms: '仅用于验证警告门禁',
          steps: ['记录问题']
        }]
      }
    })
    expect(report.status).toBe('fail')
    expect(report.summary.warningCount).toBeGreaterThan(0)
  })
})

describe('business import source selection', () => {
  it('defaults to standardized business-libraries instead of legacy raw Excel files', async () => {
    const results = await importAll({ dryRun: true, type: 'attribution' })
    expect(results).toHaveLength(5)
    expect(results.every(result => result.success)).toBe(true)
    expect(results.every(result => result.task.filePath.includes('/business-libraries/'))).toBe(true)
  })

  it('does not import legacy raw tool files unless explicitly requested', async () => {
    const results = await importAll({ dryRun: true, type: 'tool' })
    expect(results).toHaveLength(5)
    expect(results.every(result => result.success)).toBe(true)
    expect(results.every(result => result.task.filePath.endsWith('/tool.json'))).toBe(true)
    expect(results.every(result => result.task.filePath.includes('/business-libraries/'))).toBe(true)
  })
})

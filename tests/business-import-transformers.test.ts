import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
      ['归因编码', '归因名称', '所属模块', '权重基数', '工具标签', '归因说明'],
      ['HS_AT_CONFLICT', '家校沟通冲突升级', 'home_school', '1.5', 'home_school;conflict', '家长与教师之间的冲突正在升级'],
      ['HS_AT_BOUNDARY', '沟通边界不清', 'home_school', '1', 'home_school;boundary', '沟通职责边界模糊']
    ]), '⑤c 归因项')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['证据编码', '归因编码', '依据量表编码', '触发条件', '证据权重', '证据说明'],
      ['HS_EV_01', 'HS_AT_CONFLICT', 'HS_A1', 'conflict >= 4', '2', '冲突题项偏高，需要先降温。'],
      ['HS_EV_02', 'HS_AT_BOUNDARY', 'HS_A1', 'conflict >= 3', '1', '边界相关题项偏高。']
    ]), '⑤d 证据规则')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['规则编码', '所属模块', '优先级', '触发条件', '命中等级', '等级中文名', '严重度', '是否红线熔断'],
      ['home-school-high', 'home_school', '10', 'conflict >= 4', 'high', '需重点支持', '重度', '否'],
      ['home-school-default', 'home_school', '999', '', 'stable', '状态平稳', '轻度', '是']
    ]), '⑤e 分级规则')

    const filePath = join(mkdtempSync(join(tmpdir(), 'mentor-attribution-')), 'attribution.xlsx')
    XLSX.writeFile(workbook, filePath)

    const parsed = parseAttributionFile(filePath, 'home_school')
    expect(parsed.computed.conflict).toBe('MAX(scores)')
    expect(parsed.attributionItems).toHaveLength(2)
    expect(parsed.attributionItems[0]?.name).toBe('家校沟通冲突升级')
    expect(parsed.attributionItems[0]?.baseWeight).toBe(1.5)
    expect(parsed.evidences).toHaveLength(2)
    expect(parsed.evidences[0]?.attributionCode).toBe('HS_AT_CONFLICT')
    expect(parsed.gradingRules).toHaveLength(2)
    // 中文严重度归一化到统一枚举，与工具库共用
    expect(parsed.gradingRules[0]?.severity).toBe('high')
    expect(parsed.gradingRules[1]?.severity).toBe('low')
    // 兜底规则：无触发条件且优先级最大
    expect(parsed.gradingRules[1]?.when).toBeUndefined()
    expect(parsed.gradingRules[1]?.pri).toBe(999)
  })

  it('parses the v4 template including the ③ instrument role column', () => {
    // 用仓库内的真实 v4 模板做集成测试，锁死模板列名与解析候选词的对应关系
    const parsed = parseAssessmentFile(resolve('business-libraries/templates/三库填写模板_v4.xlsx'), 'self_growth')
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]?.code).toBe('SG_FIVE_Q')
    expect(parsed[0]?.instrumentRole).toBe('screening')
    expect(parsed[0]?.isRequired).toBe(true)
    expect(parsed[0]?.questions.length).toBeGreaterThan(0)
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
    expect(report.summary.attributionItemCount).toBe(2)
    expect(report.metrics.fallbackRuleCount).toBe(1)
    expect(report.metrics.toolTaggedAttributionRatio).toBe(1)
    // 每条归因项都必须有证据，否则永远算不出分
    expect(report.metrics.attributionsWithoutEvidence).toBe(0)
  })

  it('accepts golden tool samples and reports operational completeness', () => {
    const report = evaluateImportQuality({
      module: goldenModule,
      libraryType: 'tool',
      payload: goldenToolPayload
    })
    expect(report.status).toBe('pass')
    expect(report.summary.toolCount).toBe(1)
    expect(report.metrics.toolAttributionCodeRatio).toBe(1)
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
    // 五个模块各一份标准归因库（正式交付目录缺省时回退到 business-libraries/test-data/）
    expect(results).toHaveLength(5)
    expect(results.every(result => result.success)).toBe(true)
    expect(results.every(result => !result.task.filePath.includes('业务需求'))).toBe(true)
  })

  it('does not import legacy raw tool files unless explicitly requested', async () => {
    const results = await importAll({ dryRun: true, type: 'tool' })
    expect(results).toHaveLength(5)
    expect(results.every(result => result.success)).toBe(true)
    // 未显式要求时不得走 业务需求/ 下的原始 Excel
    expect(results.every(result => !result.task.filePath.includes('业务需求'))).toBe(true)
  })
})

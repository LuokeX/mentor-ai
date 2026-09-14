import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assessmentDefinitions } from '../shared/assessments'
import type { ModuleId } from '../shared/contracts'
import { assessmentReportSchema } from '../shared/reports'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../server/domain/reports'
import { evaluateAssessment } from '../server/domain/rules'
import { compactValidationError } from '../server/integrations/deepseek'

function answers(module: ModuleId, value: number) {
  return Object.fromEntries(assessmentDefinitions[module].questions.map(question => [question.id, value]))
}

describe('assessment reports', () => {
  it('creates complete template reports for every module', () => {
    for (const module of ['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]) {
      const result = evaluateAssessment(module, answers(module, 3))
      const report = createTemplateAssessmentReport({ module, result, generatedAt: new Date('2026-07-14T00:00:00.000Z') })
      expect(assessmentReportSchema.safeParse(report).success).toBe(true)
      expect(report.risk.level).toBe(result.level)
      expect(report.printMeta.source).toBe('template')
    }
  })

  it('uses module-specific report language and follow-up plans', () => {
    const reports = (['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]).map(module => {
      const result = evaluateAssessment(module, answers(module, 3))
      return createTemplateAssessmentReport({ module, result })
    })
    expect(new Set(reports.map(report => report.profile.title)).size).toBe(4)
    expect(new Set(reports.map(report => report.risk.description)).size).toBe(4)
    expect(reports.find(report => report.printMeta.module === 'home_school')?.profile.summary).toContain('家校沟通')
    expect(reports.find(report => report.printMeta.module === 'student_case')?.profile.summary).toContain('学生')
  })

  it('rejects AI reports that change deterministic rule level', () => {
    const result = evaluateAssessment('class_system', answers('class_system', 3))
    const report = createTemplateAssessmentReport({ module: 'class_system', result })
    const tampered = { ...report, risk: { ...report.risk, level: 'mature' } }
    expect(() => validateAssessmentReport(tampered, 'class_system', result)).toThrow('AI report changed rule level')
  })

  it('rejects forbidden diagnostic or guaranteed wording', () => {
    const result = evaluateAssessment('student_case', answers('student_case', 4))
    const report = createTemplateAssessmentReport({ module: 'student_case', result })
    const tampered = { ...report, profile: { ...report.profile, summary: `${report.profile.summary} 保证一定治愈。` } }
    expect(() => validateAssessmentReport(tampered, 'student_case', result)).toThrow('forbidden')
  })

  it('renders summary placeholders into the report', () => {
    const base = evaluateAssessment('home_school', answers('home_school', 3))
    const result = {
      ...base,
      level: 'orange',
      levelName: '需重点支持',
      severity: 'high' as const,
      primaryAttribution: '信任缺失',
      attributions: [{
        code: 'HS_AT_TRUST_LOSS', name: '信任缺失', rawScore: 3, share: 1, rank: 0,
        strength: 'primary' as const, reasons: ['信任维度得分低'], evidenceCodes: ['HS_EV_007'],
        description: '家校之间的信任基础已经受损', suggestedAction: '先做一次只核对事实的沟通'
      }],
      escalationTarget: '心理专员'
    }
    const templates = [
      { code: 'T1', module: 'home_school' as const, attributionLevel: 'orange', type: 'summary' as const, content: '当前${等级中文名}，重点「${最薄弱维度}」，主归因${主要归因}。', order: 1 }
    ]
    const report = createTemplateAssessmentReport({ module: 'home_school', result, outputTemplates: templates })
    expect(report.profile.summary).toContain('需重点支持')
    expect(report.profile.summary).not.toContain('${')
    // 教师方案页不展示的字段（evidence/attributionNarrative/toolIntro）已彻底移除，报告不应再携带这些键
    expect((report as Record<string, unknown>).attributionNarrative).toBeUndefined()
    expect((report as Record<string, unknown>).toolIntro).toBeUndefined()
    expect((report as Record<string, unknown>).evidence).toBeUndefined()
  })
})

/**
 * 线上实测（2026-08-19 ~ 09-07）：报告生成约 19% 失败，绝大多数是模型输出超出 schema 上限
 * 被 too_big 拒收。这里固定「长度只归一化、语义仍拒绝」两条边界，避免以后又把超长当失败。
 */
describe('AI 报告输出的长度归一化', () => {
  /** 造一份「模型写得很啰嗦」的合法报告：规则 ID 与归因名都取自确定性结果，语义上应当放行。 */
  function noisyReport() {
    const module: ModuleId = 'student_case'
    const base = evaluateAssessment(module, answers(module, 4))
    const ruleIds = Array.from({ length: 45 }, (_, index) => `CASE-RULE-${index}`)
    const attributions = Array.from({ length: 9 }, (_, index) => ({
      code: `CASE_AT_${index}`,
      name: `归因${index}`,
      rawScore: 3,
      share: 1,
      rank: index,
      strength: 'reference' as const,
      reasons: Array.from({ length: 20 }, () => `依据内容${'补'.repeat(600)}`),
      evidenceCodes: ['CASE_EV_001'],
      description: '模型对这条归因的说明',
      suggestedAction: '模型建议的动作'
    }))
    const result = { ...base, matchedRuleIds: ruleIds, attributions }
    const report = createTemplateAssessmentReport({ module, result })
    return {
      module,
      result,
      report: {
        ...report,
        profile: { ...report.profile, summary: `很长的摘要${'补'.repeat(2000)}` },
        risk: { ...report.risk, description: `很长的等级说明${'补'.repeat(2000)}`, nonDiagnosticNote: `很长的免责段${'补'.repeat(1000)}` },
        attributions,
        printMeta: {
          ...report.printMeta,
          moduleTitle: `很长的模块名${'补'.repeat(200)}`,
          ruleIds,
          disclaimer: `很长的免责声明${'补'.repeat(1000)}`
        }
      }
    }
  }

  it('把超长的字符串与数组截断到上限，而不是判定生成失败', () => {
    const { module, result, report } = noisyReport()
    const parsed = validateAssessmentReport(report, module, result)

    expect(parsed.attributions).toHaveLength(5)
    expect(parsed.attributions[0]!.reasons).toHaveLength(12)
    expect(parsed.attributions[0]!.reasons[0]!.length).toBe(500)
    expect(parsed.printMeta.ruleIds).toHaveLength(40)
    expect(parsed.printMeta.disclaimer.length).toBe(400)
    expect(parsed.printMeta.moduleTitle.length).toBe(80)
    expect(parsed.profile.summary.length).toBe(700)
    expect(parsed.risk.description.length).toBe(500)
    expect(parsed.risk.nonDiagnosticNote.length).toBe(300)
    // 归一化只截断，不改写语义字段
    expect(parsed.risk.level).toBe(result.level)
    expect(parsed.printMeta.module).toBe(module)
  })

  it('归一化不放行语义问题：改等级、未知归因、未知规则 ID、违禁词仍然拒收', () => {
    const { module, result, report } = noisyReport()
    expect(() => validateAssessmentReport({ ...report, risk: { ...report.risk, level: 'L9' } }, module, result))
      .toThrow('AI report changed rule level')
    expect(() => validateAssessmentReport({
      ...report,
      attributions: [{ ...report.attributions[0]!, name: '模型自己编的归因' }]
    }, module, result)).toThrow('AI report used unknown attribution')
    expect(() => validateAssessmentReport({
      ...report,
      printMeta: { ...report.printMeta, ruleIds: ['RULE-NOT-MATCHED'] }
    }, module, result)).toThrow('AI report used unknown rule id')
    expect(() => validateAssessmentReport({
      ...report,
      profile: { ...report.profile, summary: '本报告可以保证一定治愈。' }
    }, module, result)).toThrow('forbidden wording')
  })

  it('归一化不修补缺失或类型错误，仍由 schema 拒收', () => {
    const { module, result, report } = noisyReport()
    expect(() => validateAssessmentReport({ ...report, attributions: 'not-an-array' }, module, result)).toThrow()
    expect(() => validateAssessmentReport({
      ...report,
      printMeta: { ...report.printMeta, ruleIds: [] }
    }, module, result)).toThrow()
    expect(() => validateAssessmentReport({
      ...report,
      profile: { ...report.profile, title: '短' }
    }, module, result)).toThrow()
  })
})

/**
 * 报告失败的记录格式：error_code 列宽 80，路径必须排在前面，
 * 否则 2026-08 那种「一段被截断的 JSON 花括号」会重现，事后仍然查不出字段。
 */
describe('报告失败的审计格式', () => {
  it('Zod 报错压缩成「原因 + 字段路径 + 上限」，且路径在 80 字符内可见', () => {
    const parsed = z.object({ attributions: z.array(z.object({ reasons: z.array(z.string().max(12)) })).max(5) }).safeParse({
      attributions: Array.from({ length: 7 }, () => ({ reasons: ['依据内容足够长'] }))
    })
    expect(parsed.success).toBe(false)
    const text = compactValidationError(parsed.error)
    expect(text).toContain('too_big')
    expect(text).toContain('attributions')
    expect(text).toContain('max=5')
    expect(text.slice(0, 80)).toContain('attributions')
  })

  it('非 Zod 错误保留原始信息，未知错误给出占位文本', () => {
    expect(compactValidationError(new Error('AI report used unknown attribution'))).toBe('AI report used unknown attribution')
    expect(compactValidationError('boom')).toBe('unknown')
  })
})
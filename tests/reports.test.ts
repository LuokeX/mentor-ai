import { describe, expect, it } from 'vitest'
import { assessmentDefinitions } from '../shared/assessments'
import type { ModuleId } from '../shared/contracts'
import { assessmentReportSchema } from '../shared/reports'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../server/domain/reports'
import { evaluateAssessment } from '../server/domain/rules'

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

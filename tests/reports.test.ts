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
      expect(report.threeDayPlan).toHaveLength(3)
      expect(report.sevenDayFollowUp.escalationSignals.length).toBeGreaterThan(0)
      expect(report.scripts.length).toBeGreaterThan(0)
      expect(report.supportGoal?.weeklyGoal).toBeTruthy()
      expect(report.firstAction?.title).toBeTruthy()
      expect(report.toolPrescriptions?.length).toBeGreaterThan(0)
      expect(report.escalationConditions?.length).toBeGreaterThan(0)
      expect(report.successCriteria?.length).toBeGreaterThan(0)
      expect(report.printMeta.source).toBe('template')
    }
  })

  it('uses module-specific report language and follow-up plans', () => {
    const reports = (['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]).map(module => {
      const result = evaluateAssessment(module, answers(module, 3))
      return createTemplateAssessmentReport({ module, result })
    })
    expect(new Set(reports.map(report => report.profile.title)).size).toBe(4)
    expect(new Set(reports.map(report => report.threeDayPlan.map(day => day.title).join('|'))).size).toBe(4)
    expect(new Set(reports.map(report => report.sevenDayFollowUp.observationPoints.join('|'))).size).toBe(4)
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
})

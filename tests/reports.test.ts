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
      expect(report.sevenDayFollowUp.escalationSignals.length).toBeGreaterThan(0)
      expect(report.scripts.length).toBeGreaterThan(0)
      expect(report.supportGoal?.weeklyGoal).toBeTruthy()
      expect(report.firstAction?.title).toBeTruthy()
      expect(report.printMeta.source).toBe('template')
    }
  })

  it('uses module-specific report language and follow-up plans', () => {
    const reports = (['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]).map(module => {
      const result = evaluateAssessment(module, answers(module, 3))
      return createTemplateAssessmentReport({ module, result })
    })
    expect(new Set(reports.map(report => report.profile.title)).size).toBe(4)
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

  it('renders extended placeholders and attribution/tool template types', () => {
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
      tools: [{ title: '三分钟冷静法', content: '1) 停 2) 呼吸 3) 再开口' }],
      escalationTarget: '心理专员'
    }
    const templates = [
      { code: 'T1', module: 'home_school' as const, attributionLevel: 'orange', type: 'summary' as const, content: '当前${等级中文名}，重点「${最薄弱维度}」，主归因${主要归因}。', order: 1 },
      { code: 'T2', module: 'home_school' as const, attributionLevel: 'orange', type: 'attribution' as const, content: '归因诊断：${主要归因}（${归因说明}），关键撬动点为${关键撬动点}。', order: 2 },
      { code: 'T3', module: 'home_school' as const, attributionLevel: 'orange', type: 'tool' as const, content: '推荐工具：${工具名称}（${操作步骤摘要}）。', order: 3 },
      { code: 'T4', module: 'home_school' as const, attributionLevel: 'orange', type: 'action' as const, content: '请联系${责任人}跟进。', order: 4 }
    ]
    const report = createTemplateAssessmentReport({ module: 'home_school', result, outputTemplates: templates })
    expect(report.profile.summary).toContain('需重点支持')
    expect(report.profile.summary).not.toContain('${')
    expect(report.attributionNarrative).toBe('归因诊断：信任缺失（家校之间的信任基础已经受损），关键撬动点为先做一次只核对事实的沟通。')
    expect(report.toolIntro).toBe('推荐工具：三分钟冷静法（1) 停 2) 呼吸 3) 再开口）。')
    expect(report.firstAction?.detail).toContain('心理专员')
  })

  it('skips attribution/tool templates when there are no attributions or tools', () => {
    const base = evaluateAssessment('home_school', answers('home_school', 3))
    const result = { ...base, attributions: [], tools: [] }
    const templates = [
      { code: 'T2', module: 'home_school' as const, attributionLevel: 'none', type: 'attribution' as const, content: '归因诊断：${主要归因}。', order: 1 },
      { code: 'T3', module: 'home_school' as const, attributionLevel: 'none', type: 'tool' as const, content: '推荐工具：${工具名称}。', order: 2 }
    ]
    const report = createTemplateAssessmentReport({ module: 'home_school', result, outputTemplates: templates })
    expect(report.attributionNarrative).toBeUndefined()
    expect(report.toolIntro).toBeUndefined()
  })

  it('truncates oversized tool body injected into scripts instead of failing', () => {
    const base = evaluateAssessment('home_school', answers('home_school', 3))
    const longBody = `步骤 1：${'详细做法 '.repeat(80)}\n步骤 2：${'话术示例 '.repeat(80)}\n步骤 3：${'达标标准 '.repeat(80)}`
    expect(longBody.length).toBeGreaterThan(500)
    const result = { ...base, tools: [{ title: `超长工具名称${'甲'.repeat(90)}`, content: longBody }] }
    const report = createTemplateAssessmentReport({ module: 'home_school', result })
    expect(assessmentReportSchema.safeParse(report).success).toBe(true)
    const toolScript = report.scripts[report.scripts.length - 1]
    expect(toolScript!.scenario.length).toBeLessThanOrEqual(80)
    expect(toolScript!.text.length).toBeLessThanOrEqual(500)
    expect(toolScript!.text.length).toBeGreaterThan(6)
  })
})

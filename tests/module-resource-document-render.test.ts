import { describe, expect, it } from 'vitest'
import { renderVersionDocument } from '../server/domain/module-resource-document-render'

describe('renderVersionDocument', () => {
  it('renders an assessment library payload with instruments, questions and options', () => {
    const result = renderVersionDocument({
      libraryType: 'assessment',
      module: 'self_growth',
      libraryName: '教师状态评估量表库',
      version: '2.0.0',
      payload: {
        instruments: [{
          code: 'SG_FIVE_Q',
          title: '班主任状态五问',
          description: '回顾最近一周的真实状态，系统将依据确定性规则给出提示。',
          estimatedMinutes: 3,
          questions: [
            { id: 'q1', text: '这一周，我有多少时间感到身心疲惫、难以恢复？', dimension: '情绪状态', options: [
              { label: '几乎没有', value: 1 }, { label: '很少', value: 2 }, { label: '有时', value: 3 }, { label: '经常', value: 4 }
            ] },
            { id: 'q2', text: '这一周，有多少次我觉得“当班主任是值得的”？', dimension: '意义感知', options: [
              { label: '几乎没有', value: 1 }, { label: '很少', value: 2 }, { label: '有时', value: 3 }, { label: '经常', value: 4 }
            ] }
          ],
          dimensionDefs: [{ code: 'EMO', name: '情绪状态', description: '教师情绪耗竭程度' }]
        }]
      }
    })

    expect(result.title).toBe('教师状态评估量表库（自我成长）v2.0.0')
    expect(result.content).toContain('班主任状态五问')
    expect(result.content).toContain('回顾最近一周的真实状态')
    expect(result.content).toContain('预计用时：3 分钟')
    expect(result.content).toContain('这一周，我有多少时间感到身心疲惫、难以恢复？')
    expect(result.content).toContain('几乎没有')
    expect(result.content).toContain('（4 分）')
    expect(result.content).toContain('情绪状态')
  })

  it('renders an attribution library payload with items, evidences, grading rules and red lines', () => {
    const result = renderVersionDocument({
      libraryType: 'attribution',
      module: 'home_school',
      libraryName: '家校沟通归因库',
      version: '1.0.0',
      payload: {
        module: 'home_school',
        version: '1.0.0',
        attributionItems: [{
          code: 'HS_AT_CONFLICT',
          name: '家校沟通升级',
          module: 'home_school',
          description: '家长情绪激烈时沟通难以推进',
          highManifestation: '家长反复抱怨并拒绝合作',
          typicalTrigger: '成绩波动后家长到校',
          suggestedAction: '先安抚情绪再沟通'
        }],
        evidences: [{
          attributionCode: 'HS_AT_CONFLICT',
          assessmentCode: 'HS_SCALE_A',
          evidenceCode: 'HS_EV_01',
          condition: 'conflict >= 4',
          description: '家校互动中出现高冲突信号',
          weight: 1
        }],
        gradingRules: [{
          ruleId: 'home-school-high-conflict',
          pri: 999,
          level: 'high',
          levelName: '高冲突',
          severity: 'high',
          resultDescription: '需要年级协同支持并启动升级流程'
        }],
        redLines: [{
          module: 'home_school',
          condition: '家长出现人身威胁',
          description: '出现人身威胁必须立即升级处置',
          scope: 'system',
          requiredActions: '立即上报学校安全负责人'
        }]
      }
    })

    expect(result.title).toBe('家校沟通归因库（家校沟通）v1.0.0')
    expect(result.content).toContain('家校沟通升级')
    expect(result.content).toContain('conflict >= 4')
    expect(result.content).toContain('需要年级协同支持并启动升级流程')
    expect(result.content).toContain('出现人身威胁必须立即升级处置')
  })

  it('renders a tool library payload with symptoms, steps and scripts', () => {
    const result = renderVersionDocument({
      libraryType: 'tool',
      module: 'home_school',
      libraryName: '家校沟通工具库',
      version: '1.0.0',
      payload: {
        tools: [{
          code: 'T_HS_CONFLICT_01',
          name: '家校冲突沟通五步法',
          form: '话术工具',
          symptoms: '家长情绪激动、沟通中断',
          expectedEffect: '恢复沟通秩序并达成共识',
          steps: ['先倾听并复述家长诉求', '澄清双方边界', '给出下一步约定'],
          scripts: '我理解您现在很着急，我们先确认一下目前的情况……',
          targetUsers: '班主任',
          evidenceLevel: 'B',
          evidenceSource: '校内实践手册',
          structuredSteps: [{
            seq: 1,
            title: '倾听复述',
            description: '完整复述家长诉求确认理解一致',
            estimatedTime: '5 分钟'
          }],
          contraindicationRules: [{
            condition: '家长有暴力倾向',
            type: 'block',
            description: '立即终止当面沟通并上报',
            applicableTeacherGroup: '班主任'
          }]
        }]
      }
    })

    expect(result.title).toBe('家校沟通工具库（家校沟通）v1.0.0')
    expect(result.content).toContain('家校冲突沟通五步法')
    expect(result.content).toContain('家长情绪激动、沟通中断')
    expect(result.content).toContain('先倾听并复述家长诉求')
    expect(result.content).toContain('话术工具')
  })

  it('returns empty content for empty payloads while keeping the title', () => {
    for (const libraryType of ['assessment', 'attribution', 'tool'] as const) {
      const result = renderVersionDocument({
        libraryType,
        module: 'self_growth',
        libraryName: '空库',
        version: '1.0.0',
        payload: {}
      })
      expect(result.content).toBe('')
      expect(result.title).toBe('空库（自我成长）v1.0.0')
    }
  })
})
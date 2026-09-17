import { describe, expect, it } from 'vitest'
import {
  buildAssessmentRecordRow,
  buildAttemptItems,
  buildRecordPlanRef,
  resolveLatestBlockedAttemptId,
  resolvePrimaryReport,
  resolveRecordStatus,
  summarizeSessionAttempts,
  type SessionAttemptRow
} from '../server/domain/assessment-records'

function attempt(input: Partial<SessionAttemptRow> & { attemptId: string }): SessionAttemptRow {
  return {
    sequence: 0,
    assessmentCode: 'SG_FIVE_Q',
    submittedAt: new Date('2026-09-01T02:00:00Z'),
    result: {},
    ...input
  }
}

const T1 = new Date('2026-09-01T02:00:00Z')
const T2 = new Date('2026-09-01T03:00:00Z')

describe('评估记录：组内提交聚合', () => {
  it('多张量表聚合成一条记录，量表名按首次提交顺序去重', () => {
    const digest = summarizeSessionAttempts([
      attempt({ attemptId: 'a1', sequence: 0, assessmentCode: 'SG_FIVE_Q', submittedAt: T1, result: { level: 'green' } }),
      attempt({
        attemptId: 'a2',
        sequence: 1,
        assessmentCode: 'SG_DEEP',
        submittedAt: T2,
        result: { level: 'orange', report: { risk: { level: 'red', label: '需关注', severity: 'high' } } }
      }),
      // 同一张量表复评：编码不重复出现，但提交记录保留
      attempt({ attemptId: 'a3', sequence: 2, assessmentCode: 'SG_FIVE_Q', submittedAt: T2, result: { level: 'green' } })
    ])

    expect(digest.attemptIds).toEqual(['a1', 'a2', 'a3'])
    expect(digest.instrumentCodes).toEqual(['SG_FIVE_Q', 'SG_DEEP'])
    expect(digest.lastSubmittedAt?.toISOString()).toBe(T2.toISOString())
    expect(digest.hasReport).toBe(true)
  })

  it('等级优先取报告的风险等级，报告缺失时退回本次规则结果', () => {
    const digest = summarizeSessionAttempts([
      attempt({ attemptId: 'a1', sequence: 0, submittedAt: T1, result: { level: 'green', levelName: '状态良好', severity: 'low' } }),
      attempt({
        attemptId: 'a2',
        sequence: 1,
        submittedAt: T2,
        result: {
          level: 'orange',
          levelName: '需支持',
          risk: undefined,
          report: { risk: { level: 'yellow', label: '关注', severity: 'medium' } }
        }
      })
    ])

    // 报告是组内合并结论，与详情页报告顶部徽章一致
    expect(digest.level).toBe('yellow')
    expect(digest.levelName).toBe('关注')
    expect(digest.severity).toBe('medium')
  })

  it('乱序输入按提交时间排序，同一时刻按 sequence 稳定排序', () => {
    const digest = summarizeSessionAttempts([
      attempt({ attemptId: 'late', sequence: 0, assessmentCode: 'CS_SYS', submittedAt: T2 }),
      attempt({ attemptId: 'early', sequence: 5, assessmentCode: 'CS_FIVE', submittedAt: T1 })
    ])

    expect(digest.attemptIds).toEqual(['early', 'late'])
    expect(digest.instrumentCodes).toEqual(['CS_FIVE', 'CS_SYS'])
  })
})

describe('评估记录：状态与熔断标记', () => {
  it('熔断优先决定记录状态', () => {
    expect(resolveRecordStatus({ sessionStatus: 'open', hasBlocked: false })).toBe('active')
    expect(resolveRecordStatus({ sessionStatus: 'completed', hasBlocked: false })).toBe('completed')
    expect(resolveRecordStatus({ sessionStatus: 'completed', hasBlocked: true })).toBe('referred')
    // 熔断一定关闭评估组，但历史数据可能残留 open 状态，这里仍然按熔断处理
    expect(resolveRecordStatus({ sessionStatus: 'open', hasBlocked: true })).toBe('referred')
  })

  it('熔断提交没有报告：等级退回规则结果，且不产生可用报告', () => {
    const rows = [
      attempt({
        attemptId: 'fuse',
        sequence: 0,
        submittedAt: T1,
        result: { blocked: true, level: 'purple', levelName: '需转介', severity: 'crisis' }
      })
    ]

    const digest = summarizeSessionAttempts(rows)
    expect(digest.hasBlocked).toBe(true)
    expect(digest.hasReport).toBe(false)
    expect(digest.level).toBe('purple')
    expect(digest.levelName).toBe('需转介')
    expect(resolveLatestBlockedAttemptId(rows)).toBe('fuse')
    expect(resolvePrimaryReport(rows)).toBeNull()
  })

  it('熔断前已有量表报告时保留最早那份报告，用于取证而不是当成本次结论', () => {
    const rows = [
      attempt({
        attemptId: 'a1',
        sequence: 0,
        submittedAt: T1,
        result: { report: { risk: { level: 'green', label: '状态良好', severity: 'low' } } }
      }),
      attempt({ attemptId: 'fuse', sequence: 1, submittedAt: T2, result: { blocked: true, level: 'purple' } })
    ]

    expect(resolvePrimaryReport(rows)).toMatchObject({ risk: { level: 'green' } })
    expect(resolveLatestBlockedAttemptId(rows)).toBe('fuse')
    // 状态为已转介，详情页据此不展示报告区（结论已切换为转介处置）
    expect(resolveRecordStatus({ sessionStatus: 'completed', hasBlocked: true })).toBe('referred')
  })

  it('没有熔断提交时不产生转介标记', () => {
    const rows = [attempt({ attemptId: 'a1', result: { level: 'green' } })]
    expect(summarizeSessionAttempts(rows).hasBlocked).toBe(false)
    expect(resolveLatestBlockedAttemptId(rows)).toBeNull()
  })
})

describe('评估记录：详情条目与行装配', () => {
  it('单次提交条目带上量表名与报告状态，编码缺失时退回编码', () => {
    const items = buildAttemptItems([
      attempt({
        attemptId: 'a1',
        sequence: 0,
        assessmentCode: 'SG_FIVE_Q',
        submittedAt: T1,
        result: { report: { risk: { level: 'green', label: '状态良好', severity: 'low' } } }
      }),
      attempt({ attemptId: 'a2', sequence: 1, assessmentCode: 'UNKNOWN_CODE', submittedAt: T2 })
    ], { SG_FIVE_Q: '五问自评' })

    expect(items[0]).toMatchObject({
      instrumentName: '五问自评',
      level: 'green',
      levelName: '状态良好',
      severity: 'low',
      hasReport: true,
      blocked: false
    })
    expect(items[1]).toMatchObject({ instrumentName: 'UNKNOWN_CODE', hasReport: false })
  })

  it('冻结方案在记录列表里带已停止标记', () => {
    expect(buildRecordPlanRef({
      id: 'p1', title: '班级秩序建设', titleFull: null, status: 'escalated', acceptedAt: null
    }).frozenBeforeAcceptance).toBe(true)

    // 复盘判定需要协同升级出的 escalated 仍可复盘，不是接受前冻结
    expect(buildRecordPlanRef({
      id: 'p2', title: '家校沟通', titleFull: null, status: 'escalated', acceptedAt: new Date()
    }).frozenBeforeAcceptance).toBe(false)
    expect(buildRecordPlanRef({
      id: 'p3', title: '自我成长', titleFull: null, status: 'accepted', acceptedAt: new Date()
    }).frozenBeforeAcceptance).toBe(false)
  })

  it('装配列表行：进行中的组可继续，开放组与对象类型正确投影', () => {
    const digest = summarizeSessionAttempts([
      attempt({ attemptId: 'a1', sequence: 0, assessmentCode: 'SG_FIVE_Q', submittedAt: T1, result: { level: 'green', levelName: '状态良好', severity: 'low' } })
    ])
    const row = buildAssessmentRecordRow({
      session: {
        id: 's1',
        module: 'self_growth',
        moduleTitle: '自我成长赋能',
        status: 'open',
        contextType: 'student',
        createdAt: T1,
        updatedAt: T1,
        completedAt: null
      },
      digest,
      objectLabel: '李同学',
      plan: null,
      instrumentNames: { SG_FIVE_Q: '五问自评' }
    })

    expect(row).toMatchObject({
      id: 's1',
      status: 'active',
      canContinue: true,
      objectType: 'student',
      objectLabel: '李同学',
      levelName: '状态良好',
      instrumentNames: ['五问自评'],
      instrumentCount: 1,
      plan: null
    })
  })

  it('无对象的直接评估不显示对象类型，已关闭的组不能继续', () => {
    const digest = summarizeSessionAttempts([attempt({ attemptId: 'a1', result: {} })])
    const row = buildAssessmentRecordRow({
      session: {
        id: 's2',
        module: 'self_growth',
        moduleTitle: '自我成长赋能',
        status: 'completed',
        contextType: 'none',
        createdAt: T1,
        updatedAt: T2,
        completedAt: T2
      },
      digest,
      objectLabel: null,
      plan: buildRecordPlanRef({ id: 'p1', title: '方案', titleFull: null, status: 'accepted', acceptedAt: T2 })
    })

    expect(row.status).toBe('completed')
    expect(row.canContinue).toBe(false)
    expect(row.objectType).toBeNull()
    // 未传量表名映射时退回编码，列表不会因此缺列
    expect(row.instrumentNames).toEqual(['SG_FIVE_Q'])
    expect(row.plan?.id).toBe('p1')
  })
})

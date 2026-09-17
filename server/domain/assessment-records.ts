/**
 * 评估记录（教师端历史回看）的装配逻辑。
 *
 * 一条记录 = 一个评估组（assessment_sessions）：同一业务问题下连续提交的多张量表
 * 聚合在一条记录里，方案与安全熔断都发生在组这一层。按单次提交列会把同一份方案
 * 重复展示多次，教师无法判断该点哪条。
 *
 * 这里的函数全部是纯函数：只做「组内提交 → 记录摘要」的装配与状态判定，
 * 数据库查询与权限解析留在路由层，便于用 Vitest 覆盖边界（多量表聚合、熔断标记、
 * 报告缺失时的等级降级）。
 */
import { isPlanFrozenBeforeAcceptance } from '../../shared/reports'

/** 记录状态：进行中（组仍开放，可继续做量表）/ 已完成 / 已启动安全转介 */
export type AssessmentRecordStatus = 'active' | 'completed' | 'referred'

/** 组内一次已提交的量表（路由层按 sequence 取出后的最小形态） */
export interface SessionAttemptRow {
  attemptId: string
  sequence: number
  assessmentCode: string
  submittedAt: Date | null
  result: Record<string, unknown> | null
}

export interface SessionAttemptDigest {
  /** 组内全部已提交评估，按提交顺序 */
  attemptIds: string[]
  /** 组内量表编码，按首次提交顺序去重 */
  instrumentCodes: string[]
  /** 组内是否发生过安全熔断（任一提交命中红线） */
  hasBlocked: boolean
  /** 组内是否存在可用报告（熔断提交不生成报告） */
  hasReport: boolean
  /** 最新一次提交时间 */
  lastSubmittedAt: Date | null
  /** 结论等级编码（优先取报告的风险等级，报告缺失时退回本次规则结果） */
  level: string | null
  /** 结论等级展示名 */
  levelName: string | null
  /** 严重度枚举，前端据此取色 */
  severity: string | null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readObject(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = source?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function attemptTime(row: SessionAttemptRow): number {
  return row.submittedAt ? row.submittedAt.getTime() : Number.NEGATIVE_INFINITY
}

/** 组内提交按时间升序；同一时刻（批量补录）按 sequence 保证顺序稳定 */
function sortAttempts(rows: SessionAttemptRow[]): SessionAttemptRow[] {
  return [...rows].sort((a, b) => {
    const diff = attemptTime(a) - attemptTime(b)
    return diff !== 0 ? diff : a.sequence - b.sequence
  })
}

/**
 * 把一个评估组内的已提交量表汇总成记录摘要。
 *
 * 等级优先取「最新一份报告」的风险等级：报告是组内多张量表的合并结论，与教师
 * 点进去看到的报告顶部徽章一致；熔断提交没有报告，退回本次规则结果。
 */
export function summarizeSessionAttempts(rows: SessionAttemptRow[]): SessionAttemptDigest {
  const ordered = sortAttempts(rows)

  const instrumentCodes: string[] = []
  const attemptIds: string[] = []
  let hasBlocked = false
  let hasReport = false
  let lastSubmittedAt: Date | null = null
  let latest: SessionAttemptRow | null = null
  let reportRisk: Record<string, unknown> | null = null

  for (const row of ordered) {
    if (row.attemptId) attemptIds.push(row.attemptId)
    if (row.assessmentCode && !instrumentCodes.includes(row.assessmentCode)) instrumentCodes.push(row.assessmentCode)
    if (row.result?.blocked === true) hasBlocked = true
    if (row.submittedAt) {
      if (!lastSubmittedAt || row.submittedAt > lastSubmittedAt) lastSubmittedAt = row.submittedAt
      // ordered 已按时间升序，最后一次带时间的赋值即最新一次提交
      latest = row
    }
    const report = readObject(row.result, 'report')
    if (report) {
      hasReport = true
      const risk = readObject(report, 'risk')
      if (risk) reportRisk = risk
    }
  }

  return {
    attemptIds,
    instrumentCodes,
    hasBlocked,
    hasReport,
    lastSubmittedAt,
    level: readString(reportRisk, 'level') ?? readString(latest?.result ?? null, 'level'),
    levelName: readString(reportRisk, 'label') ?? readString(latest?.result ?? null, 'levelName'),
    severity: readString(reportRisk, 'severity') ?? readString(latest?.result ?? null, 'severity')
  }
}

/** 详情页的组内单次提交摘要 */
export interface AssessmentRecordAttemptItem {
  id: string
  assessmentCode: string
  instrumentName: string
  submittedAt: Date | null
  level: string | null
  levelName: string | null
  severity: string | null
  blocked: boolean
  hasReport: boolean
}

/** 组内每次提交的展示条目，按提交顺序 */
export function buildAttemptItems(rows: SessionAttemptRow[], instrumentNames: Record<string, string> = {}): AssessmentRecordAttemptItem[] {
  return sortAttempts(rows).map((row) => {
    const report = readObject(row.result, 'report')
    const risk = readObject(report, 'risk')
    return {
      id: row.attemptId,
      assessmentCode: row.assessmentCode,
      instrumentName: instrumentNames[row.assessmentCode] || row.assessmentCode,
      submittedAt: row.submittedAt,
      level: readString(risk, 'level') ?? readString(row.result, 'level'),
      levelName: readString(risk, 'label') ?? readString(row.result, 'levelName'),
      severity: readString(risk, 'severity') ?? readString(row.result, 'severity'),
      blocked: row.result?.blocked === true,
      hasReport: report !== null
    }
  })
}

/**
 * 组内主报告：最新一份带报告的提交。
 *
 * 每次提交写入的都是「组内全部量表的合并报告」，所以最后一份覆盖最全；
 * 熔断提交不写报告，会被自动跳过。
 */
export function resolvePrimaryReport(rows: SessionAttemptRow[]): Record<string, unknown> | null {
  let report: Record<string, unknown> | null = null
  for (const row of sortAttempts(rows)) {
    const current = readObject(row.result, 'report')
    if (current) report = current
  }
  return report
}

/** 触发熔断的提交（详情页据此恢复转介处置载荷）；组关闭后不再有新提交，取最后一次即可 */
export function resolveLatestBlockedAttemptId(rows: SessionAttemptRow[]): string | null {
  let attemptId: string | null = null
  for (const row of sortAttempts(rows)) {
    if (row.result?.blocked === true) attemptId = row.attemptId
  }
  return attemptId
}

/** 组状态 + 是否有熔断提交 → 记录状态；熔断优先（它决定了记录只能走转介处置） */
export function resolveRecordStatus(input: { sessionStatus: string, hasBlocked: boolean }): AssessmentRecordStatus {
  if (input.hasBlocked) return 'referred'
  return input.sessionStatus === 'open' ? 'active' : 'completed'
}

/** 关联方案的展示字段：冻结标记与方案列表/详情页同一判定 */
export interface AssessmentRecordPlanRef {
  id: string
  title: string
  titleFull: string | null
  status: string
  frozenBeforeAcceptance: boolean
}

export function buildRecordPlanRef(plan: {
  id: string
  title: string
  titleFull: string | null
  status: string
  acceptedAt: Date | null
}): AssessmentRecordPlanRef {
  return {
    id: plan.id,
    title: plan.title,
    titleFull: plan.titleFull,
    status: plan.status,
    frozenBeforeAcceptance: isPlanFrozenBeforeAcceptance({ status: plan.status, acceptedAt: plan.acceptedAt })
  }
}

export interface AssessmentRecordRow {
  id: string
  module: string
  moduleTitle: string
  status: AssessmentRecordStatus
  objectType: string | null
  objectLabel: string | null
  level: string | null
  levelName: string | null
  severity: string | null
  instrumentCodes: string[]
  instrumentNames: string[]
  instrumentCount: number
  lastSubmittedAt: Date | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
  hasReport: boolean
  /** 组仍开放：前端据此提供「继续完成」（深链回模块页续接同一评估组） */
  canContinue: boolean
  plan: AssessmentRecordPlanRef | null
}

/** 装配列表行；对象名与量表名由路由层查库解密后传入，域内不做 I/O */
export function buildAssessmentRecordRow(input: {
  session: {
    id: string
    module: string
    moduleTitle: string
    status: string
    contextType: string
    createdAt: Date
    updatedAt: Date
    completedAt: Date | null
  }
  digest: SessionAttemptDigest
  objectLabel: string | null
  plan: AssessmentRecordPlanRef | null
  instrumentNames?: Record<string, string>
}): AssessmentRecordRow {
  const status = resolveRecordStatus({ sessionStatus: input.session.status, hasBlocked: input.digest.hasBlocked })
  return {
    id: input.session.id,
    module: input.session.module,
    moduleTitle: input.session.moduleTitle,
    status,
    objectType: input.session.contextType === 'none' ? null : input.session.contextType,
    objectLabel: input.objectLabel,
    level: input.digest.level,
    levelName: input.digest.levelName,
    severity: input.digest.severity,
    instrumentCodes: input.digest.instrumentCodes,
    instrumentNames: input.digest.instrumentCodes.map(code => input.instrumentNames?.[code] || code),
    instrumentCount: input.digest.instrumentCodes.length,
    lastSubmittedAt: input.digest.lastSubmittedAt,
    createdAt: input.session.createdAt,
    updatedAt: input.session.updatedAt,
    completedAt: input.session.completedAt,
    hasReport: input.digest.hasReport,
    canContinue: status === 'active',
    plan: input.plan
  }
}

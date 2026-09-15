/**
 * 首页 AI 助手的只读数据读取层。
 *
 * 背景：Agent 原先只能读到知识片段、咨询对象档案与学生的姓名/班级，
 * 方案与复盘、历史评估、沟通记录、班级聚合、教师待办、三库资源明细全都读不到，
 * 回答因此容易停在通用层面。本模块把这些数据以「只读、限额、脱敏」的形式开放给工具层
 * （server/agent/tools/*），工具的 zod 校验留在工具文件，权限与披露口径集中在这里。
 *
 * 三条不变量：
 *  1. 所有查询同时约束 schoolId + ownerUserId（或该表等价的归属字段），越权只能读到空集合；
 *  2. 解密后的文本按学校数据模式过 redactOutboundText（full_context 原样，其余走 redactPii）；
 *  3. 每个函数自己限额与截断，返回体必须远小于 graph 的 8000 字符工具结果上限，
 *     否则工具轨迹会因超限被丢弃，下一轮的请求前缀随之分叉、缓存命中落空。
 */
import type { H3Event } from 'h3'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { ModuleId } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { decryptSensitive } from '../utils/crypto'
import { schema, useDb } from '../utils/db'
import { redactOutboundText, type AiDataMode } from './ai-governance'
import { listPublishedModuleTools, resolvePublishedModuleResource } from './module-resources'

/** 读取层统一的调用者视图：只保留归属与治理所需字段。 */
export interface AssistantReaderUser {
  schoolId: string
  userId: string
  dataMode?: AiDataMode
}

/** 与教师端「进行中的方案」口径一致（accepted/in_progress/review_due/adjustment_needed/escalated）。 */
export const ASSISTANT_ACTIVE_PLAN_STATUSES = ['accepted', 'in_progress', 'review_due', 'adjustment_needed', 'escalated'] as const

/** 需要主动关注的风险等级（沟通记录 riskLevel 取值：crisis | high | medium | low）。 */
export const ASSISTANT_ATTENTION_RISK_LEVELS = ['crisis', 'high'] as const

/** 统一的限额与截断口径。 */
export const ASSISTANT_READER_LIMITS = {
  /** 方案条数上限 */
  plans: 6,
  /** 每个方案带出的行动项上限 */
  planActions: 5,
  /** 沟通记录上限 */
  communications: 8,
  /** 待办简报里的沟通提醒上限 */
  briefCommunications: 2,
  /** 班级概览的学生上限（含每班与总量） */
  classStudents: 30,
  /** 班级概览的班级上限 */
  classOverviewClasses: 5,
  /** 未完成量表草稿上限 */
  drafts: 5,
  /** 历史已提交评估上限 */
  submittedAssessments: 8,
  /** 开放评估组上限 */
  openSessions: 5,
  /** 三库目录每类资源上限 */
  catalogPerType: 6,
  /** 单条文本截断长度 */
  textChars: 200,
  /** 资源摘要截断长度 */
  summaryChars: 120
} as const

/** 文本截断：超出时保留前缀并加省略号。 */
export function truncateAssistantText(text: string | null | undefined, max: number = ASSISTANT_READER_LIMITS.textChars): string {
  const value = (text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 外发脱敏：full_context 原样，其余按学校数据模式过 redactPii。 */
export function outboundAssistantText(text: string, mode: AiDataMode | undefined): string {
  return redactOutboundText(text, mode ?? 'redacted')
}

/** 时间字段转 ISO 字符串；空值返回 null（不猜测）。 */
export function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 从 JSONB 结果里取字符串字段（结果结构随规则版本变化，取不到就返回 null，不猜）。 */
export function pickResultString(result: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = result?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 从确定性规则结果里取主归因名称（attributions[0].name）。 */
export function pickPrimaryAttribution(result: Record<string, unknown> | null | undefined): string | null {
  const list = result?.attributions
  if (!Array.isArray(list) || !list.length) return null
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  const name = (first as { name?: unknown }).name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/** 从确定性规则结果里取维度（只保留数值，避免把整段结构外发）。 */
export function pickDimensions(result: Record<string, unknown> | null | undefined): Record<string, number> {
  const raw = result?.dimensions
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.round(value * 100) / 100
  }
  return out
}

/** 从确定性规则结果里取等级类字段（level / levelName / severity）。 */
function pickPlanLevel(report: Record<string, unknown> | null | undefined): string | null {
  return pickResultString(report, 'levelName') || pickResultString(report, 'level')
}

/** 限额收敛：把调用方传入的 limit 夹到 [1, max]。 */
export function clampAssistantLimit(input: number | undefined, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return max
  return Math.min(max, Math.max(1, Math.floor(input)))
}

/** 解密并按数据模式脱敏 + 截断；解密失败返回空串，不向上抛错。 */
function readGovernedText(
  encrypted: string | null | undefined,
  secret: string,
  mode: AiDataMode | undefined,
  max: number = ASSISTANT_READER_LIMITS.textChars
): string {
  if (!encrypted) return ''
  try {
    return truncateAssistantText(outboundAssistantText(decryptSensitive(encrypted, secret), mode), max)
  } catch {
    return ''
  }
}

export interface AssistantPlanRow {
  id: string
  module: string
  title: string
  status: string
  nextReviewAt: string | null
  updatedAt: string
  actions: Array<{ title: string, status: string, dueAt: string | null, overdue: boolean }>
  lastReview: { reviewAt: string, effectScore: number, progressNote: string, nextAction: string } | null
}

/**
 * 读取当前教师进行中的方案与复盘（含行动项状态与逾期标记）。
 * 用途：回答「上周定的行动项做得怎么样」「哪些方案该复盘了」这类问题时给出真实清单。
 */
export async function readPlansForAssistant(
  event: H3Event,
  user: AssistantReaderUser,
  input: { limit?: number, studentId?: string, classId?: string, guardianId?: string } = {}
): Promise<{ plans: AssistantPlanRow[] }> {
  const db = useDb(event)
  const limit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.plans)
  const conditions = [
    eq(schema.plans.schoolId, user.schoolId),
    eq(schema.plans.ownerUserId, user.userId),
    inArray(schema.plans.status, [...ASSISTANT_ACTIVE_PLAN_STATUSES])
  ]
  if (input.studentId) conditions.push(eq(schema.plans.studentId, input.studentId))
  if (input.classId) conditions.push(eq(schema.plans.classId, input.classId))
  if (input.guardianId) conditions.push(eq(schema.plans.guardianId, input.guardianId))

  const plans = await db.select({
    id: schema.plans.id,
    module: schema.plans.module,
    title: schema.plans.title,
    status: schema.plans.status,
    nextReviewAt: schema.plans.nextReviewAt,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans)
    .where(and(...conditions))
    .orderBy(schema.plans.nextReviewAt)
    .limit(limit)
  if (!plans.length) return { plans: [] }

  const planIds = plans.map(plan => plan.id)
  const [actionRows, reviewRows] = await Promise.all([
    db.select({
      planId: schema.planActions.planId,
      title: schema.planActions.title,
      status: schema.planActions.status,
      dueAt: schema.planActions.dueAt
    }).from(schema.planActions)
      .where(and(
        inArray(schema.planActions.planId, planIds),
        eq(schema.planActions.schoolId, user.schoolId),
        eq(schema.planActions.ownerUserId, user.userId),
        eq(schema.planActions.decision, 'included'),
        inArray(schema.planActions.status, ['pending', 'in_progress'])
      ))
      .orderBy(schema.planActions.dueAt),
    db.select({
      planId: schema.planReviews.planId,
      reviewAt: schema.planReviews.reviewAt,
      effectScore: schema.planReviews.effectScore,
      progressNote: schema.planReviews.progressNote,
      nextAction: schema.planReviews.nextAction
    }).from(schema.planReviews)
      .where(and(
        inArray(schema.planReviews.planId, planIds),
        eq(schema.planReviews.schoolId, user.schoolId),
        eq(schema.planReviews.ownerUserId, user.userId)
      ))
      .orderBy(desc(schema.planReviews.reviewAt))
      .limit(planIds.length * 2)
  ])

  const actionsByPlan = new Map<string, AssistantPlanRow['actions']>()
  for (const row of actionRows) {
    const list = actionsByPlan.get(row.planId) || []
    if (list.length >= ASSISTANT_READER_LIMITS.planActions) continue
    list.push({
      title: truncateAssistantText(row.title, 60),
      status: row.status,
      dueAt: toIsoOrNull(row.dueAt),
      overdue: Boolean(row.dueAt && row.dueAt.getTime() < Date.now())
    })
    actionsByPlan.set(row.planId, list)
  }

  const reviewByPlan = new Map<string, AssistantPlanRow['lastReview']>()
  for (const row of reviewRows) {
    if (reviewByPlan.has(row.planId)) continue
    reviewByPlan.set(row.planId, {
      reviewAt: toIsoOrNull(row.reviewAt) || '',
      effectScore: row.effectScore,
      // 复盘正文是业务原文，只做截断（由调用方的数据模式决定是否已脱敏）
      progressNote: truncateAssistantText(row.progressNote, 120),
      nextAction: truncateAssistantText(row.nextAction, 120)
    })
  }

  return {
    plans: plans.map(plan => ({
      id: plan.id,
      module: plan.module,
      title: truncateAssistantText(plan.title, 80),
      status: plan.status,
      nextReviewAt: toIsoOrNull(plan.nextReviewAt),
      updatedAt: toIsoOrNull(plan.updatedAt) || '',
      actions: actionsByPlan.get(plan.id) || [],
      lastReview: reviewByPlan.get(plan.id) || null
    }))
  }
}

export interface AssistantAssessmentHistory {
  submitted: Array<{
    module: string
    assessmentCode: string
    submittedAt: string | null
    level: string | null
    levelName: string | null
    severity: string | null
    dimensions: Record<string, number>
    primaryAttribution: string | null
  }>
  drafts: Array<{ module: string, assessmentCode: string, answeredCount: number, updatedAt: string }>
  openSessions: Array<{ module: string, contextType: string, startedAt: string, submittedCount: number }>
}

/**
 * 读取当前教师的评估历史：已提交结论（等级/严重度/维度/主归因）、未完成草稿、开放评估组。
 * 结论字段一律来自确定性规则结果，本函数不做任何再判断。
 */
export async function readAssessmentHistoryForAssistant(
  event: H3Event,
  user: AssistantReaderUser,
  input: { module?: ModuleId, limit?: number } = {}
): Promise<AssistantAssessmentHistory> {
  const db = useDb(event)
  const submittedLimit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.submittedAssessments)
  const submittedConditions = [
    eq(schema.assessmentAttempts.schoolId, user.schoolId),
    eq(schema.assessmentAttempts.ownerUserId, user.userId),
    eq(schema.assessmentAttempts.status, 'submitted')
  ]
  if (input.module) submittedConditions.push(eq(schema.assessmentAttempts.module, input.module))

  const [submittedRows, draftRows, sessionRows] = await Promise.all([
    db.select({
      module: schema.assessmentAttempts.module,
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      submittedAt: schema.assessmentAttempts.submittedAt,
      result: schema.assessmentAttempts.result
    }).from(schema.assessmentAttempts)
      .where(and(...submittedConditions))
      .orderBy(desc(schema.assessmentAttempts.submittedAt))
      .limit(submittedLimit),
    db.select({
      module: schema.assessmentAttempts.module,
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      answers: schema.assessmentAttempts.answers,
      updatedAt: schema.assessmentAttempts.updatedAt
    }).from(schema.assessmentAttempts)
      .where(and(
        eq(schema.assessmentAttempts.schoolId, user.schoolId),
        eq(schema.assessmentAttempts.ownerUserId, user.userId),
        eq(schema.assessmentAttempts.status, 'draft'),
        ...(input.module ? [eq(schema.assessmentAttempts.module, input.module)] : [])
      ))
      .orderBy(desc(schema.assessmentAttempts.updatedAt))
      .limit(ASSISTANT_READER_LIMITS.drafts),
    db.select({
      id: schema.assessmentSessions.id,
      module: schema.assessmentSessions.module,
      contextType: schema.assessmentSessions.contextType,
      createdAt: schema.assessmentSessions.createdAt
    }).from(schema.assessmentSessions)
      .where(and(
        eq(schema.assessmentSessions.schoolId, user.schoolId),
        eq(schema.assessmentSessions.ownerUserId, user.userId),
        eq(schema.assessmentSessions.status, 'open'),
        ...(input.module ? [eq(schema.assessmentSessions.module, input.module)] : [])
      ))
      .orderBy(desc(schema.assessmentSessions.updatedAt))
      .limit(ASSISTANT_READER_LIMITS.openSessions)
  ])

  const sessionIds = sessionRows.map(session => session.id)
  const submittedCountBySession = new Map<string, number>()
  if (sessionIds.length) {
    const counts = await db.select({
      sessionId: schema.assessmentSessionAttempts.assessmentSessionId,
      total: sql<number>`count(*)::int`
    }).from(schema.assessmentSessionAttempts)
      .where(inArray(schema.assessmentSessionAttempts.assessmentSessionId, sessionIds))
      .groupBy(schema.assessmentSessionAttempts.assessmentSessionId)
    for (const row of counts) submittedCountBySession.set(row.sessionId, Number(row.total) || 0)
  }

  return {
    submitted: submittedRows.map(row => {
      const result = (row.result || null) as Record<string, unknown> | null
      return {
        module: row.module,
        assessmentCode: row.assessmentCode,
        submittedAt: toIsoOrNull(row.submittedAt),
        level: pickResultString(result, 'level'),
        levelName: pickResultString(result, 'levelName'),
        severity: pickResultString(result, 'severity'),
        dimensions: pickDimensions(result),
        primaryAttribution: pickPrimaryAttribution(result)
      }
    }),
    drafts: draftRows.map(row => ({
      module: row.module,
      assessmentCode: row.assessmentCode,
      answeredCount: Object.keys(row.answers || {}).length,
      updatedAt: toIsoOrNull(row.updatedAt) || ''
    })),
    openSessions: sessionRows.map(row => ({
      module: row.module,
      contextType: row.contextType,
      startedAt: toIsoOrNull(row.createdAt) || '',
      submittedCount: submittedCountBySession.get(row.id) || 0
    }))
  }
}

export interface AssistantCommunicationRow {
  occurredAt: string
  studentLabel: string | null
  guardianRelation: string | null
  parentType: string | null
  attitudeType: string | null
  riskLevel: string | null
  summary: string
}

/**
 * 读取当前教师的沟通记录（按学生或家长过滤），摘要已按数据模式脱敏。
 * 用途：回答「上次跟这位家长谈了什么」「这位家长之前的态度怎么样」。
 */
export async function readCommunicationsForAssistant(
  event: H3Event,
  user: AssistantReaderUser,
  input: { studentId?: string, guardianId?: string, limit?: number } = {}
): Promise<{ communications: AssistantCommunicationRow[] }> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const limit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.communications)
  const conditions = [
    eq(schema.communications.schoolId, user.schoolId),
    eq(schema.communications.ownerUserId, user.userId),
    eq(schema.communications.status, 'active')
  ]
  if (input.studentId) conditions.push(eq(schema.communications.studentId, input.studentId))
  if (input.guardianId) conditions.push(eq(schema.communications.guardianId, input.guardianId))

  const rows = await db.select({
    occurredAt: schema.communications.occurredAt,
    studentId: schema.communications.studentId,
    guardianId: schema.communications.guardianId,
    parentType: schema.communications.parentType,
    attitudeType: schema.communications.attitudeType,
    riskLevel: schema.communications.riskLevel,
    summaryEnc: schema.communications.summaryEnc
  }).from(schema.communications)
    .where(and(...conditions))
    .orderBy(desc(schema.communications.occurredAt))
    .limit(limit)
  if (!rows.length) return { communications: [] }

  const studentIds = [...new Set(rows.map(row => row.studentId).filter(Boolean))] as string[]
  const guardianIds = [...new Set(rows.map(row => row.guardianId).filter(Boolean))] as string[]
  const [students, guardians] = await Promise.all([
    studentIds.length
      ? db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
        .where(and(eq(schema.students.schoolId, user.schoolId), inArray(schema.students.id, studentIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string }>),
    guardianIds.length
      ? db.select({ id: schema.guardians.id, relation: schema.guardians.relation }).from(schema.guardians)
        .where(and(eq(schema.guardians.schoolId, user.schoolId), inArray(schema.guardians.id, guardianIds)))
      : Promise.resolve([] as Array<{ id: string, relation: string | null }>)
  ])
  const studentNameById = new Map(students.map(row => [
    row.id,
    truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
  ]))
  const guardianRelationById = new Map(guardians.map(row => [row.id, row.relation]))

  return {
    communications: rows.map(row => ({
      occurredAt: toIsoOrNull(row.occurredAt) || '',
      studentLabel: row.studentId ? studentNameById.get(row.studentId) || null : null,
      guardianRelation: row.guardianId ? guardianRelationById.get(row.guardianId) || null : null,
      parentType: row.parentType,
      attitudeType: row.attitudeType,
      riskLevel: row.riskLevel,
      summary: readGovernedText(row.summaryEnc, secret, user.dataMode)
    }))
  }
}

export interface AssistantClassOverview {
  classes: Array<{
    id: string
    name: string
    grade: string | null
    studentCount: number
    students: Array<{
      id: string
      name: string
      communicationCount: number
      activePlanCount: number
      lastLevel: string | null
      lastPlanUpdatedAt: string | null
    }>
  }>
}

/**
 * 读取当前教师的班级概览：每个班的学生及其沟通数、在跟方案数、最近方案等级。
 * 用途：回答「这个班我先看谁」「哪些学生最近沟通比较多」这类问题。
 * 说明：评估结论与班级没有直接关联，这里用该学生最近的方案报告等级作为「最近等级」。
 */
export async function readClassOverviewForAssistant(
  event: H3Event,
  user: AssistantReaderUser,
  input: { classId?: string, className?: string, limit?: number } = {}
): Promise<AssistantClassOverview> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const perClassLimit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.classStudents)

  const classConditions = [
    eq(schema.classes.schoolId, user.schoolId),
    eq(schema.classes.ownerUserId, user.userId)
  ]
  if (input.classId) classConditions.push(eq(schema.classes.id, input.classId))
  if (input.className) classConditions.push(eq(schema.classes.name, input.className))

  const classes = await db.select({
    id: schema.classes.id,
    name: schema.classes.name,
    grade: schema.classes.grade,
    studentCount: schema.classes.studentCount
  }).from(schema.classes)
    .where(and(...classConditions))
    .orderBy(desc(schema.classes.updatedAt))
    .limit(input.classId || input.className ? 1 : ASSISTANT_READER_LIMITS.classOverviewClasses)
  if (!classes.length) return { classes: [] }

  const classIds = classes.map(item => item.id)
  const studentRows = await db.select({
    id: schema.students.id,
    classId: schema.students.classId,
    nameEnc: schema.students.nameEnc
  }).from(schema.students)
    .where(and(
      eq(schema.students.schoolId, user.schoolId),
      eq(schema.students.ownerUserId, user.userId),
      eq(schema.students.status, 'active'),
      inArray(schema.students.classId, classIds)
    ))
    .orderBy(desc(schema.students.updatedAt))
    .limit(ASSISTANT_READER_LIMITS.classOverviewClasses * ASSISTANT_READER_LIMITS.classStudents * 2)

  const perClassStudents = new Map<string, typeof studentRows>()
  for (const row of studentRows) {
    if (!row.classId) continue
    const list = perClassStudents.get(row.classId) || []
    if (list.length >= perClassLimit) continue
    list.push(row)
    perClassStudents.set(row.classId, list)
  }
  const studentIds = [...perClassStudents.values()].flat().map(row => row.id)

  const communicationCounts = new Map<string, number>()
  const activePlanCounts = new Map<string, number>()
  const lastLevelByStudent = new Map<string, { level: string | null, updatedAt: string | null }>()
  if (studentIds.length) {
    const [communicationRows, planRows, latestPlans] = await Promise.all([
      db.select({ studentId: schema.communications.studentId, total: sql<number>`count(*)::int` })
        .from(schema.communications)
        .where(and(
          eq(schema.communications.schoolId, user.schoolId),
          eq(schema.communications.ownerUserId, user.userId),
          eq(schema.communications.status, 'active'),
          inArray(schema.communications.studentId, studentIds)
        ))
        .groupBy(schema.communications.studentId),
      db.select({ studentId: schema.plans.studentId, total: sql<number>`count(*)::int` })
        .from(schema.plans)
        .where(and(
          eq(schema.plans.schoolId, user.schoolId),
          eq(schema.plans.ownerUserId, user.userId),
          inArray(schema.plans.status, [...ASSISTANT_ACTIVE_PLAN_STATUSES]),
          inArray(schema.plans.studentId, studentIds)
        ))
        .groupBy(schema.plans.studentId),
      db.select({
        studentId: schema.plans.studentId,
        report: schema.plans.report,
        updatedAt: schema.plans.updatedAt
      }).from(schema.plans)
        .where(and(
          eq(schema.plans.schoolId, user.schoolId),
          eq(schema.plans.ownerUserId, user.userId),
          inArray(schema.plans.studentId, studentIds)
        ))
        .orderBy(desc(schema.plans.updatedAt))
        .limit(ASSISTANT_READER_LIMITS.classStudents * 2)
    ])
    for (const row of communicationRows) {
      if (row.studentId) communicationCounts.set(row.studentId, Number(row.total) || 0)
    }
    for (const row of planRows) {
      if (row.studentId) activePlanCounts.set(row.studentId, Number(row.total) || 0)
    }
    for (const row of latestPlans) {
      if (!row.studentId || lastLevelByStudent.has(row.studentId)) continue
      lastLevelByStudent.set(row.studentId, {
        level: pickPlanLevel((row.report || null) as Record<string, unknown> | null),
        updatedAt: toIsoOrNull(row.updatedAt)
      })
    }
  }

  return {
    classes: classes.map(item => ({
      id: item.id,
      name: truncateAssistantText(item.name, 60),
      grade: item.grade == null ? null : String(item.grade),
      studentCount: Number(item.studentCount) || 0,
      students: (perClassStudents.get(item.id) || []).map(row => {
        const latest = lastLevelByStudent.get(row.id)
        return {
          id: row.id,
          name: truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40),
          communicationCount: communicationCounts.get(row.id) || 0,
          activePlanCount: activePlanCounts.get(row.id) || 0,
          lastLevel: latest?.level ?? null,
          lastPlanUpdatedAt: latest?.updatedAt ?? null
        }
      })
    }))
  }
}

export interface AssistantTeacherBrief {
  overdueActions: Array<{ title: string, planTitle: string, dueAt: string | null, status: string }>
  upcomingReviews: Array<{ planTitle: string, nextReviewAt: string | null, module: string }>
  draftAssessments: Array<{ module: string, answeredCount: number, updatedAt: string }>
  unreadNotifications: number
  riskCommunications: Array<{ occurredAt: string, studentLabel: string | null, riskLevel: string | null, summary: string }>
}

/**
 * 读取教师待办简报：逾期行动项、最近的待复盘方案、未完成量表草稿、未读通知数、需关注的沟通。
 * 口径与 server/api/v1/workbench/today.get.ts 保持一致，但只保留简报需要的条目。
 */
export async function readTeacherBriefForAssistant(
  event: H3Event,
  user: AssistantReaderUser
): Promise<AssistantTeacherBrief> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const now = new Date()

  const [actionRows, reviewRows, draftRows, unreadRows, communicationRows] = await Promise.all([
    db.select({
      title: schema.planActions.title,
      status: schema.planActions.status,
      dueAt: schema.planActions.dueAt,
      planTitle: schema.plans.title
    }).from(schema.planActions)
      .innerJoin(schema.plans, eq(schema.planActions.planId, schema.plans.id))
      .where(and(
        eq(schema.planActions.schoolId, user.schoolId),
        eq(schema.planActions.ownerUserId, user.userId),
        eq(schema.planActions.decision, 'included'),
        inArray(schema.planActions.status, ['pending', 'in_progress']),
        lt(schema.planActions.dueAt, now)
      ))
      .orderBy(schema.planActions.dueAt)
      .limit(3),
    db.select({
      title: schema.plans.title,
      nextReviewAt: schema.plans.nextReviewAt,
      module: schema.plans.module
    }).from(schema.plans)
      .where(and(
        eq(schema.plans.schoolId, user.schoolId),
        eq(schema.plans.ownerUserId, user.userId),
        inArray(schema.plans.status, [...ASSISTANT_ACTIVE_PLAN_STATUSES]),
        isNull(schema.plans.archivedAt)
      ))
      .orderBy(schema.plans.nextReviewAt)
      .limit(3),
    db.select({
      module: schema.assessmentAttempts.module,
      answers: schema.assessmentAttempts.answers,
      updatedAt: schema.assessmentAttempts.updatedAt
    }).from(schema.assessmentAttempts)
      .where(and(
        eq(schema.assessmentAttempts.schoolId, user.schoolId),
        eq(schema.assessmentAttempts.ownerUserId, user.userId),
        eq(schema.assessmentAttempts.status, 'draft')
      ))
      .orderBy(desc(schema.assessmentAttempts.updatedAt))
      .limit(3),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.userId), isNull(schema.notifications.readAt))),
    db.select({
      occurredAt: schema.communications.occurredAt,
      studentId: schema.communications.studentId,
      riskLevel: schema.communications.riskLevel,
      summaryEnc: schema.communications.summaryEnc
    }).from(schema.communications)
      .where(and(
        eq(schema.communications.schoolId, user.schoolId),
        eq(schema.communications.ownerUserId, user.userId),
        eq(schema.communications.status, 'active'),
        inArray(schema.communications.riskLevel, [...ASSISTANT_ATTENTION_RISK_LEVELS])
      ))
      .orderBy(desc(schema.communications.occurredAt))
      .limit(ASSISTANT_READER_LIMITS.briefCommunications)
  ])

  const studentIds = [...new Set(communicationRows.map(row => row.studentId).filter(Boolean))] as string[]
  const students = studentIds.length
    ? await db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
      .where(and(eq(schema.students.schoolId, user.schoolId), inArray(schema.students.id, studentIds)))
    : []
  const studentNameById = new Map(students.map(row => [
    row.id,
    truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
  ]))

  return {
    overdueActions: actionRows.map(row => ({
      title: truncateAssistantText(row.title, 60),
      planTitle: truncateAssistantText(row.planTitle, 60),
      dueAt: toIsoOrNull(row.dueAt),
      status: row.status
    })),
    upcomingReviews: reviewRows.map(row => ({
      planTitle: truncateAssistantText(row.title, 60),
      nextReviewAt: toIsoOrNull(row.nextReviewAt),
      module: row.module
    })),
    draftAssessments: draftRows.map(row => ({
      module: row.module,
      answeredCount: Object.keys(row.answers || {}).length,
      updatedAt: toIsoOrNull(row.updatedAt) || ''
    })),
    unreadNotifications: Number(unreadRows[0]?.total) || 0,
    riskCommunications: communicationRows.map(row => ({
      occurredAt: toIsoOrNull(row.occurredAt) || '',
      studentLabel: row.studentId ? studentNameById.get(row.studentId) || null : null,
      riskLevel: row.riskLevel,
      summary: readGovernedText(row.summaryEnc, secret, user.dataMode)
    }))
  }
}

export interface AssistantResourceCatalogEntry {
  module: string
  libraryType: 'assessment' | 'attribution' | 'tool'
  title: string
  summary: string | null
}

/** 从任意载荷里安全取数组（三库载荷结构随版本演进，取不到视为空）。 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 从任意对象里安全取字符串字段。 */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * 读取某模块已发布的三库资源目录（只要标题与一句摘要，不含正文）。
 * 用途：知识检索零命中时，让模型能说明「平台里有这些已发布资源、进入模块可查看」，
 * 而不是只说「没查到」或编造内容。未指定模块时返回空数组（避免一次打 15 个查询）。
 */
export async function readPublishedResourceCatalog(
  event: H3Event,
  input: { schoolId: string, module?: ModuleId }
): Promise<AssistantResourceCatalogEntry[]> {
  if (!input.module) return []
  const module = input.module
  const catalog: AssistantResourceCatalogEntry[] = []
  const perType = ASSISTANT_READER_LIMITS.catalogPerType

  const [assessmentResource, attributionResource, toolResource] = await Promise.all([
    resolvePublishedModuleResource<{ instruments?: AssessmentDefinition[] } & Partial<AssessmentDefinition>>(event, {
      module, libraryType: 'assessment', schoolId: input.schoolId
    }).catch(() => null),
    resolvePublishedModuleResource<Record<string, unknown>>(event, {
      module, libraryType: 'attribution', schoolId: input.schoolId
    }).catch(() => null),
    listPublishedModuleTools(event, module, input.schoolId).catch(() => ({ tools: [] as unknown[], sourceVersions: [] as string[] }))
  ])

  const assessmentPayload = assessmentResource?.payload
  const instruments = asArray(assessmentPayload?.instruments).length
    ? asArray(assessmentPayload?.instruments)
    : assessmentPayload?.code && assessmentPayload?.title ? [assessmentPayload] : []
  for (const item of instruments.slice(0, perType)) {
    const record = item as Record<string, unknown>
    const title = asString(record.title)
    if (!title) continue
    catalog.push({
      module,
      libraryType: 'assessment',
      title: truncateAssistantText(title, 80),
      summary: truncateAssistantText(asString(record.description) || asString(record.shortName) || '', ASSISTANT_READER_LIMITS.summaryChars) || null
    })
  }

  const attributionItems = asArray((attributionResource?.payload as { attributionItems?: unknown } | undefined)?.attributionItems)
  for (const item of attributionItems.slice(0, perType)) {
    const record = item as Record<string, unknown>
    const title = asString(record.name)
    if (!title) continue
    catalog.push({
      module,
      libraryType: 'attribution',
      title: truncateAssistantText(title, 80),
      summary: truncateAssistantText(asString(record.description) || asString(record.typicalTrigger) || '', ASSISTANT_READER_LIMITS.summaryChars) || null
    })
  }

  for (const item of asArray(toolResource?.tools).slice(0, perType)) {
    const record = item as Record<string, unknown>
    const title = asString(record.title)
    if (!title) continue
    catalog.push({
      module,
      libraryType: 'tool',
      title: truncateAssistantText(title, 80),
      summary: truncateAssistantText(asString(record.scenario) || '', ASSISTANT_READER_LIMITS.summaryChars) || null
    })
  }

  return catalog
}

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
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { ModuleId } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { MODULE_ASSESSMENT_CONTEXT_TYPES } from '../../shared/assessments'
import { filterBySchoolSection, type SchoolSection } from '../../shared/school-section'
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

/** 咨询对象引用（会话绑定对象与评估组对象共用同一粒度）。 */
export interface AssistantObjectRef {
  type: 'student' | 'guardian' | 'class'
  id: string
}

/** 对象标签：工具返回里标出这条记录属于哪个咨询对象，避免跨对象串台。 */
export interface AssistantObjectLabel extends AssistantObjectRef {
  label: string
}

/**
 * 教师级模块：结果为教师本人所有，不绑定咨询对象。
 * 由 shared/assessments.ts 的对象口径推导（与模块页对象选择器同源），不在这里另立一份判断。
 */
export const TEACHER_LEVEL_MODULES: ModuleId[] = (Object.keys(MODULE_ASSESSMENT_CONTEXT_TYPES) as ModuleId[])
  .filter(module => MODULE_ASSESSMENT_CONTEXT_TYPES[module].length === 0)

export function isTeacherLevelModule(module: string | null | undefined): boolean {
  return Boolean(module) && TEACHER_LEVEL_MODULES.includes(module as ModuleId)
}

/** 对象引用键：类型与 id 都合法时才生成，用于去重与查表。 */
export function assistantObjectKey(type: string | null | undefined, id: string | null | undefined): string | null {
  if (!type || !id) return null
  if (type !== 'student' && type !== 'guardian' && type !== 'class') return null
  return `${type}:${id}`
}

/**
 * 批量解析咨询对象展示名（工具返回给模型的对象标签）。
 * 学生与家长姓名解密后按数据模式脱敏，班级名明文；查不到的对象不猜名称，由调用方按 null 处理。
 */
export async function resolveAssistantObjectLabels(
  event: H3Event,
  user: AssistantReaderUser,
  refs: Array<{ type?: string | null, id?: string | null }>
): Promise<Map<string, AssistantObjectLabel>> {
  const labels = new Map<string, AssistantObjectLabel>()
  const wanted = new Map<string, AssistantObjectRef>()
  for (const ref of refs) {
    const key = assistantObjectKey(ref.type, ref.id)
    if (key && !wanted.has(key)) wanted.set(key, { type: ref.type as AssistantObjectRef['type'], id: ref.id as string })
  }
  if (!wanted.size) return labels

  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const values = [...wanted.values()]
  const studentIds = values.filter(item => item.type === 'student').map(item => item.id)
  const guardianIds = values.filter(item => item.type === 'guardian').map(item => item.id)
  const classIds = values.filter(item => item.type === 'class').map(item => item.id)

  const [students, guardians, classes] = await Promise.all([
    studentIds.length
      ? db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
        .where(and(eq(schema.students.schoolId, user.schoolId), inArray(schema.students.id, studentIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string }>),
    guardianIds.length
      ? db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc, relation: schema.guardians.relation }).from(schema.guardians)
        .where(and(eq(schema.guardians.schoolId, user.schoolId), inArray(schema.guardians.id, guardianIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string, relation: string | null }>),
    classIds.length
      ? db.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
        .where(and(eq(schema.classes.schoolId, user.schoolId), inArray(schema.classes.id, classIds)))
      : Promise.resolve([] as Array<{ id: string, name: string }>)
  ])

  for (const row of students) {
    labels.set(`student:${row.id}`, {
      type: 'student',
      id: row.id,
      label: truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
    })
  }
  for (const row of guardians) {
    const name = truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
    labels.set(`guardian:${row.id}`, {
      type: 'guardian',
      id: row.id,
      label: row.relation ? `${name} · ${row.relation}` : name
    })
  }
  for (const row of classes) {
    labels.set(`class:${row.id}`, { type: 'class', id: row.id, label: truncateAssistantText(row.name, 40) })
  }
  return labels
}

/** 从方案/评估记录的对象字段取第一个关联对象的标签（学生 → 家长 → 班级）；名称解析不到时返回 null。 */
export function pickAssistantObjectLabel(
  row: { studentId?: string | null, guardianId?: string | null, classId?: string | null },
  labels: Map<string, AssistantObjectLabel>
): AssistantObjectLabel | null {
  const candidates: Array<[AssistantObjectRef['type'], string | null | undefined]> = [
    ['student', row.studentId],
    ['guardian', row.guardianId],
    ['class', row.classId]
  ]
  // 只认第一个有关联的对象：解析不到名称（越权或记录缺失）时返回 null，不改标到其它对象
  for (const [type, id] of candidates) {
    if (!id) continue
    return labels.get(`${type}:${id}`) || null
  }
  return null
}

/** 评估组的对象标签：context_type / context_id → 标签；教师级或未进组的记录返回 null。 */
export function pickContextObjectLabel(
  contextType: string | null | undefined,
  contextId: string | null | undefined,
  labels: Map<string, AssistantObjectLabel>
): AssistantObjectLabel | null {
  const key = assistantObjectKey(contextType, contextId)
  return key ? labels.get(key) || null : null
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
  /** 该方案关联的咨询对象；没有关联对象时为 null（不猜） */
  object: AssistantObjectLabel | null
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
): Promise<{ plans: AssistantPlanRow[], unscopedPlanCount: number }> {
  const db = useDb(event)
  const limit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.plans)
  const scoped = Boolean(input.studentId || input.classId || input.guardianId)
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
    studentId: schema.plans.studentId,
    guardianId: schema.plans.guardianId,
    classId: schema.plans.classId,
    nextReviewAt: schema.plans.nextReviewAt,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans)
    .where(and(...conditions))
    .orderBy(schema.plans.nextReviewAt)
    .limit(limit)
  if (!plans.length) {
    // 按对象收口且该对象没有关联方案时，只给「未关联对象的在跟方案」条数：
    // 既避免模型把别的对象的方案当作本次对象的，也避免答成「这位教师根本没有方案」。
    const unscopedPlanCount = scoped ? await countUnscopedActivePlans(event, user) : 0
    return { plans: [], unscopedPlanCount }
  }

  const planIds = plans.map(plan => plan.id)
  const objectRefs = plans.flatMap(plan => [
    { type: 'student' as const, id: plan.studentId },
    { type: 'guardian' as const, id: plan.guardianId },
    { type: 'class' as const, id: plan.classId }
  ])
  const [actionRows, reviewRows, objectLabels] = await Promise.all([
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
      .limit(planIds.length * 2),
    resolveAssistantObjectLabels(event, user, objectRefs)
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
      object: pickAssistantObjectLabel(plan, objectLabels),
      actions: actionsByPlan.get(plan.id) || [],
      lastReview: reviewByPlan.get(plan.id) || null
    })),
    unscopedPlanCount: 0
  }
}

/** 统计未关联任何咨询对象的在跟方案条数（只用于说明数据口径，不返回内容）。 */
async function countUnscopedActivePlans(event: H3Event, user: AssistantReaderUser): Promise<number> {
  const db = useDb(event)
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.plans)
    .where(and(
      eq(schema.plans.schoolId, user.schoolId),
      eq(schema.plans.ownerUserId, user.userId),
      inArray(schema.plans.status, [...ASSISTANT_ACTIVE_PLAN_STATUSES]),
      isNull(schema.plans.studentId),
      isNull(schema.plans.guardianId),
      isNull(schema.plans.classId)
    ))
  return Number(row?.total) || 0
}

export interface AssistantAssessmentHistory {
  submitted: Array<{
    id?: string
    sessionId?: string | null
    module: string
    assessmentCode: string
    submittedAt: string | null
    /** 该结论的咨询对象：教师级模块（自我成长）为 null，对象未知的历史提交也为 null */
    object: AssistantObjectLabel | null
    level: string | null
    levelName: string | null
    severity: string | null
    dimensions: Record<string, number>
    primaryAttribution: string | null
  }>
  drafts: Array<{ module: string, assessmentCode: string, answeredCount: number, updatedAt: string, object: AssistantObjectLabel | null }>
  openSessions: Array<{ module: string, contextType: string, object: AssistantObjectLabel | null, startedAt: string, submittedCount: number }>
}

/**
 * 读取当前教师的评估历史：已提交结论（等级/严重度/维度/主归因）、未完成草稿、开放评估组。
 * 结论字段一律来自确定性规则结果，本函数不做任何再判断。
 */
export async function readAssessmentHistoryForAssistant(
  event: H3Event,
  user: AssistantReaderUser,
  input: { module?: ModuleId, limit?: number, object?: AssistantObjectRef | null } = {}
): Promise<AssistantAssessmentHistory> {
  const db = useDb(event)
  const submittedLimit = clampAssistantLimit(input.limit, ASSISTANT_READER_LIMITS.submittedAssessments)
  const object = input.object || null
  /**
   * 对象级量表只认同一咨询对象：开启对象过滤时，教师级模块（结果属于教师本人）照常返回，
   * 其余模块必须命中评估组的同一对象；对象未知的历史提交在此被排除，不猜归属。
   */
  const scopeCondition = object
    ? or(
      inArray(schema.assessmentAttempts.module, TEACHER_LEVEL_MODULES),
      and(
        eq(schema.assessmentSessions.contextType, object.type),
        eq(schema.assessmentSessions.contextId, object.id)
      )
    )
    : undefined
  const submittedConditions = [
    eq(schema.assessmentAttempts.schoolId, user.schoolId),
    eq(schema.assessmentAttempts.ownerUserId, user.userId),
    eq(schema.assessmentAttempts.status, 'submitted')
  ]
  if (input.module) submittedConditions.push(eq(schema.assessmentAttempts.module, input.module))

  const [submittedRows, draftRows, sessionRows] = await Promise.all([
    db.select({
      id: schema.assessmentAttempts.id,
      module: schema.assessmentAttempts.module,
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      sessionId: schema.assessmentSessions.id,
      submittedAt: schema.assessmentAttempts.submittedAt,
      result: schema.assessmentAttempts.result,
      contextType: schema.assessmentSessions.contextType,
      contextId: schema.assessmentSessions.contextId
    }).from(schema.assessmentAttempts)
      .leftJoin(schema.assessmentSessionAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
      .leftJoin(schema.assessmentSessions, eq(schema.assessmentSessions.id, schema.assessmentSessionAttempts.assessmentSessionId))
      .where(and(...submittedConditions, scopeCondition))
      .orderBy(desc(schema.assessmentAttempts.submittedAt))
      .limit(submittedLimit),
    db.select({
      id: schema.assessmentAttempts.id,
      module: schema.assessmentAttempts.module,
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      answers: schema.assessmentAttempts.answers,
      updatedAt: schema.assessmentAttempts.updatedAt,
      contextType: schema.assessmentSessions.contextType,
      contextId: schema.assessmentSessions.contextId
    }).from(schema.assessmentAttempts)
      .leftJoin(schema.assessmentSessionAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
      .leftJoin(schema.assessmentSessions, eq(schema.assessmentSessions.id, schema.assessmentSessionAttempts.assessmentSessionId))
      .where(and(
        eq(schema.assessmentAttempts.schoolId, user.schoolId),
        eq(schema.assessmentAttempts.ownerUserId, user.userId),
        eq(schema.assessmentAttempts.status, 'draft'),
        ...(input.module ? [eq(schema.assessmentAttempts.module, input.module)] : []),
        scopeCondition
      ))
      .orderBy(desc(schema.assessmentAttempts.updatedAt))
      .limit(ASSISTANT_READER_LIMITS.drafts),
    db.select({
      id: schema.assessmentSessions.id,
      module: schema.assessmentSessions.module,
      contextType: schema.assessmentSessions.contextType,
      contextId: schema.assessmentSessions.contextId,
      createdAt: schema.assessmentSessions.createdAt
    }).from(schema.assessmentSessions)
      .where(and(
        eq(schema.assessmentSessions.schoolId, user.schoolId),
        eq(schema.assessmentSessions.ownerUserId, user.userId),
        eq(schema.assessmentSessions.status, 'open'),
        ...(input.module ? [eq(schema.assessmentSessions.module, input.module)] : []),
        ...(object
          ? [eq(schema.assessmentSessions.contextType, object.type), eq(schema.assessmentSessions.contextId, object.id)]
          : [])
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

  // 对象标签：把评估组上的 context_type/context_id 解析成可读名，供模型对上是哪个对象
  const objectLabels = await resolveAssistantObjectLabels(event, user, [
    ...submittedRows.map(row => ({ type: row.contextType, id: row.contextId })),
    ...draftRows.map(row => ({ type: row.contextType, id: row.contextId })),
    ...sessionRows.map(row => ({ type: row.contextType, id: row.contextId }))
  ])

  return {
    submitted: submittedRows.map(row => {
      const result = (row.result || null) as Record<string, unknown> | null
      return {
        id: row.id,
        module: row.module,
        assessmentCode: row.assessmentCode,
        sessionId: row.sessionId,
        submittedAt: toIsoOrNull(row.submittedAt),
        object: pickContextObjectLabel(row.contextType, row.contextId, objectLabels),
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
      updatedAt: toIsoOrNull(row.updatedAt) || '',
      object: pickContextObjectLabel(row.contextType, row.contextId, objectLabels)
    })),
    openSessions: sessionRows.map(row => ({
      module: row.module,
      contextType: row.contextType,
      object: pickContextObjectLabel(row.contextType, row.contextId, objectLabels),
      startedAt: toIsoOrNull(row.createdAt) || '',
      submittedCount: submittedCountBySession.get(row.id) || 0
    }))
  }
}

export interface AssistantCommunicationRow {
  occurredAt: string
  /** 这条沟通属于哪个咨询对象；无关联对象时为 null */
  object: AssistantObjectLabel | null
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
      ? db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc, relation: schema.guardians.relation }).from(schema.guardians)
        .where(and(eq(schema.guardians.schoolId, user.schoolId), inArray(schema.guardians.id, guardianIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string, relation: string | null }>)
  ])
  const studentNameById = new Map(students.map(row => [
    row.id,
    truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
  ]))
  const guardianRelationById = new Map(guardians.map(row => [row.id, row.relation]))
  const guardianNameById = new Map<string, string>(guardians.map(row => [
    row.id,
    truncateAssistantText(outboundAssistantText(decryptSensitive(row.nameEnc, secret), user.dataMode), 40)
  ]))

  return {
    communications: rows.map(row => {
      const studentLabel = row.studentId ? studentNameById.get(row.studentId) || null : null
      const guardianRelation = row.guardianId ? guardianRelationById.get(row.guardianId) || null : null
      const guardianName = row.guardianId ? guardianNameById.get(row.guardianId) || null : null
      // 对象标签：学生优先，其次家长（姓名 · 关系）；取不到名称时留 null，不用 id 顶替
      const object: AssistantObjectLabel | null = row.studentId && studentLabel
        ? { type: 'student', id: row.studentId, label: studentLabel }
        : row.guardianId && (guardianName || guardianRelation)
          ? {
              type: 'guardian',
              id: row.guardianId,
              label: [guardianName, guardianRelation].filter(Boolean).join(' · ')
            }
          : null
      return {
        occurredAt: toIsoOrNull(row.occurredAt) || '',
        object,
        studentLabel,
        guardianRelation,
        parentType: row.parentType,
        attitudeType: row.attitudeType,
        riskLevel: row.riskLevel,
        summary: readGovernedText(row.summaryEnc, secret, user.dataMode)
      }
    })
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
      id: schema.assessmentAttempts.id,
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
 * 三库资源目录条目的构造口径（纯函数，不碰数据库，便于单测盯住字段映射）。
 *
 * 摘要字段必须与各自已发布 payload 的字段名对齐：
 *  - 量表库 instruments[]：title / description | shortName；
 *  - 归因库 attributionItems[]：name / description | typicalTrigger；
 *  - 工具库 tools[]（toolRxEntrySchema）：name / symptoms —— 曾误用 title / scenario，
 *    导致 220 条已发布工具一条也进不了目录。
 * 每类最多 perType 条；只给名称与一句摘要，正文不进目录。
 */
export function buildResourceCatalogEntries(input: {
  module: ModuleId
  assessmentPayload?: Record<string, unknown> | null
  attributionPayload?: Record<string, unknown> | null
  /** 已发布工具（listPublishedModuleTools 的 tools，通常已按学段过滤） */
  tools?: unknown[]
  sections?: readonly SchoolSection[] | null
  perType?: number
}): AssistantResourceCatalogEntry[] {
  const module = input.module
  const perType = input.perType ?? ASSISTANT_READER_LIMITS.catalogPerType
  const catalog: AssistantResourceCatalogEntry[] = []

  const assessmentPayload = input.assessmentPayload ?? undefined
  const instruments = asArray(assessmentPayload?.instruments).length
    ? asArray(assessmentPayload?.instruments)
    : assessmentPayload?.code && assessmentPayload?.title ? [assessmentPayload] : []
  // 按学段过滤（未标学部的视为全学部；过滤后为空回退全部）
  const scopedInstruments = filterBySchoolSection(
    instruments,
    item => (item as { applicableSchoolSection?: unknown })?.applicableSchoolSection,
    input.sections
  ).rows
  for (const item of scopedInstruments.slice(0, perType)) {
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

  const attributionItems = asArray(input.attributionPayload?.attributionItems)
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

  for (const item of asArray(input.tools).slice(0, perType)) {
    const record = item as Record<string, unknown>
    const title = asString(record.name)
    if (!title) continue
    catalog.push({
      module,
      libraryType: 'tool',
      title: truncateAssistantText(title, 80),
      summary: truncateAssistantText(asString(record.symptoms) || asString(record.effectNote) || '', ASSISTANT_READER_LIMITS.summaryChars) || null
    })
  }

  return catalog
}

/**
 * 读取某模块已发布的三库资源目录（只要标题与一句摘要，不含正文）。
 * 用途：知识检索零命中时，让模型能说明「平台里有这些已发布资源、进入模块可查看」，
 * 而不是只说「没查到」或编造内容。未指定模块时返回空数组（避免一次打 15 个查询）。
 */
export async function readPublishedResourceCatalog(
  event: H3Event,
  input: { schoolId: string, module?: ModuleId, sections?: readonly SchoolSection[] | null }
): Promise<AssistantResourceCatalogEntry[]> {
  if (!input.module) return []
  const module = input.module

  const [assessmentResource, attributionResource, toolResource] = await Promise.all([
    resolvePublishedModuleResource<{ instruments?: AssessmentDefinition[] } & Partial<AssessmentDefinition>>(event, {
      module, libraryType: 'assessment', schoolId: input.schoolId
    }).catch(() => null),
    resolvePublishedModuleResource<Record<string, unknown>>(event, {
      module, libraryType: 'attribution', schoolId: input.schoolId
    }).catch(() => null),
    listPublishedModuleTools(event, module, input.schoolId, { sections: input.sections }).catch(() => ({ tools: [] as unknown[], sourceVersions: [] as string[] }))
  ])

  return buildResourceCatalogEntries({
    module,
    assessmentPayload: (assessmentResource?.payload as Record<string, unknown> | undefined) ?? null,
    attributionPayload: attributionResource?.payload ?? null,
    tools: toolResource?.tools,
    sections: input.sections
  })
}

/**
 * 教师端评估记录详情（按评估组 id）。
 *
 * 补的断点：提交评估后的结论只在提交那一刻可见，离开页面就再也打不开；
 * 被安全熔断冻结的方案又不进教师方案列表。所以详情页必须自带两样东西——
 * 组内合并报告，以及熔断记录的转介处置载荷（学校指引/求助电话/响应时限）。
 *
 * 不下发逐题作答（answers 是更敏感的原始数据），报告正文按需返回。
 */
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema, type ModuleId } from '../../../../../shared/contracts'
import { moduleMeta } from '../../../../../shared/assessments'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { listAssessmentInstruments } from '../../../../domain/module-resources'
import { resolveCrisisNotice } from '../../../../domain/crisis-notice'
import { resolveCapabilities } from '../../../../domain/capabilities'
import {
  buildAttemptItems,
  buildRecordPlanRef,
  resolveLatestBlockedAttemptId,
  resolvePrimaryReport,
  resolveRecordStatus,
  summarizeSessionAttempts,
  type AssessmentRecordPlanRef,
  type SessionAttemptRow
} from '../../../../domain/assessment-records'

function safeDecrypt(value: string | null, secret: string): string | null {
  if (!value) return null
  try {
    return decryptSensitive(value, secret).trim() || null
  } catch {
    return null
  }
}

/** 报告页的工具卡：只保留展示所需字段 */
function readTools(result: Record<string, unknown> | null): Array<{ title: string, content: string }> {
  const tools = result?.tools
  if (!Array.isArray(tools)) return []
  return tools
    .filter((item): item is { title: string, content: string } =>
      Boolean(item) && typeof item === 'object'
      && typeof (item as { title?: unknown }).title === 'string'
      && typeof (item as { content?: unknown }).content === 'string')
    .map(item => ({ title: item.title, content: item.content }))
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const [session] = await db.select({
    id: schema.assessmentSessions.id,
    module: schema.assessmentSessions.module,
    sourceType: schema.assessmentSessions.sourceType,
    contextType: schema.assessmentSessions.contextType,
    contextId: schema.assessmentSessions.contextId,
    status: schema.assessmentSessions.status,
    createdAt: schema.assessmentSessions.createdAt,
    updatedAt: schema.assessmentSessions.updatedAt,
    completedAt: schema.assessmentSessions.completedAt
  }).from(schema.assessmentSessions).where(and(
    eq(schema.assessmentSessions.id, id),
    eq(schema.assessmentSessions.schoolId, user.schoolId),
    eq(schema.assessmentSessions.ownerUserId, user.id)
  )).limit(1)
  if (!session) throw createError({ statusCode: 404, message: '评估记录不存在' })

  const attemptRows = await db.select({
    attemptId: schema.assessmentAttempts.id,
    sequence: schema.assessmentSessionAttempts.sequence,
    assessmentCode: schema.assessmentAttempts.assessmentCode,
    submittedAt: schema.assessmentAttempts.submittedAt,
    result: schema.assessmentAttempts.result
  }).from(schema.assessmentSessionAttempts)
    .innerJoin(schema.assessmentAttempts, eq(schema.assessmentAttempts.id, schema.assessmentSessionAttempts.assessmentAttemptId))
    .where(and(
      eq(schema.assessmentSessionAttempts.assessmentSessionId, session.id),
      eq(schema.assessmentAttempts.status, 'submitted'),
      eq(schema.assessmentAttempts.schoolId, user.schoolId),
      eq(schema.assessmentAttempts.ownerUserId, user.id)
    ))
    .orderBy(asc(schema.assessmentSessionAttempts.sequence))

  // 空组（只创建过、没有已提交量表）没有可回看的内容，按不存在处理
  if (!attemptRows.length) throw createError({ statusCode: 404, message: '评估记录不存在' })

  const attempts: SessionAttemptRow[] = attemptRows.map(row => ({
    attemptId: row.attemptId,
    sequence: row.sequence,
    assessmentCode: row.assessmentCode,
    submittedAt: row.submittedAt,
    result: (row.result || null) as Record<string, unknown> | null
  }))
  const digest = summarizeSessionAttempts(attempts)
  const status = resolveRecordStatus({ sessionStatus: session.status, hasBlocked: digest.hasBlocked })
  const attemptIds = attempts.map(row => row.attemptId)

  // 熔断记录的转介处置载荷：按触发熔断的那次提交反查安全事件（与冻结方案页共用实现）
  const fuseAttemptId = resolveLatestBlockedAttemptId(attempts)
  const notice = fuseAttemptId
    ? await resolveCrisisNotice(db, { schoolId: user.schoolId, sourceType: 'assessment', sourceId: fuseAttemptId })
    : null

  // ---- 关联方案：关联表优先，未写关联表的旧方案按来源评估反查 ----
  const planRows = await db.select({
    id: schema.plans.id,
    title: schema.plans.title,
    titleFull: schema.plans.titleFull,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt,
    sourceAssessmentAttemptId: schema.plans.sourceAssessmentAttemptId,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans)
    .leftJoin(schema.planAssessmentAttempts, eq(schema.planAssessmentAttempts.planId, schema.plans.id))
    .where(and(
      eq(schema.plans.schoolId, user.schoolId),
      eq(schema.plans.ownerUserId, user.id),
      or(
        inArray(schema.planAssessmentAttempts.assessmentAttemptId, attemptIds),
        inArray(schema.plans.sourceAssessmentAttemptId, attemptIds)
      )
    ))
    .orderBy(asc(schema.plans.createdAt))

  const plansById = new Map<string, AssessmentRecordPlanRef & { updatedAt: Date }>()
  for (const row of planRows) {
    plansById.set(row.id, {
      ...buildRecordPlanRef({
        id: row.id,
        title: row.title,
        titleFull: row.titleFull,
        status: row.status,
        acceptedAt: row.acceptedAt
      }),
      updatedAt: row.updatedAt
    })
  }
  const plans = [...plansById.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(({ updatedAt: _updatedAt, ...ref }) => ref)

  // ---- 评估对象名（仅本人负责的对象；解密失败按未关联处理） ----
  let objectLabel: string | null = null
  if (session.contextId && session.contextType === 'student') {
    const [row] = await db.select({ nameEnc: schema.students.nameEnc }).from(schema.students).where(and(
      eq(schema.students.id, session.contextId),
      eq(schema.students.schoolId, user.schoolId),
      eq(schema.students.ownerUserId, user.id)
    )).limit(1)
    objectLabel = safeDecrypt(row?.nameEnc ?? null, secret)
  } else if (session.contextId && session.contextType === 'guardian') {
    const [row] = await db.select({ nameEnc: schema.guardians.nameEnc }).from(schema.guardians).where(and(
      eq(schema.guardians.id, session.contextId),
      eq(schema.guardians.schoolId, user.schoolId),
      eq(schema.guardians.ownerUserId, user.id)
    )).limit(1)
    objectLabel = safeDecrypt(row?.nameEnc ?? null, secret)
  } else if (session.contextId && session.contextType === 'class') {
    const [row] = await db.select({ name: schema.classes.name }).from(schema.classes).where(and(
      eq(schema.classes.id, session.contextId),
      eq(schema.classes.schoolId, user.schoolId),
      eq(schema.classes.ownerUserId, user.id)
    )).limit(1)
    objectLabel = row?.name || null
  }

  // ---- 量表中文名：查不到就退回编码，不阻塞详情 ----
  const instrumentNames: Record<string, string> = {}
  try {
    const instruments = await listAssessmentInstruments(event, session.module as ModuleId, user.schoolId)
    for (const item of instruments) {
      if (item.code) instrumentNames[item.code] = item.title || item.code
    }
  } catch {
    // 三库不可用时列表/详情仍可用，量表名显示编码
  }

  // 报告工具卡取最新一次提交的三库工具（组内合并结果的展示口径与报告一致）
  const latestAttempt = [...attempts].sort((a, b) => a.sequence - b.sequence).at(-1) || null

  const capabilities = await resolveCapabilities({
    user,
    recordSchoolId: user.schoolId,
    recordOwnerUserId: user.id,
    recordStatus: session.status,
    targetType: 'assessment',
    targetId: session.id
  }, event)

  return {
    id: session.id,
    module: session.module,
    moduleTitle: (moduleMeta as Record<string, { title: string }>)[session.module]?.title || session.module,
    sourceType: session.sourceType,
    contextType: session.contextType,
    // 前端「继续完成 / 再做一次」深链回模块页时带上对象，保证续接的是同一咨询对象
    contextId: session.contextId,
    objectLabel,
    status,
    level: digest.level,
    levelName: digest.levelName,
    severity: digest.severity,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    lastSubmittedAt: digest.lastSubmittedAt,
    /** 组仍开放：前端提供「继续完成」，带 continueSession 深链回模块页续接同一组 */
    canContinue: status === 'active',
    attempts: buildAttemptItems(attempts, instrumentNames),
    report: resolvePrimaryReport(attempts),
    tools: readTools(latestAttempt?.result ?? null),
    plans,
    fuse: notice
      ? {
          frozenAt: notice.occurredAt,
          eventId: notice.eventId,
          guide: notice.guide,
          helpPhone: notice.helpPhone,
          ackMinutes: notice.ackMinutes,
          escalationMinutes: notice.escalationMinutes,
          psychologistAssigned: notice.psychologistAssigned
        }
      : null,
    _capabilities: capabilities
  }
})

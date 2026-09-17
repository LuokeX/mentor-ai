/**
 * 教师端评估记录列表。
 *
 * 一条记录 = 一个评估组（assessment_sessions）：同一业务问题下连续提交的多张量表
 * 聚合在一条里，方案与安全熔断都挂在组上。空组（只创建过、没有任何已提交量表）
 * 不进列表——它们既没有结论也没有方案，列出来只会让教师困惑。
 *
 * 列表不下发报告正文与逐题作答：只要量表、结论等级与关联方案，
 * 报告正文与转介载荷在详情接口（records/[id].get.ts）。
 */
import { and, asc, count, desc, eq, inArray, ne, not, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema, type ModuleId } from '../../../../../shared/contracts'
import { moduleMeta } from '../../../../../shared/assessments'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { listAssessmentInstruments } from '../../../../domain/module-resources'
import {
  buildAssessmentRecordRow,
  buildRecordPlanRef,
  summarizeSessionAttempts,
  type AssessmentRecordPlanRef,
  type SessionAttemptRow
} from '../../../../domain/assessment-records'

const SORT_WHITELIST = createSortWhitelist('lastSubmittedAt', 'updatedAt', 'createdAt', 'module')

const querySchema = z.object({
  module: moduleIdSchema.optional(),
  status: z.enum(['all', 'active', 'completed', 'referred']).default('all'),
  q: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).default('lastSubmittedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(v => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE)
})

/** 组内至少有一次已提交量表（过滤空组、只有草稿的组） */
const hasSubmittedAttempt = sql`exists (
  select 1 from ${schema.assessmentSessionAttempts}
  inner join ${schema.assessmentAttempts}
    on ${schema.assessmentAttempts.id} = ${schema.assessmentSessionAttempts.assessmentAttemptId}
  where ${schema.assessmentSessionAttempts.assessmentSessionId} = ${schema.assessmentSessions.id}
    and ${schema.assessmentAttempts.status} = 'submitted'
)`

/** 组内是否发生过安全熔断：熔断提交的 result.blocked 为 true */
const hasBlockedAttempt = sql`exists (
  select 1 from ${schema.assessmentSessionAttempts}
  inner join ${schema.assessmentAttempts}
    on ${schema.assessmentAttempts.id} = ${schema.assessmentSessionAttempts.assessmentAttemptId}
  where ${schema.assessmentSessionAttempts.assessmentSessionId} = ${schema.assessmentSessions.id}
    and ${schema.assessmentAttempts.status} = 'submitted'
    and ${schema.assessmentAttempts.result} ->> 'blocked' = 'true'
)`

/** 组内最近一次提交时间：组表的 updatedAt 只在创建/关闭时写，排序必须看提交时间 */
const lastSubmittedAtSql = sql`(
  select max(${schema.assessmentAttempts.submittedAt})
  from ${schema.assessmentSessionAttempts}
  inner join ${schema.assessmentAttempts}
    on ${schema.assessmentAttempts.id} = ${schema.assessmentSessionAttempts.assessmentAttemptId}
  where ${schema.assessmentSessionAttempts.assessmentSessionId} = ${schema.assessmentSessions.id}
    and ${schema.assessmentAttempts.status} = 'submitted'
)`

function safeDecrypt(value: string | null, secret: string): string | null {
  if (!value) return null
  try {
    return decryptSensitive(value, secret).trim() || null
  } catch {
    // 单条密文损坏不能让整页 500：名字缺失时前端退回「未关联对象」
    return null
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const conditions = [
    eq(schema.assessmentSessions.schoolId, user.schoolId),
    eq(schema.assessmentSessions.ownerUserId, user.id),
    hasSubmittedAttempt
  ]
  if (query.module) conditions.push(eq(schema.assessmentSessions.module, query.module))
  if (query.status === 'active') {
    conditions.push(eq(schema.assessmentSessions.status, 'open'))
  } else if (query.status === 'completed') {
    conditions.push(and(ne(schema.assessmentSessions.status, 'open'), not(hasBlockedAttempt))!)
  } else if (query.status === 'referred') {
    conditions.push(hasBlockedAttempt)
  }
  if (query.q) {
    // 组没有标题，搜索落在「量表编码」与「关联方案标题」上：中文模块名由上方 tab 过滤承担。
    const keyword = `%${query.q}%`
    conditions.push(or(
      sql`exists (
        select 1 from ${schema.assessmentSessionAttempts}
        inner join ${schema.assessmentAttempts}
          on ${schema.assessmentAttempts.id} = ${schema.assessmentSessionAttempts.assessmentAttemptId}
        where ${schema.assessmentSessionAttempts.assessmentSessionId} = ${schema.assessmentSessions.id}
          and ${schema.assessmentAttempts.status} = 'submitted'
          and ${schema.assessmentAttempts.assessmentCode} ilike ${keyword}
      )`,
      sql`exists (
        select 1 from ${schema.planAssessmentAttempts}
        inner join ${schema.plans} on ${schema.plans.id} = ${schema.planAssessmentAttempts.planId}
        where ${schema.planAssessmentAttempts.assessmentAttemptId} in (
          select ${schema.assessmentSessionAttempts.assessmentAttemptId}
          from ${schema.assessmentSessionAttempts}
          where ${schema.assessmentSessionAttempts.assessmentSessionId} = ${schema.assessmentSessions.id}
        )
          and ${schema.plans.ownerUserId} = ${user.id}
          and ${schema.plans.title} ilike ${keyword}
      )`
    )!)
  }
  const where = and(...conditions)

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'lastSubmittedAt')
  const sortColumn = validSort === 'updatedAt' ? schema.assessmentSessions.updatedAt
    : validSort === 'createdAt' ? schema.assessmentSessions.createdAt
      : validSort === 'module' ? schema.assessmentSessions.module
        : lastSubmittedAtSql
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.assessmentSessions.id,
      module: schema.assessmentSessions.module,
      status: schema.assessmentSessions.status,
      contextType: schema.assessmentSessions.contextType,
      contextId: schema.assessmentSessions.contextId,
      createdAt: schema.assessmentSessions.createdAt,
      updatedAt: schema.assessmentSessions.updatedAt,
      completedAt: schema.assessmentSessions.completedAt
    }).from(schema.assessmentSessions).where(where).orderBy(orderFn(sortColumn))
      .limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.assessmentSessions).where(where),
    page: query.page,
    pageSize: query.pageSize
  })

  const sessions = result.rows
  const sessionIds = sessions.map(row => row.id)

  // ---- 组内已提交量表：一次查询后在内存里按组聚合 ----
  const attemptRows = sessionIds.length
    ? await db.select({
        sessionId: schema.assessmentSessionAttempts.assessmentSessionId,
        attemptId: schema.assessmentAttempts.id,
        sequence: schema.assessmentSessionAttempts.sequence,
        assessmentCode: schema.assessmentAttempts.assessmentCode,
        submittedAt: schema.assessmentAttempts.submittedAt,
        result: schema.assessmentAttempts.result
      }).from(schema.assessmentSessionAttempts)
        .innerJoin(schema.assessmentAttempts, eq(schema.assessmentAttempts.id, schema.assessmentSessionAttempts.assessmentAttemptId))
        .where(and(
          inArray(schema.assessmentSessionAttempts.assessmentSessionId, sessionIds),
          eq(schema.assessmentAttempts.status, 'submitted')
        ))
        .orderBy(asc(schema.assessmentSessionAttempts.sequence))
    : []

  const attemptsBySession = new Map<string, SessionAttemptRow[]>()
  for (const row of attemptRows) {
    const list = attemptsBySession.get(row.sessionId) || []
    list.push({
      attemptId: row.attemptId,
      sequence: row.sequence,
      assessmentCode: row.assessmentCode,
      submittedAt: row.submittedAt,
      result: (row.result || null) as Record<string, unknown> | null
    })
    attemptsBySession.set(row.sessionId, list)
  }
  const attemptIds = attemptRows.map(row => row.attemptId)

  // ---- 关联方案：优先取组内量表的关联记录，未写关联表的旧方案按来源评估反查 ----
  const planRows = attemptIds.length
    ? await db.select({
        attemptId: schema.planAssessmentAttempts.assessmentAttemptId,
        id: schema.plans.id,
        title: schema.plans.title,
        titleFull: schema.plans.titleFull,
        status: schema.plans.status,
        acceptedAt: schema.plans.acceptedAt,
        updatedAt: schema.plans.updatedAt
      }).from(schema.planAssessmentAttempts)
        .innerJoin(schema.plans, eq(schema.plans.id, schema.planAssessmentAttempts.planId))
        .where(and(
          inArray(schema.planAssessmentAttempts.assessmentAttemptId, attemptIds),
          eq(schema.plans.schoolId, user.schoolId),
          eq(schema.plans.ownerUserId, user.id)
        ))
    : []
  const sourcePlanRows = attemptIds.length
    ? await db.select({
        attemptId: schema.plans.sourceAssessmentAttemptId,
        id: schema.plans.id,
        title: schema.plans.title,
        titleFull: schema.plans.titleFull,
        status: schema.plans.status,
        acceptedAt: schema.plans.acceptedAt,
        updatedAt: schema.plans.updatedAt
      }).from(schema.plans)
        .where(and(
          inArray(schema.plans.sourceAssessmentAttemptId, attemptIds),
          eq(schema.plans.schoolId, user.schoolId),
          eq(schema.plans.ownerUserId, user.id)
        ))
    : []

  // attemptId → 方案（同一 attempt 命中两条路径时取最近更新的那条）
  const planByAttempt = new Map<string, AssessmentRecordPlanRef & { updatedAt: Date }>()
  for (const row of [...planRows, ...sourcePlanRows]) {
    if (!row.attemptId) continue
    const ref = buildRecordPlanRef({
      id: row.id,
      title: row.title,
      titleFull: row.titleFull,
      status: row.status,
      acceptedAt: row.acceptedAt
    })
    const existing = planByAttempt.get(row.attemptId)
    if (!existing || row.updatedAt > existing.updatedAt) {
      planByAttempt.set(row.attemptId, { ...ref, updatedAt: row.updatedAt })
    }
  }
  // 一个组可能先后生成过多份方案（旧方案被调整/关闭），列表取最新那份
  const planBySession = new Map<string, AssessmentRecordPlanRef>()
  for (const [sessionId, attempts] of attemptsBySession) {
    let latest: (AssessmentRecordPlanRef & { updatedAt: Date }) | null = null
    for (const attempt of attempts) {
      const plan = planByAttempt.get(attempt.attemptId)
      if (plan && (!latest || plan.updatedAt > latest.updatedAt)) latest = plan
    }
    if (latest) {
      const { updatedAt: _updatedAt, ...ref } = latest
      planBySession.set(sessionId, ref)
    }
  }

  // ---- 评估对象名：仅本人负责的学生/家长/班级，解密失败按未关联处理 ----
  const idsOfType = (type: string) => sessions
    .filter(row => row.contextType === type && row.contextId)
    .map(row => row.contextId as string)
  const studentIds = idsOfType('student')
  const classIds = idsOfType('class')
  const guardianIds = idsOfType('guardian')

  const [studentRows, classRows, guardianRows] = await Promise.all([
    studentIds.length
      ? db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
          .where(and(
            inArray(schema.students.id, studentIds),
            eq(schema.students.schoolId, user.schoolId),
            eq(schema.students.ownerUserId, user.id)
          ))
      : Promise.resolve([]),
    classIds.length
      ? db.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
          .where(and(
            inArray(schema.classes.id, classIds),
            eq(schema.classes.schoolId, user.schoolId),
            eq(schema.classes.ownerUserId, user.id)
          ))
      : Promise.resolve([]),
    guardianIds.length
      ? db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc }).from(schema.guardians)
          .where(and(
            inArray(schema.guardians.id, guardianIds),
            eq(schema.guardians.schoolId, user.schoolId),
            eq(schema.guardians.ownerUserId, user.id)
          ))
      : Promise.resolve([])
  ])
  const objectLabelById = new Map<string, string>()
  for (const row of studentRows) {
    const name = safeDecrypt(row.nameEnc, secret)
    if (name) objectLabelById.set(row.id, name)
  }
  for (const row of classRows) objectLabelById.set(row.id, row.name)
  for (const row of guardianRows) {
    const name = safeDecrypt(row.nameEnc, secret)
    if (name) objectLabelById.set(row.id, name)
  }

  // ---- 量表中文名：按当页出现的模块查已发布量表，查不到就显示编码（不阻塞列表） ----
  const moduleIds = [...new Set(sessions.map(row => row.module))]
  const nameMaps = new Map<string, Record<string, string>>()
  await Promise.all(moduleIds.map(async (module) => {
    try {
      const instruments = await listAssessmentInstruments(event, module as ModuleId, user.schoolId)
      const map: Record<string, string> = {}
      for (const item of instruments) {
        if (item.code) map[item.code] = item.title || item.code
      }
      nameMaps.set(module, map)
    } catch {
      nameMaps.set(module, {})
    }
  }))

  const rows = await Promise.all(sessions.map(async (session) => {
    const attempts = attemptsBySession.get(session.id) || []
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: user.schoolId,
      recordOwnerUserId: user.id,
      recordStatus: session.status,
      targetType: 'assessment',
      targetId: session.id
    }, event)
    return {
      ...buildAssessmentRecordRow({
        session: {
          id: session.id,
          module: session.module,
          moduleTitle: (moduleMeta as Record<string, { title: string }>)[session.module]?.title || session.module,
          status: session.status,
          contextType: session.contextType,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          completedAt: session.completedAt
        },
        digest: summarizeSessionAttempts(attempts),
        objectLabel: session.contextId ? objectLabelById.get(session.contextId) || null : null,
        plan: planBySession.get(session.id) || null,
        instrumentNames: nameMaps.get(session.module) || {}
      }),
      _capabilities: capabilities
    }
  }))

  return {
    rows,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    capabilities: await resolvePageCapabilities(user, 'assessment', event)
  } satisfies ManagedListResult<typeof rows[number]>
})

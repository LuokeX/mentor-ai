/**
 * 数据驾驶舱 · 个体明细下钻（PRD 4.2 原则 3/4、4.4 与 W7）。
 *
 * 三类目标（学生 / 教师 / 家长）共用同一套三层门禁，缺一不可：
 * 1. 页面级：账号至少可见一个看板页（requireDashboardEntry）；
 * 2. 模块级：平台后台「角色权限配置」给该角色开通 `view_sensitive`（默认关闭）；
 * 3. 目标级：操作时自填事由（≥10 字）换 15 分钟授权（admin_access_grants，见
 *    server/api/v1/admin-access/requests.post.ts 与 requireAdminGrant）。
 *
 * 数据范围：目标必须落在操作者的看板范围（学校 + 班级集合 + 德育/全量口径）内，
 * 越界一律 404，避免通过错误差异枚举其他学校/班级的对象。
 * 返回字段按最小披露裁剪：
 * - 学生：身份 + 学生事件 + 方案风险 + 沟通结构化字段 + 量表等级/归因 + 提问摘要；
 * - 教师：身份 + 负责范围 + 近 30 天计数（不含任何业务正文）；
 * - 家长：身份 + 关系 + 关联学生 + 沟通结构化字段。
 * 三类都不返回助手回答正文、沟通正文与摘要、量表原始作答。
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser } from '../../app/composables/useAuth'
import { communicationChannelLabels, type CommunicationChannel } from '../../shared/contracts'
import { assessmentBadge } from '../../shared/assessments'
import {
  DASHBOARD_INDIVIDUAL_QUESTION_EXCERPT_LENGTH,
  DASHBOARD_INDIVIDUAL_TEACHER_WINDOW_DAYS,
  DASHBOARD_MODULE_LABELS,
  PLAN_RISK_LABELS,
  type DashboardIndividualAssessment,
  type DashboardIndividualCommunication,
  type DashboardIndividualEvent,
  type DashboardIndividualGuardian,
  type DashboardIndividualGuardianDetail,
  type DashboardIndividualGuardianStudent,
  type DashboardIndividualPlan,
  type DashboardIndividualQuestion,
  type DashboardIndividualStudent,
  type DashboardIndividualStudentDetail,
  type DashboardIndividualTargetType,
  type DashboardIndividualTeacher,
  type DashboardIndividualTeacherDetail,
  type PlanRiskSeverity
} from '../../shared/dashboard'
import { gradeLabel } from '../../shared/school-section'
import { useDb, schema, type DbClient } from '../utils/db'
import { decryptSensitive } from '../utils/crypto'
import { truncateByChars } from './plan-titles'
import { redactPii } from '../integrations/deepseek'
import {
  andSql,
  moralModuleCondition,
  moralQuestionCondition,
  moralStudentEventCondition,
  planRiskSeverity
} from './dashboard-metrics'
import { resolveDashboardSensitiveAccess, requireDashboardEntry, requireDashboardScope, type DashboardScope } from './dashboard-scope'
import { recordDashboardAccessDenied } from './dashboard-tracking'

/** 每类明细的返回上限（最小披露：够用即可，不提供批量导出）。 */
export const DASHBOARD_INDIVIDUAL_LIMIT = 20

/** 越界与不存在的统一提示（避免通过错误差异枚举目标）。 */
const NOT_FOUND = '记录不存在'

/** 学生行（含姓名密文）。 */
interface StudentRow {
  id: string
  classId: string | null
  ownerUserId: string
  nameEnc: string
  status: string
}

/** 教师行。 */
interface TeacherRow {
  id: string
  name: string
  teachingGrades: number[]
}

/** 家长行（含姓名密文与关联学生）。 */
interface GuardianRow {
  id: string
  nameEnc: string
  relation: string | null
  ownerUserId: string
  links: GuardianLink[]
}

interface GuardianLink {
  studentId: string
  nameEnc: string
  classId: string | null
  grade: number | null
  className: string
  relation: string | null
}

/** 目标校验结果：按类型分派，交给投影函数。 */
export type DashboardIndividualTarget =
  | { targetType: 'student', scope: DashboardScope, student: StudentRow }
  | { targetType: 'teacher_profile', scope: DashboardScope, teacher: TeacherRow }
  | { targetType: 'guardian', scope: DashboardScope, guardian: GuardianRow }

/** 目标查找结果：区分「不存在」「他校目标」「本校但不在看板范围」，供审计区分越权性质。 */
type ScopedLookup<T> =
  | { ok: true, value: T }
  | { ok: false, reason: 'not_found' | 'cross_school' | 'out_of_scope' }

/**
 * 看板角色的个体明细准入：入口权限 + view_sensitive 能力 + 目标落在看板范围内。
 * 越界或不存在都抛 404，同时按原因写审计 `dashboard.access_denied`（PRD 4.4 红线）。
 */
export async function requireDashboardIndividualTarget(
  event: H3Event,
  user: AuthUser,
  targetType: DashboardIndividualTargetType,
  targetId: string
): Promise<DashboardIndividualTarget> {
  const pages = await requireDashboardEntry(event, user)
  if (!(await resolveDashboardSensitiveAccess(event, user))) {
    await recordDashboardAccessDenied(event, user, { reason: 'individual_no_permission', targetType, targetId })
    throw createError({ statusCode: 403, message: '未开通个体明细查看权限，请联系平台管理员' })
  }
  // 范围与口径与页面一致（按激活角色解析），页面键用第一个可见页以避免与具体页面耦合
  const scope = await requireDashboardScope(event, user, pages[0]!)

  const lookup = targetType === 'teacher_profile'
    ? await lookupTeacherInDashboardScope(event, scope, targetId)
    : targetType === 'guardian'
      ? await lookupGuardianInDashboardScope(event, scope, targetId)
      : await lookupStudentInDashboardScope(event, scope, targetId)

  if (!lookup.ok) {
    await recordDashboardAccessDenied(event, user, {
      reason: `individual_${lookup.reason}`,
      targetType,
      targetId,
      crossSchool: lookup.reason === 'cross_school'
    })
    throw createError({ statusCode: 404, message: NOT_FOUND })
  }
  if (targetType === 'teacher_profile') return { targetType, scope, teacher: lookup.value as TeacherRow }
  if (targetType === 'guardian') return { targetType, scope, guardian: lookup.value as GuardianRow }
  return { targetType: 'student', scope, student: lookup.value as StudentRow }
}

/**
 * 目标班级是否落在看板范围内：学生自带班级优先，缺失时回落到负责教师的主班级
 * （与看板口径一致）；有班级但不在范围内一律视为越界（不回落）。
 */
async function resolveScopedClassId(
  db: DbClient,
  scope: DashboardScope,
  classId: string | null,
  ownerUserId: string
): Promise<string | null> {
  const allowed = new Set(scope.classIds)
  if (classId) return allowed.has(classId) ? classId : null
  const [primary] = await db.select({ id: schema.classes.id })
    .from(schema.classes)
    .where(and(
      eq(schema.classes.schoolId, scope.schoolId),
      eq(schema.classes.ownerUserId, ownerUserId),
      eq(schema.classes.status, 'active')
    ))
    .orderBy(schema.classes.createdAt, schema.classes.id)
    .limit(1)
  return primary && allowed.has(primary.id) ? primary.id : null
}

/** 学生是否在操作者的看板范围内。 */
export async function lookupStudentInDashboardScope(
  event: H3Event,
  scope: DashboardScope,
  studentId: string
): Promise<ScopedLookup<StudentRow>> {
  const db = useDb(event)
  const [student] = await db.select({
    id: schema.students.id,
    schoolId: schema.students.schoolId,
    classId: schema.students.classId,
    ownerUserId: schema.students.ownerUserId,
    nameEnc: schema.students.nameEnc,
    status: schema.students.status
  }).from(schema.students).where(eq(schema.students.id, studentId)).limit(1)

  if (!student) return { ok: false, reason: 'not_found' }
  if (student.schoolId !== scope.schoolId) return { ok: false, reason: 'cross_school' }
  const classId = await resolveScopedClassId(db, scope, student.classId, student.ownerUserId)
  if (!classId) return { ok: false, reason: 'out_of_scope' }
  return { ok: true, value: { id: student.id, classId, ownerUserId: student.ownerUserId, nameEnc: student.nameEnc, status: student.status } }
}

/** 教师是否在操作者的看板范围内：同校且至少一个负责班级落在看板班级集合内。 */
async function lookupTeacherInDashboardScope(
  event: H3Event,
  scope: DashboardScope,
  teacherId: string
): Promise<ScopedLookup<TeacherRow>> {
  const db = useDb(event)
  const [teacher] = await db.select({
    id: schema.users.id,
    schoolId: schema.users.schoolId,
    name: schema.users.name,
    teachingGrades: schema.users.teachingGrades,
    status: schema.users.status
  }).from(schema.users).where(eq(schema.users.id, teacherId)).limit(1)

  if (!teacher || teacher.status === 'disabled') return { ok: false, reason: 'not_found' }
  if (teacher.schoolId !== scope.schoolId) return { ok: false, reason: 'cross_school' }
  if (!scope.classIds.length) return { ok: false, reason: 'out_of_scope' }
  const [owned] = await db.select({ id: schema.classes.id })
    .from(schema.classes)
    .where(and(
      eq(schema.classes.ownerUserId, teacherId),
      eq(schema.classes.schoolId, scope.schoolId),
      eq(schema.classes.status, 'active'),
      inArray(schema.classes.id, [...scope.classIds])
    ))
    .limit(1)
  if (!owned) return { ok: false, reason: 'out_of_scope' }
  return { ok: true, value: { id: teacher.id, name: teacher.name, teachingGrades: teacher.teachingGrades ?? [] } }
}

/**
 * 家长是否在操作者的看板范围内。三条准入路径（满足其一即可）：
 * 1. 有落在看板范围内的关联学生（student_guardians，含关系）；
 * 2. 有落在看板范围内的沟通记录（communications.guardian_id，家长个体入口就是从这条链路进入的）；
 * 3. 档案负责教师的主班级落在看板范围内（与其它按记录人归属的口径一致）。
 */
async function lookupGuardianInDashboardScope(
  event: H3Event,
  scope: DashboardScope,
  guardianId: string
): Promise<ScopedLookup<GuardianRow>> {
  const db = useDb(event)
  const [guardian] = await db.select({
    id: schema.guardians.id,
    schoolId: schema.guardians.schoolId,
    nameEnc: schema.guardians.nameEnc,
    relation: schema.guardians.relation,
    ownerUserId: schema.guardians.ownerUserId,
    status: schema.guardians.status
  }).from(schema.guardians).where(eq(schema.guardians.id, guardianId)).limit(1)

  if (!guardian || guardian.status === 'archived') return { ok: false, reason: 'not_found' }
  if (guardian.schoolId !== scope.schoolId) return { ok: false, reason: 'cross_school' }

  const rows = await db.select({
    studentId: schema.studentGuardians.studentId,
    relation: schema.studentGuardians.relation,
    nameEnc: schema.students.nameEnc,
    classId: schema.students.classId,
    ownerUserId: schema.students.ownerUserId
  }).from(schema.studentGuardians)
    .innerJoin(schema.students, eq(schema.students.id, schema.studentGuardians.studentId))
    .where(and(
      eq(schema.studentGuardians.guardianId, guardianId),
      eq(schema.studentGuardians.status, 'active')
    ))

  const links: GuardianLink[] = []
  for (const row of rows) {
    const classId = await resolveScopedClassId(db, scope, row.classId, row.ownerUserId)
    if (!classId) continue
    const [classRow] = await db.select({ name: schema.classes.name, grade: schema.classes.grade })
      .from(schema.classes).where(eq(schema.classes.id, classId)).limit(1)
    links.push({
      studentId: row.studentId,
      nameEnc: row.nameEnc,
      classId,
      grade: classRow?.grade ?? null,
      className: classRow?.name ?? '未归属',
      relation: row.relation
    })
  }

  const base = { id: guardian.id, nameEnc: guardian.nameEnc, relation: guardian.relation, ownerUserId: guardian.ownerUserId }
  if (links.length) return { ok: true, value: { ...base, links } }
  if (await hasScopedCommunication(event, scope, guardianId)) return { ok: true, value: { ...base, links: [] } }
  if (await resolveScopedClassId(db, scope, null, guardian.ownerUserId)) return { ok: true, value: { ...base, links: [] } }
  return { ok: false, reason: 'out_of_scope' }
}

/** 该家长是否存在落在看板范围内的沟通记录（沟通按学生班级、缺失回落记录人主班级）。 */
async function hasScopedCommunication(event: H3Event, scope: DashboardScope, guardianId: string): Promise<boolean> {
  if (!scope.classIds.length) return false
  const rows = await scopedGuardianCommunications(event, scope, guardianId, 1)
  return rows.length > 0
}

/**
 * 家长名下的沟通记录（已按看板班级范围过滤）。只读结构化字段，不读 summary_enc 正文。
 * 班级口径与看板一致：优先学生自带班级，缺失回落到沟通记录人的主班级。
 */
async function scopedGuardianCommunications(
  event: H3Event,
  scope: DashboardScope,
  guardianId: string,
  limit: number
): Promise<Array<{ id: string, channel: string | null, riskLevel: string | null, occurredAt: Date, guardianId: string | null, studentId: string | null }>> {
  const db = useDb(event)
  const result = await db.execute(sql`
    select cm.id, cm.channel, cm.risk_level, cm.occurred_at, cm.guardian_id, cm.student_id
    from communications cm
    left join students st on st.id = cm.student_id
    left join classes c on c.id = st.class_id
    join (select distinct on (c.owner_user_id) c.owner_user_id, c.id
          from classes c
          where c.school_id = ${scope.schoolId} and c.status = 'active'
          order by c.owner_user_id, c.created_at asc, c.id asc) pc on pc.owner_user_id = cm.owner_user_id
    where cm.guardian_id = ${guardianId}
      and cm.status = 'active' and cm.archived_at is null
      and coalesce(c.id, pc.id) in (${sql.join(scope.classIds.map(id => sql`${id}::uuid`), sql`, `)})
    order by cm.occurred_at desc
    limit ${limit}
  `)
  return (result.rows as Array<{
    id: string
    channel: string | null
    risk_level: string | null
    occurred_at: Date
    guardian_id: string | null
    student_id: string | null
  }>).map(row => ({
    id: row.id,
    channel: row.channel,
    riskLevel: row.risk_level,
    occurredAt: new Date(row.occurred_at),
    guardianId: row.guardian_id,
    studentId: row.student_id
  }))
}

/** 个体明细投影载荷（不含 access，由路由补充授权信息与水印）。 */
export type DashboardIndividualDetailPayload =
  | Omit<DashboardIndividualStudentDetail, 'access'>
  | Omit<DashboardIndividualTeacherDetail, 'access'>
  | Omit<DashboardIndividualGuardianDetail, 'access'>

/** 目标投影（路由按 targetType 分派后调用）。 */
export async function loadDashboardIndividualDetail(
  db: DbClient,
  event: H3Event,
  target: DashboardIndividualTarget
): Promise<DashboardIndividualDetailPayload> {
  if (target.targetType === 'teacher_profile') {
    return loadTeacherDetail(db, target.teacher, target.scope.line)
  }
  if (target.targetType === 'guardian') {
    return loadGuardianDetail(db, event, target.guardian, target.scope)
  }
  return loadStudentDetail(db, event, target.student)
}

/** 学生个体明细投影（最小披露）。 */
async function loadStudentDetail(
  db: DbClient,
  event: H3Event,
  student: StudentRow
): Promise<Omit<DashboardIndividualStudentDetail, 'access'>> {
  const secret = useRuntimeConfig(event).encryptionKey
  const [classRow] = student.classId
    ? await db.select({ name: schema.classes.name, grade: schema.classes.grade })
      .from(schema.classes).where(eq(schema.classes.id, student.classId)).limit(1)
    : []

  const [eventRows, planRows, communicationRows, assessmentRows, questionRows] = await Promise.all([
    db.select({
      id: schema.studentEvents.id,
      eventType: schema.studentEvents.eventType,
      severity: schema.studentEvents.severity,
      occurredAt: schema.studentEvents.occurredAt,
      createdAt: schema.studentEvents.createdAt,
      status: schema.studentEvents.status
    }).from(schema.studentEvents)
      .where(and(eq(schema.studentEvents.studentId, student.id), isNull(schema.studentEvents.archivedAt)))
      .orderBy(desc(schema.studentEvents.createdAt))
      .limit(DASHBOARD_INDIVIDUAL_LIMIT + 1),
    db.select({
      id: schema.plans.id,
      module: schema.plans.module,
      report: schema.plans.report,
      status: schema.plans.status,
      createdAt: schema.plans.createdAt
    }).from(schema.plans)
      .where(eq(schema.plans.studentId, student.id))
      .orderBy(desc(schema.plans.createdAt))
      .limit(DASHBOARD_INDIVIDUAL_LIMIT + 1),
    db.select({
      id: schema.communications.id,
      channel: schema.communications.channel,
      riskLevel: schema.communications.riskLevel,
      occurredAt: schema.communications.occurredAt,
      guardianId: schema.communications.guardianId
    }).from(schema.communications)
      .where(and(
        eq(schema.communications.studentId, student.id),
        eq(schema.communications.status, 'active'),
        isNull(schema.communications.archivedAt)
      ))
      .orderBy(desc(schema.communications.occurredAt))
      .limit(DASHBOARD_INDIVIDUAL_LIMIT + 1),
    loadAssessmentRows(db, student.id),
    loadQuestionRows(db, student.id)
  ])

  const studentEvents: DashboardIndividualEvent[] = eventRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map((row) => {
    const occurred = row.occurredAt ?? row.createdAt
    return {
      id: row.id,
      eventType: row.eventType,
      severity: row.severity,
      occurredAt: toIso(occurred),
      status: row.status
    }
  })

  const plans: DashboardIndividualPlan[] = planRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map((row) => {
    const severity: PlanRiskSeverity = planRiskSeverity(row.report)
    return {
      id: row.id,
      module: row.module,
      moduleLabel: DASHBOARD_MODULE_LABELS[row.module] ?? row.module,
      riskSeverity: severity,
      riskLabel: PLAN_RISK_LABELS[severity],
      status: row.status,
      createdAt: row.createdAt.toISOString()
    }
  })

  const communications: DashboardIndividualCommunication[] = communicationRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map(row => ({
    id: row.id,
    channel: row.channel,
    channelLabel: channelLabel(row.channel),
    riskLevel: row.riskLevel,
    occurredAt: row.occurredAt.toISOString(),
    guardianId: row.guardianId
  }))

  const assessments: DashboardIndividualAssessment[] = assessmentRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map(row => ({
    id: row.id,
    moduleLabel: DASHBOARD_MODULE_LABELS[row.module] ?? row.module,
    instrumentName: pickResultString(row.result, 'instrumentName') ?? row.assessmentCode,
    levelLabel: assessmentBadge(pickResultString(row.result, 'level') ?? undefined)?.label
      ?? pickResultString(row.result, 'levelName')
      ?? '—',
    attribution: pickPrimaryAttribution(row.result) ?? '',
    submittedAt: toIso(row.submittedAt ?? row.createdAt)
  }))

  const aiQuestions: DashboardIndividualQuestion[] = questionRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map(row => ({
    id: row.id,
    excerpt: truncateByChars(redactPii(decryptSensitive(row.contentEnc, secret)), DASHBOARD_INDIVIDUAL_QUESTION_EXCERPT_LENGTH),
    category: row.questionCategory ?? '',
    keywords: row.questionKeywords ?? [],
    createdAt: row.createdAt.toISOString()
  }))

  const truncated = eventRows.length > DASHBOARD_INDIVIDUAL_LIMIT
    || planRows.length > DASHBOARD_INDIVIDUAL_LIMIT
    || communicationRows.length > DASHBOARD_INDIVIDUAL_LIMIT
    || assessmentRows.length > DASHBOARD_INDIVIDUAL_LIMIT
    || questionRows.length > DASHBOARD_INDIVIDUAL_LIMIT

  const detail: DashboardIndividualStudent = {
    id: student.id,
    name: decryptSensitive(student.nameEnc, secret),
    grade: classRow?.grade ?? null,
    gradeLabel: classRow?.grade ? gradeLabel(classRow.grade) : '未归属',
    className: classRow?.name ?? '未归属',
    status: student.status
  }

  return {
    targetType: 'student',
    student: detail,
    studentEvents,
    plans,
    communications,
    assessments,
    aiQuestions,
    limits: { perCollection: DASHBOARD_INDIVIDUAL_LIMIT, truncated }
  }
}

/**
 * 教师个体投影（最小披露）：身份 + 负责范围 + 窗口内计数。
 * 不返回提问原文、方案/事件正文与任何学生名单。
 */
async function loadTeacherDetail(
  db: DbClient,
  teacher: TeacherRow,
  line: 'all' | 'moral'
): Promise<Omit<DashboardIndividualTeacherDetail, 'access'>> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - DASHBOARD_INDIVIDUAL_TEACHER_WINDOW_DAYS * 86_400_000)

  const [classRows, studentTotal, questionTotal, planTotal, eventTotal] = await Promise.all([
    db.select({ id: schema.classes.id })
      .from(schema.classes)
      .where(and(
        eq(schema.classes.ownerUserId, teacher.id),
        eq(schema.classes.status, 'active')
      )),
    db.select({ value: sql<number>`count(*)::int` })
      .from(schema.students)
      .innerJoin(schema.classes, eq(schema.classes.id, schema.students.classId))
      .where(and(eq(schema.classes.ownerUserId, teacher.id), eq(schema.classes.status, 'active'))),
    countTeacherRows(db, sql`
      select count(*)::int as value
      from chat_messages cm
      where cm.owner_user_id = ${teacher.id} and cm.role = 'user' and cm.deleted_at is null
        and cm.created_at >= ${windowStart} and cm.created_at <= ${now}
        ${andSql(moralQuestionCondition(sql`cm.question_category`, line))}
    `),
    countTeacherRows(db, sql`
      select count(*)::int as value
      from plans p
      where p.owner_user_id = ${teacher.id} and p.created_at >= ${windowStart} and p.created_at <= ${now}
        ${andSql(moralModuleCondition(sql`p.module`, line))}
    `),
    countTeacherRows(db, sql`
      select count(*)::int as value
      from student_events se
      where se.owner_user_id = ${teacher.id} and se.archived_at is null
        and coalesce(se.occurred_at, se.created_at) >= ${windowStart}
        and coalesce(se.occurred_at, se.created_at) <= ${now}
        ${andSql(moralStudentEventCondition(sql`se.event_type`, line))}
    `)
  ])

  const detail: DashboardIndividualTeacher = {
    id: teacher.id,
    name: teacher.name,
    teachingGradeLabels: [...new Set(teacher.teachingGrades)]
      .filter(grade => Number.isInteger(grade) && grade >= 1 && grade <= 12)
      .sort((a, b) => a - b)
      .map(grade => gradeLabel(grade)),
    classCount: classRows.length,
    studentCount: studentTotal[0]?.value ?? 0,
    windowDays: DASHBOARD_INDIVIDUAL_TEACHER_WINDOW_DAYS,
    aiQuestions: questionTotal,
    plans: planTotal,
    studentEvents: eventTotal
  }

  return {
    targetType: 'teacher_profile',
    teacher: detail,
    limits: { perCollection: DASHBOARD_INDIVIDUAL_LIMIT, truncated: false }
  }
}

/**
 * 家长个体投影：身份 + 关联学生（已在范围内过滤）+ 名下的沟通结构化字段。
 * 关联学生来自 student_guardians（可能为空）；沟通记录按家长直接关联（communications.guardian_id）
 * 并在看板班级范围内过滤，因此没有学生关联的家长档案也能给出有效的沟通概览。
 */
async function loadGuardianDetail(
  db: DbClient,
  event: H3Event,
  guardian: GuardianRow,
  scope: DashboardScope
): Promise<Omit<DashboardIndividualGuardianDetail, 'access'>> {
  const secret = useRuntimeConfig(event).encryptionKey
  const communicationRows = await scopedGuardianCommunications(event, scope, guardian.id, DASHBOARD_INDIVIDUAL_LIMIT + 1)

  // 关联学生：先取 student_guardians 的关联；缺失时用沟通记录里出现的学生补齐（同样限定在看板范围内）
  const studentIds = [...new Set([
    ...guardian.links.map(link => link.studentId),
    ...communicationRows.map(row => row.studentId).filter((id): id is string => Boolean(id))
  ])]
  const students: DashboardIndividualGuardianStudent[] = guardian.links.map(link => ({
    id: link.studentId,
    name: decryptSensitive(link.nameEnc, secret),
    gradeLabel: link.grade ? gradeLabel(link.grade) : '未归属',
    className: link.className,
    relation: link.relation
  }))
  if (!students.length && studentIds.length) {
    const rows = await db.select({
      id: schema.students.id,
      nameEnc: schema.students.nameEnc,
      classId: schema.students.classId,
      ownerUserId: schema.students.ownerUserId
    }).from(schema.students).where(inArray(schema.students.id, studentIds))
    for (const row of rows) {
      const classId = await resolveScopedClassId(db, scope, row.classId, row.ownerUserId)
      if (!classId) continue
      const [classRow] = await db.select({ name: schema.classes.name, grade: schema.classes.grade })
        .from(schema.classes).where(eq(schema.classes.id, classId)).limit(1)
      students.push({
        id: row.id,
        name: decryptSensitive(row.nameEnc, secret),
        gradeLabel: classRow?.grade ? gradeLabel(classRow.grade) : '未归属',
        className: classRow?.name ?? '未归属',
        relation: null
      })
    }
  }

  const communications: DashboardIndividualCommunication[] = communicationRows.slice(0, DASHBOARD_INDIVIDUAL_LIMIT).map(row => ({
    id: row.id,
    channel: row.channel,
    channelLabel: channelLabel(row.channel),
    riskLevel: row.riskLevel,
    occurredAt: row.occurredAt.toISOString(),
    guardianId: row.guardianId
  }))

  const detail: DashboardIndividualGuardian = {
    id: guardian.id,
    name: decryptSensitive(guardian.nameEnc, secret),
    relation: guardian.relation,
    students
  }

  return {
    targetType: 'guardian',
    guardian: detail,
    communications,
    limits: { perCollection: DASHBOARD_INDIVIDUAL_LIMIT, truncated: communicationRows.length > DASHBOARD_INDIVIDUAL_LIMIT }
  }
}

/** 该学生的量表作答：评估组上下文指向该学生，或方案归属该学生（两条链路合并去重）。 */
async function loadAssessmentRows(db: DbClient, studentId: string) {
  const result = await db.execute(sql`
    select aa.id, aa.module, aa.assessment_code, aa.result, aa.submitted_at, aa.created_at
    from assessment_attempts aa
    where aa.status = 'submitted' and aa.archived_at is null
      and (
        exists (
          select 1 from assessment_session_attempts asa
          join assessment_sessions ase on ase.id = asa.assessment_session_id
          where asa.assessment_attempt_id = aa.id
            and ase.context_type = 'student' and ase.context_id = ${studentId}::uuid
        )
        or exists (
          select 1 from plan_assessment_attempts paa
          join plans p on p.id = paa.plan_id
          where paa.assessment_attempt_id = aa.id and p.student_id = ${studentId}::uuid
        )
      )
    order by coalesce(aa.submitted_at, aa.created_at) desc
    limit ${DASHBOARD_INDIVIDUAL_LIMIT + 1}
  `)
  return (result.rows as Array<{
    id: string
    module: string
    assessment_code: string
    result: Record<string, unknown> | null
    submitted_at: Date | string | null
    created_at: Date | string
  }>).map(row => ({
    id: row.id,
    module: row.module,
    assessmentCode: row.assessment_code,
    result: row.result,
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    createdAt: new Date(row.created_at)
  }))
}

/** 该学生相关的 AI 提问（会话把咨询对象绑定到该学生）。 */
async function loadQuestionRows(db: DbClient, studentId: string) {
  const result = await db.execute(sql`
    select cm.id, cm.content_enc, cm.question_category, cm.question_keywords, cm.created_at
    from chat_messages cm
    join chat_sessions cs on cs.id = cm.session_id
    where cs.context_type = 'student' and cs.context_id = ${studentId}::uuid
      and cm.role = 'user' and cm.deleted_at is null
    order by cm.created_at desc
    limit ${DASHBOARD_INDIVIDUAL_LIMIT + 1}
  `)
  return (result.rows as Array<{
    id: string
    content_enc: string
    question_category: string | null
    question_keywords: string[] | null
    created_at: Date | string
  }>).map(row => ({
    id: row.id,
    contentEnc: row.content_enc,
    questionCategory: row.question_category,
    questionKeywords: row.question_keywords ?? [],
    createdAt: new Date(row.created_at)
  }))
}

/** 单值计数查询（教师投影用）。 */
async function countTeacherRows(db: DbClient, query: SQL): Promise<number> {
  const result = await db.execute(query)
  const [row] = result.rows as Array<{ value: number }>
  return row?.value ?? 0
}

function channelLabel(channel: string | null): string {
  if (!channel) return '未标注'
  return communicationChannelLabels[channel as CommunicationChannel] ?? channel
}

function pickResultString(result: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = result?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 从确定性规则结果里取主归因名称（attributions[0].name）。 */
function pickPrimaryAttribution(result: Record<string, unknown> | null | undefined): string | null {
  const list = result?.attributions
  if (!Array.isArray(list) || !list.length) return null
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  const name = (first as { name?: unknown }).name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

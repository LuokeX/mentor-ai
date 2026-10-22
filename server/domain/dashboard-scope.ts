/**
 * 数据驾驶舱的范围解析。
 *
 * 范围口径：默认就是「本校全部班级」——组织模型里每个学部在平台里是一所独立学校
 * （如「六力学校-小学部」），校长看本校全部数据，不需要额外配置学部。
 *
 * 兼容：账号在 `user_roles.scope.section` 上显式声明了具体学部时（例如一所学校内部
 * 再按学部收窄），仍按该学部过滤；未声明或声明为 all 时按本校全部班级处理。
 *
 * 班级归属：优先用 `classes.section`；为空、空串或标成 all 时，用 `classes.grade`
 * 经 `gradesOfSchoolSection()` 折算。复读部没有固定年级，只能按 section 精确匹配。
 *
 * 所有看板查询都必须先经过本模块拿到 classIds，再在查询里带上 schoolId + classIds，
 * 不允许把学部范围交给调用方自己拼。
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AppRole, AuthUser } from '../../app/composables/useAuth'
import {
  type SchoolSection,
  SCHOOL_SECTION_LABELS,
  gradeLabel,
  gradesOfSchoolSection,
  normalizeSchoolSection
} from '../../shared/school-section'
import {
  DASHBOARD_PAGE_KEYS,
  DASHBOARD_PAGES,
  type DashboardLine,
  type DashboardPageKey
} from '../../shared/dashboard'
import { type DbClient, schema, useDb } from '../utils/db'
import { DASHBOARD_ROLES, resolveCapabilities, resolvePageCapabilities } from './capabilities'
import { recordDashboardAccessDenied } from './dashboard-tracking'
import { listUserRoles, normalizeScopeGrades } from './user-roles'

/**
 * 数据驾驶舱角色（校长 / 德育主任 / 年级主任）：看板入口权限在「角色权限配置」的
 * `dashboard` 目标类型下，这里只保留角色编码常量供默认 scope 解析使用。
 */
export const DASHBOARD_ROLE: AppRole = 'division_principal'

export interface DashboardGradeScope {
  grade: number
  label: string
  classCount: number
}

export interface DashboardClassScope {
  id: string
  name: string
  grade: number
  /** 年级中文标签（一年级…高三）。 */
  gradeLabel: string
}

export interface DashboardScope {
  schoolId: string
  /** 学校名称（未收窄到具体学部时用于「数据范围」展示）。 */
  schoolLabel: string
  /** 未配置学部时为 all（本校全部班级）。 */
  section: SchoolSection
  sectionLabel: string
  /** 该范围内实际有班级的年级（按年级升序），供筛选下拉使用。 */
  grades: DashboardGradeScope[]
  classes: DashboardClassScope[]
  classIds: string[]
  /** 数据口径：德育主任为 moral（德育线，见 shared/dashboard.ts 的 DASHBOARD_MORAL_LINE），其余为 all。 */
  line: DashboardLine
}

/**
 * 读取账号在 user_roles 上声明的看板范围（section 学部 / grades 年级）：
 * - 学部校长、德育主任：通常不配 scope，看本校全部班级；
 * - 年级主任：配 `scope.grades`（兼容旧 `scope.grade`），只看所辖年级（跨班、可多选）。
 * 未声明的键返回空数组，表示不收窄。
 */
export async function readDashboardScopeConfig(
  db: DbClient,
  userId: string,
  role?: AppRole
): Promise<{ section: SchoolSection | null, grades: number[] }> {
  const entries = await listUserRoles(db, userId)
  const entry = role
    ? entries.find(item => item.roleCode === role)
    : entries.find(item => item.roleCode === DASHBOARD_ROLE)
  const section = normalizeSchoolSection(entry?.scope.section)
  return {
    // all 表示「全学部」，等价于不收窄
    section: section === 'all' ? null : section,
    grades: normalizeScopeGrades(entry?.scope.grades ?? entry?.scope.grade)
  }
}

/** 解析看板范围：section / grades 都为空表示本校全部班级；配置后收窄到该学部或这些年级。 */
export async function resolveDashboardScope(
  db: DbClient,
  input: { schoolId: string, section: SchoolSection | null, grades?: number[], line?: DashboardLine }
): Promise<DashboardScope> {
  const { schoolId, section } = input
  const grades = normalizeScopeGrades(input.grades)
  const line: DashboardLine = input.line ?? 'all'
  const sectionGrades = section ? gradesOfSchoolSection(section) : []
  const unlabeled = or(isNull(schema.classes.section), eq(schema.classes.section, ''), eq(schema.classes.section, 'all'))
  const sectionCondition = !section
    ? undefined
    : sectionGrades.length
      ? or(eq(schema.classes.section, section), and(unlabeled, inArray(schema.classes.grade, sectionGrades)))
      : eq(schema.classes.section, section)
  const gradeCondition = grades.length ? inArray(schema.classes.grade, grades) : undefined

  const [schoolRows, classRows] = await Promise.all([
    db.select({ name: schema.schools.name }).from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1),
    db.select({
      id: schema.classes.id,
      name: schema.classes.name,
      grade: schema.classes.grade
    }).from(schema.classes).where(and(
      eq(schema.classes.schoolId, schoolId),
      eq(schema.classes.status, 'active'),
      ...(sectionCondition ? [sectionCondition] : []),
      ...(gradeCondition ? [gradeCondition] : [])
    )).orderBy(schema.classes.grade, schema.classes.name)
  ])

  const classes: DashboardClassScope[] = classRows.map(row => ({
    id: row.id,
    name: row.name,
    grade: row.grade,
    gradeLabel: gradeLabel(row.grade)
  }))

  const gradeCounts = new Map<number, number>()
  for (const item of classes) gradeCounts.set(item.grade, (gradeCounts.get(item.grade) ?? 0) + 1)

  const sectionLabel = grades.length
    ? grades.map(item => gradeLabel(item)).join('、')
    : section ? SCHOOL_SECTION_LABELS[section] : (schoolRows[0]?.name ?? '本校')

  return {
    schoolId,
    schoolLabel: schoolRows[0]?.name ?? '本校',
    section: section ?? 'all',
    sectionLabel,
    grades: [...gradeCounts.entries()]
      .map(([grade, classCount]) => ({ grade, label: gradeLabel(grade), classCount }))
      .sort((a, b) => a.grade - b.grade),
    classes,
    classIds: classes.map(item => item.id),
    line
  }
}

/** 激活角色 → 看板数据口径：德育主任看德育线，其余角色看全量。 */
export function resolveDashboardLine(user: AuthUser): DashboardLine {
  return user.role === 'moral_education_director' ? 'moral' : 'all'
}

/** 驾驶舱入口校验：至少可见一个看板页，返回可见页集合（供 context 下发给前端导航）。 */
export async function requireDashboardEntry(event: H3Event, user: AuthUser): Promise<DashboardPageKey[]> {
  if (!user.schoolId) throw createError({ statusCode: 400, message: '账号未关联学校' })
  const pages: DashboardPageKey[] = []
  for (const page of DASHBOARD_PAGE_KEYS) {
    const capabilities = await resolvePageCapabilities(user, page, event)
    if (capabilities.includes('view')) pages.push(page)
  }
  if (!pages.length) {
    await recordDashboardAccessDenied(event, user, { reason: 'entry_forbidden' })
    throw createError({ statusCode: 403, message: '无权查看数据驾驶舱，请联系平台管理员开通权限' })
  }
  return pages
}

/**
 * 路由入口：校验数据驾驶舱「某一页」的页面级权限并解析范围。
 *
 * 权限：该页对应的目标类型（`dashboard` / `dashboard_ai_questions` / `dashboard_plans` /
 * `dashboard_alerts`）在 roles.permissions 的页面级「查看」（平台后台「角色权限配置」可逐页勾选，
 * 变更即时生效）。未配置该目标类型时回退硬编码规则（三个看板角色具备）。
 * 范围：按激活角色在 user_roles 上的 scope 收窄——`scope.section` 收窄到学部、
 * `scope.grades`（兼容旧 `scope.grade`）收窄到所辖年级（年级主任，可多选）；都不配就是本校全部班级。
 * 口径：德育主任（moral_education_director）为德育线，其余为全量。
 * 账号未关联学校时返回 400。
 */
export async function requireDashboardScope(
  event: H3Event,
  user: AuthUser,
  page: DashboardPageKey = 'dashboard'
): Promise<DashboardScope> {
  if (!user.schoolId) throw createError({ statusCode: 400, message: '账号未关联学校' })
  const capabilities = await resolvePageCapabilities(user, page, event)
  if (!capabilities.includes('view')) {
    const label = DASHBOARD_PAGES.find(item => item.key === page)?.label ?? '数据驾驶舱'
    await recordDashboardAccessDenied(event, user, { reason: 'page_forbidden', page })
    throw createError({ statusCode: 403, message: `无权查看「${label}」，请联系平台管理员开通数据驾驶舱权限` })
  }
  const db = useDb(event)
  const { section, grades } = await readDashboardScopeConfig(db, user.id, user.role)
  // 年级主任的看板范围就是所辖年级：未配置时不放行全校数据，避免越权查看
  if (user.role === 'grade_director' && !grades.length) {
    throw createError({ statusCode: 400, message: '账号未配置所辖年级，请联系学校管理员在角色范围中指定年级后重试' })
  }
  return resolveDashboardScope(db, {
    schoolId: user.schoolId,
    section,
    grades,
    line: resolveDashboardLine(user)
  })
}

/**
 * 个体明细查看能力（PRD 4.2 原则 4）：`dashboard` 记录级能力里的 `view_sensitive`。
 * 默认不勾选，需平台管理员在「角色权限配置」按校方授权开通；未开通时不返回个体入口。
 */
export async function resolveDashboardSensitiveAccess(event: H3Event, user: AuthUser): Promise<boolean> {
  if (!DASHBOARD_ROLES.has(user.role)) return false
  const capabilities = await resolveCapabilities({ user, targetType: 'dashboard' }, event)
  return capabilities.includes('view_sensitive')
}

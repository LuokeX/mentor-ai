/**
 * 账号 ↔ 角色关联的读写收口。
 *
 * 背景：一个账号可持有多个角色（user_roles），同一时刻只有一个「激活角色」存在
 * sessions.active_role（为空回落到 users.role）。users.role 保留为「主角色」，
 * 必须始终是 user_roles 中该账号的角色之一，用于兼容既有按角色过滤的 SQL。
 *
 * 约定：
 * 1. 所有角色写入都走本模块，不要在路由里直接 insert/delete user_roles，
 *    否则主角色一致性会被破坏（会出现「账号没有自己主角色」的悬空状态）。
 * 2. 本模块不写审计：审计动作名由调用方决定（如 school_admin.user.create /
 *    platform_admin.user.roles.update），调用方把结果角色写进 metadata 即可。
 * 3. 传 event 是为了兼容 writeAudit 与错误提示；传 db 是为了支持事务内调用
 *    （创建账号与角色写入必须在同一事务里）。
 */
import { and, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm'
import type { AppRole } from '../../app/composables/useAuth'
import type { RoleScope } from '../../shared/management'
import { type DbClient, schema } from '../utils/db'

/** 账号的一条角色记录。 */
export interface UserRoleEntry {
  roleCode: AppRole
  /** 角色所属租户；为空表示平台级角色（platform_admin）或历史数据。 */
  schoolId: string | null
  scope: RoleScope
}

/** 账号可切换的工作区（租户）。 */
export interface UserTenant {
  schoolId: string
  schoolName: string
  schoolCode: string
  kind: string
  roles: AppRole[]
}

/**
 * 学校级账号管理（学校后台「账号管理」与平台后台该校账号页）可管理的角色：
 * 教师、心理专员，以及两个只读数据驾驶舱角色（德育主任、年级主任）。
 * 学校管理员与平台管理员账号由平台侧单独维护，学部校长仍由平台侧开通，都不在此集合内：
 * 列表按此集合收敛行级能力，写接口按此集合校验目标，避免出现「看得到却改不了」的按钮。
 */
export const SCHOOL_MANAGED_ROLES: readonly AppRole[] = [
  'teacher',
  'psychologist',
  'moral_education_director',
  'grade_director'
]

/**
 * 是否持有教师或心理专员角色：这两类账号有业务数据归属，
 * 调整角色/停用必须先完成业务移交，只读看板角色没有这层约束。
 */
export function hasBusinessRole(roleCodes: readonly AppRole[]): boolean {
  return roleCodes.some(role => role === 'teacher' || role === 'psychologist')
}

/** 是否属于学校级账号管理可维护的角色集合。 */
export function isSchoolManagedRole(roleCode: string): boolean {
  return (SCHOOL_MANAGED_ROLES as readonly string[]).includes(roleCode)
}

/**
 * 抛错：Nitro 路由中 createError 是运行时全局，能带上 HTTP 状态码；
 * 脚本（tsx，无 Nitro 全局）里退化为普通 Error，避免出现 `createError is not defined`。
 * 本模块同时被路由与脚本使用（seed / create-account），所以统一走这里。
 */
function fail(statusCode: number, message: string): never {
  if (typeof createError === 'function') throw createError({ statusCode, message })
  throw new Error(message)
}

/**
 * 年级范围净化：只保留 1-12 的整数，去重并按升序排列。
 * 兼容旧版单年级字段（number）与新版数组（number[]）。
 */
export function normalizeScopeGrades(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : [value]
  const grades = raw.filter((item): item is number =>
    typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 12
  )
  return [...new Set(grades)].sort((a, b) => a - b)
}

/** 角色范围净化：只保留已知键，忽略 JSONB 里的脏数据。 */
export function normalizeRoleScope(scope: unknown): RoleScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {}
  const record = scope as Record<string, unknown>
  const out: RoleScope = {}
  if (typeof record.section === 'string' && record.section) out.section = record.section
  const grades = normalizeScopeGrades(record.grades)
  if (grades.length) {
    out.grades = grades
    // 兼容仍读取旧字段的调用方
    out.grade = grades[0]
  } else {
    // 旧版只写了单年级：保持原形状，读取方用 grades ?? grade 兼容
    const legacyGrades = normalizeScopeGrades(record.grade)
    if (legacyGrades.length) out.grade = legacyGrades[0]
  }
  return out
}

function scopeCondition(column: typeof schema.userRoles.schoolId, schoolId: string | null) {
  return schoolId === null ? isNull(column) : eq(column, schoolId)
}

/**
 * 读取单个账号的角色集合（按角色编码稳定排序）。
 * - 传 schoolId：只读该租户下的角色；
 * - 传 null：只读平台级（无租户）角色；
 * - 不传：读账号全部角色（管理端/兼容旧调用）。
 */
export async function listUserRoles(db: DbClient, userId: string, schoolId?: string | null): Promise<UserRoleEntry[]> {
  const conditions = [eq(schema.userRoles.userId, userId)]
  if (schoolId !== undefined) conditions.push(scopeCondition(schema.userRoles.schoolId, schoolId))
  const rows = await db.select({
    roleCode: schema.userRoles.roleCode,
    schoolId: schema.userRoles.schoolId,
    scope: schema.userRoles.scope
  })
    .from(schema.userRoles)
    .where(and(...conditions))
    .orderBy(schema.userRoles.roleCode)
  return rows.map(row => ({
    roleCode: row.roleCode as AppRole,
    schoolId: row.schoolId,
    scope: normalizeRoleScope(row.scope)
  }))
}

/** 批量读取多个账号的角色（列表页用，避免 N+1）。返回 userId → 角色集合；可按租户过滤。 */
export async function listRolesByUserIds(db: DbClient, userIds: readonly string[], schoolId?: string | null): Promise<Map<string, UserRoleEntry[]>> {
  const unique = [...new Set(userIds)]
  const result = new Map<string, UserRoleEntry[]>()
  if (!unique.length) return result
  const conditions = [inArray(schema.userRoles.userId, unique)]
  if (schoolId !== undefined) conditions.push(scopeCondition(schema.userRoles.schoolId, schoolId))
  const rows = await db.select({
    userId: schema.userRoles.userId,
    roleCode: schema.userRoles.roleCode,
    schoolId: schema.userRoles.schoolId,
    scope: schema.userRoles.scope
  })
    .from(schema.userRoles)
    .where(and(...conditions))
    .orderBy(schema.userRoles.userId, schema.userRoles.roleCode)
  for (const row of rows) {
    const list = result.get(row.userId) ?? []
    list.push({
      roleCode: row.roleCode as AppRole,
      schoolId: row.schoolId,
      scope: normalizeRoleScope(row.scope)
    })
    result.set(row.userId, list)
  }
  return result
}

/** 账号可切换的工作区列表：按租户聚合角色，只返回 active 租户。 */
export async function listUserTenants(db: DbClient, userId: string): Promise<UserTenant[]> {
  const rows = await db.select({
    schoolId: schema.schools.id,
    schoolName: schema.schools.name,
    schoolCode: schema.schools.code,
    kind: schema.schools.kind,
    roleCode: schema.userRoles.roleCode
  })
    .from(schema.userRoles)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.userRoles.schoolId))
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.schools.status, 'active')))
    .orderBy(schema.schools.name, schema.userRoles.roleCode)
  const grouped = new Map<string, UserTenant>()
  for (const row of rows) {
    const tenant = grouped.get(row.schoolId) ?? {
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      schoolCode: row.schoolCode,
      kind: row.kind,
      roles: []
    }
    tenant.roles.push(row.roleCode as AppRole)
    grouped.set(row.schoolId, tenant)
  }
  return [...grouped.values()]
}

/** 校验角色编码都在 roles 目录表里，避免写入目录表不存在的角色。 */
async function assertKnownRoles(db: DbClient, roleCodes: readonly AppRole[]): Promise<void> {
  if (!roleCodes.length) return
  const rows = await db.select({ code: schema.roles.code }).from(schema.roles).where(inArray(schema.roles.code, [...roleCodes]))
  const known = new Set(rows.map(row => row.code))
  const unknown = roleCodes.filter(code => !known.has(code))
  if (unknown.length) {
    fail(400, `角色不存在：${unknown.join('、')}`)
  }
}

export interface ApplyUserRolesInput {
  userId: string
  /** 目标角色集合，必须非空且包含 primaryRole。 */
  roleCodes: readonly AppRole[]
  /** 主角色（写回 users.role）。省略时沿用账号当前主角色（要求它仍在集合内）。 */
  primaryRole?: AppRole
  /** 角色级范围，按键为角色编码；未传的角色保留已有范围。 */
  scopes?: Partial<Record<AppRole, RoleScope>>
  /**
   * 角色所属租户。新代码必须传；省略时保持旧行为（覆盖账号全部角色），仅用于兼容。
   * 传值时只增删该租户的角色行，不会影响其他租户（如 C 端角色）。
   */
  schoolId?: string | null
}

/**
 * 覆盖式写入账号在某个租户下的角色集合：
 * - 新增集合内缺失的角色行、更新传了 scope 的角色行；
 * - 删除该租户下集合外的角色行（不影响其他租户）；
 * - 仅当写入的是账号主租户时同步 users.role 为主角色。
 * 主角色规则：显式传入时必须在集合内；未传时沿用账号当前主角色（必须仍在集合内）。
 */
export async function applyUserRoles(db: DbClient, input: ApplyUserRolesInput): Promise<{ roles: AppRole[], primaryRole: AppRole, schoolId: string | null }> {
  const roleCodes = [...new Set(input.roleCodes)]
  if (!roleCodes.length) fail(400, '账号至少需要一个角色')
  await assertKnownRoles(db, roleCodes)

  const [user] = await db.select({ id: schema.users.id, role: schema.users.role, schoolId: schema.users.schoolId })
    .from(schema.users).where(eq(schema.users.id, input.userId)).limit(1)
  if (!user) fail(404, '账号不存在')

  const primaryRole = (input.primaryRole ?? user.role) as AppRole
  if (!roleCodes.includes(primaryRole)) {
    fail(400, '主角色必须包含在账号的角色集合中')
  }

  const scopedConditions = [eq(schema.userRoles.userId, input.userId)]
  if (input.schoolId !== undefined) scopedConditions.push(scopeCondition(schema.userRoles.schoolId, input.schoolId))
  const existing = await db.select({ roleCode: schema.userRoles.roleCode })
    .from(schema.userRoles).where(and(...scopedConditions))
  const existingCodes = new Set(existing.map(row => row.roleCode))

  const now = new Date()
  for (const roleCode of roleCodes) {
    const scope = input.scopes?.[roleCode]
    if (existingCodes.has(roleCode)) {
      if (scope) {
        const updateConditions = [
          eq(schema.userRoles.userId, input.userId),
          eq(schema.userRoles.roleCode, roleCode)
        ]
        if (input.schoolId !== undefined) updateConditions.push(scopeCondition(schema.userRoles.schoolId, input.schoolId))
        await db.update(schema.userRoles).set({ scope, updatedAt: now })
          .where(and(...updateConditions))
      }
      continue
    }
    await db.insert(schema.userRoles).values({
      userId: input.userId,
      schoolId: input.schoolId ?? null,
      roleCode,
      scope: scope ?? {}
    })
  }

  const removed = [...existingCodes].filter(code => !roleCodes.includes(code as AppRole))
  if (removed.length) {
    const deleteConditions = [
      eq(schema.userRoles.userId, input.userId),
      inArray(schema.userRoles.roleCode, removed)
    ]
    if (input.schoolId !== undefined) deleteConditions.push(scopeCondition(schema.userRoles.schoolId, input.schoolId))
    await db.delete(schema.userRoles).where(and(...deleteConditions))
  }

  // 只有主租户（或旧调用未指定租户）才允许改 users.role；
  // 给学校账号追加 C 端角色时不能把主角色改成 teacher。
  const isPrimaryTenant = input.schoolId === undefined || input.schoolId === user.schoolId
  if (isPrimaryTenant && user.role !== primaryRole) {
    await db.update(schema.users).set({ role: primaryRole, updatedAt: now }).where(eq(schema.users.id, input.userId))
  }

  return { roles: roleCodes, primaryRole, schoolId: input.schoolId ?? null }
}

/** 追加一个角色（幂等）：已存在则只更新范围。 */
export async function addUserRole(
  db: DbClient,
  input: { userId: string, roleCode: AppRole, scope?: RoleScope, schoolId?: string | null }
): Promise<void> {
  await assertKnownRoles(db, [input.roleCode])
  const existing = await db.select({ id: schema.userRoles.id }).from(schema.userRoles).where(and(
    eq(schema.userRoles.userId, input.userId),
    eq(schema.userRoles.roleCode, input.roleCode),
    scopeCondition(schema.userRoles.schoolId, input.schoolId ?? null)
  )).limit(1)
  if (existing.length) {
    await db.update(schema.userRoles)
      .set({ scope: input.scope ?? {}, updatedAt: new Date() })
      .where(eq(schema.userRoles.id, existing[0]!.id))
    return
  }
  await db.insert(schema.userRoles).values({
    userId: input.userId,
    schoolId: input.schoolId ?? null,
    roleCode: input.roleCode,
    scope: input.scope ?? {}
  })
}

/**
 * 移除一个角色。仅当移除的是账号主租户的主角色时，才要求同时指定新的主角色；
 * 移除 C 端等非主租户角色不影响 users.role。
 */
export async function removeUserRole(
  db: DbClient,
  input: { userId: string, roleCode: AppRole, nextPrimaryRole?: AppRole, schoolId?: string | null }
): Promise<void> {
  const [user] = await db.select({ id: schema.users.id, role: schema.users.role, schoolId: schema.users.schoolId })
    .from(schema.users).where(eq(schema.users.id, input.userId)).limit(1)
  if (!user) fail(404, '账号不存在')

  const scopedSchoolId = input.schoolId ?? user.schoolId
  const remaining = (await listUserRoles(db, input.userId, scopedSchoolId))
    .filter(entry => entry.roleCode !== input.roleCode)
  if (!remaining.length) fail(400, '账号在该租户至少需要一个角色')

  const isPrimaryTenant = scopedSchoolId === user.schoolId
  if (isPrimaryTenant && user.role === input.roleCode) {
    const next = input.nextPrimaryRole
    if (!next) fail(400, '移除主角色时必须指定新的主角色')
    if (!remaining.some(entry => entry.roleCode === next)) {
      fail(400, '新的主角色必须包含在账号剩余角色中')
    }
    await db.update(schema.users).set({ role: next, updatedAt: new Date() }).where(eq(schema.users.id, input.userId))
  }

  const conditions = [
    eq(schema.userRoles.userId, input.userId),
    eq(schema.userRoles.roleCode, input.roleCode)
  ]
  if (input.schoolId !== undefined) conditions.push(scopeCondition(schema.userRoles.schoolId, input.schoolId))
  await db.delete(schema.userRoles).where(and(...conditions))
}

/**
 * 找出主角色悬空的账号（主租户下没有 users.role 这一行）。
 * 迁移后自检与测试使用；正常写入路径不会产生这种数据。
 */
export async function findPrimaryRoleMismatches(db: DbClient, limit = 50): Promise<Array<{ userId: string, primaryRole: string }>> {
  const rows = await db.select({ userId: schema.users.id, primaryRole: schema.users.role })
    .from(schema.users)
    .leftJoin(schema.userRoles, and(
      eq(schema.userRoles.userId, schema.users.id),
      eq(schema.userRoles.roleCode, schema.users.role),
      or(
        and(isNull(schema.userRoles.schoolId), isNull(schema.users.schoolId)),
        eq(schema.userRoles.schoolId, schema.users.schoolId)
      )
    ))
    .where(isNull(schema.userRoles.id))
    .limit(limit)
  return rows
}

/**
 * SQL 谓词：目标账号是否持有该角色（以 user_roles 为准，不看主角色）。
 *
 * 用途：替换 `eq(schema.users.role, 'teacher')` 这类「对象侧」单角色过滤。
 * 多角色账号的兼任角色不会体现在 users.role 上，例如同时是班主任与年级主任的
 * 账号主角色可能是 school_admin，用主角色过滤会漏掉这类账号。
 * 语义是「账号主角色是什么」（如平台后台的角色分布统计）时才保留 users.role。
 */
export function userHasRole(db: DbClient, roleCode: AppRole, schoolId?: string | null) {
  const conditions = [
    eq(schema.userRoles.userId, schema.users.id),
    eq(schema.userRoles.roleCode, roleCode)
  ]
  if (schoolId !== undefined) conditions.push(scopeCondition(schema.userRoles.schoolId, schoolId))
  return exists(
    db.select({ one: sql`1` }).from(schema.userRoles).where(and(...conditions))
  )
}

/** SQL 谓词：目标账号是否持有其中任意一个角色（可按租户过滤）。 */
export function userHasAnyRole(db: DbClient, roleCodes: readonly AppRole[], schoolId?: string | null) {
  const conditions = [
    eq(schema.userRoles.userId, schema.users.id),
    inArray(schema.userRoles.roleCode, [...roleCodes])
  ]
  if (schoolId !== undefined) conditions.push(scopeCondition(schema.userRoles.schoolId, schoolId))
  return exists(
    db.select({ one: sql`1` }).from(schema.userRoles).where(and(...conditions))
  )
}

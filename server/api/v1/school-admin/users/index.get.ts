import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability, RoleScope } from '../../../../../shared/management'
import { roleSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'
import { listRolesByUserIds, userHasRole, isSchoolManagedRole } from '../../../../domain/user-roles'

const SORT_WHITELIST = createSortWhitelist('name', 'phone', 'role', 'status', 'selfStatusLevel', 'activatedAt', 'lastLoginAt', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['users'], { allowPlatformAdmin: true })
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const role = roleSchema.or(z.literal('all')).default('all').parse(query.role)
  const status = (['active', 'invited', 'disabled', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  const conditions = [eq(schema.users.schoolId, schoolId)]
  // role 是管理端筛选：语义为「账号持有该角色」（以 user_roles 判定，含兼任角色）
  if (role !== 'all') conditions.push(userHasRole(db, role, schoolId))
  if (status !== 'all') conditions.push(eq(schema.users.status, status))
  if (q) conditions.push(or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.phone, `%${q}%`))!)

  // 动态排序列映射（role 排的是账号主角色 users.role，与上方的持有角色筛选不同）
  const sortColMap: Record<string, any> = {
    name: schema.users.name,
    phone: schema.users.phone,
    role: schema.users.role,
    status: schema.users.status,
    activatedAt: schema.users.activatedAt,
    lastLoginAt: schema.users.lastLoginAt,
    createdAt: schema.users.createdAt,
    updatedAt: schema.users.updatedAt,
  }
  const sortCol = sortColMap[sort] || schema.users.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.users.id,
      // 平台管理员走同一接口时需要在请求里带 schoolId（列表行的操作请求用它拼查询参数）
      schoolId: schema.users.schoolId,
      name: schema.users.name,
      phone: schema.users.phone,
      role: schema.users.role,
      // 上面是账号主角色（展示用）；账号持有的全部角色（含兼任）见 rows[].roles
      status: schema.users.status,
      activatedAt: schema.users.activatedAt,
      lastLoginAt: schema.users.lastLoginAt,
      employeeNo: schema.users.employeeNo,
      gender: schema.users.gender,
      teachingGrades: schema.users.teachingGrades,
      subject: schema.users.subject,
      isClassTeacher: schema.users.isClassTeacher,
      classTeacherYears: schema.users.classTeacherYears,
      title: schema.users.title,
      hiredAt: schema.users.hiredAt,
      /** 自我状态等级（评估回写），管理员修正优先 */
      selfStatusLevel: sql<string | null>`coalesce(${schema.users.overrides}->>'selfStatusLevel', ${schema.users.selfStatusLevel})`,
      /** 管理员修正原始值（编辑表单回显用） */
      overrides: schema.users.overrides,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    }).from(schema.users).where(and(...conditions)).orderBy(orderFn(sortCol))
      .limit(pageSize).offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.users).where(and(...conditions)),
    page,
    pageSize,
  })

  // 账号持有的全部角色（含兼任角色），用于管理端展示；role 仍是主角色
  const rolesByUser = await listRolesByUserIds(db, result.rows.map(row => row.id), schoolId)

  const rows = await Promise.all(result.rows.map(async (row) => {
    const entries = rolesByUser.get(row.id) ?? []
    /** 角色级范围（如年级主任的所辖年级）回显给编辑表单 */
    const roleScopes: Record<string, RoleScope> = {}
    for (const entry of entries) roleScopes[entry.roleCode] = entry.scope
    // 不在本页可维护角色集合内的账号（学校管理员/平台管理员/学部校长）不给写能力：
    // 按钮只反映服务端能力，避免出现点了必然 404 的编辑/停用按钮
    const manageable = entries.some(entry => isSchoolManagedRole(entry.roleCode))
    const capabilities: Capability[] = manageable
      ? await resolveCapabilities({
          user,
          recordSchoolId: schoolId,
          recordStatus: row.status,
          activatedAt: row.activatedAt,
          targetType: 'user',
          targetId: row.id,
        }, event)
      : []
    return {
      ...row,
      roles: entries.map(entry => entry.roleCode),
      roleScopes,
      _capabilities: capabilities
    }
  }))

  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'user', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})

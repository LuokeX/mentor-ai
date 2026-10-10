import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { requireUser } from '../../../../utils/auth'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'
import { listRolesByUserIds, userHasRole } from '../../../../domain/user-roles'

const SORT_WHITELIST = createSortWhitelist('name', 'phone', 'role', 'status', 'activatedAt', 'lastLoginAt', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  // 平台管理员在此页仅管理 school_admin 账户；role 参数只接受 school_admin/all，
  // 传 teacher/psychologist 将被 zod 拒绝（400），避免平台侧看到教师/心理专员账户。
  const role = z.enum(['school_admin', 'all']).default('school_admin').parse(query.role)
  const status = (['active', 'invited', 'disabled', 'all'].includes(query.status as string) ? query.status : 'all') as string
  const schoolId = z.string().uuid().optional().parse(query.schoolId)
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)

  // 本页管理的对象是「持有 school_admin 角色」的账号（以 user_roles 判定，含兼任）
  const conditions = [userHasRole(db, 'school_admin')]
  if (schoolId) conditions.push(eq(schema.users.schoolId, schoolId))
  if (role !== 'all') conditions.push(userHasRole(db, role))
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
      schoolId: schema.users.schoolId,
      schoolName: schema.schools.name,
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
      selfStatusLevel: sql<string | null>`coalesce(${schema.users.overrides}->>'selfStatusLevel', ${schema.users.selfStatusLevel})`,
      overrides: schema.users.overrides,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    }).from(schema.users)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.users.schoolId))
      .where(and(...conditions)).orderBy(orderFn(sortCol))
      .limit(pageSize).offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.users).where(and(...conditions)),
    page,
    pageSize,
  })

  // 账号持有的全部角色（含兼任角色），用于管理端展示；role 仍是主角色
  const rolesByUser = await listRolesByUserIds(db, result.rows.map(row => row.id))

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: row.schoolId,
      recordStatus: row.status,
      activatedAt: row.activatedAt,
      targetType: 'user',
      targetId: row.id,
    }, event)
    return {
      ...row,
      roles: (rolesByUser.get(row.id) ?? []).map(entry => entry.roleCode),
      _capabilities: capabilities
    }
  }))

  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'user', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})
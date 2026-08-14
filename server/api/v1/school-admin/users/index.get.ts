import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { roleSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'phone', 'role', 'status', 'selfStatusLevel', 'activatedAt', 'lastLoginAt', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
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
  if (role !== 'all') conditions.push(eq(schema.users.role, role))
  if (status !== 'all') conditions.push(eq(schema.users.status, status))
  if (q) conditions.push(or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.phone, `%${q}%`))!)

  // 动态排序列映射
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
      name: schema.users.name,
      phone: schema.users.phone,
      role: schema.users.role,
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

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordStatus: row.status,
      activatedAt: row.activatedAt,
      targetType: 'user',
      targetId: row.id,
      delegatedGrantId,
    })
    return { ...row, _capabilities: capabilities }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'disable']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})

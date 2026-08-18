import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { managedRecordStatusSchema } from '../../../../../shared/contracts'
import { countSql, offsetFrom, requireSchoolManagement } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'classId', 'caseLevel', 'learningLevel', 'status', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['students'])
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = managedRecordStatusSchema.or(z.literal('all')).default('all').parse(query.status)
  const classId = (query.classId as string) || 'all'
  const ownerUserId = (query.ownerUserId as string) || 'all'
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const conditions = [eq(schema.students.schoolId, schoolId)]
  if (status !== 'all') conditions.push(eq(schema.students.status, status))
  if (classId === 'none') conditions.push(isNull(schema.students.classId))
  else if (classId !== 'all') conditions.push(eq(schema.students.classId, classId))
  if (ownerUserId !== 'all') conditions.push(eq(schema.students.ownerUserId, ownerUserId))
  if (q) {
    const hash = searchableHash(q, secret)
    conditions.push(or(eq(schema.students.nameSearch, hash), eq(schema.students.externalRefSearch, hash))!)
  }

  const sortCol = sort === 'name' ? schema.students.nameSearch
    : sort === 'classId' ? schema.students.classId
    : sort === 'status' ? schema.students.status
    : sort === 'createdAt' ? schema.students.createdAt
    : schema.students.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.students.id,
      ownerUserId: schema.students.ownerUserId,
      ownerName: schema.users.name,
      classId: schema.students.classId,
      className: schema.classes.name,
      departmentId: schema.classes.departmentId,
      departmentName: schema.departments.name,
      nameEnc: schema.students.nameEnc,
      gender: schema.students.gender,
      birthDate: schema.students.birthDate,
      ethnicity: schema.students.ethnicity,
      enrolledAt: schema.students.enrolledAt,
      boardingType: schema.students.boardingType,
      /** 个体支持/学习问题等级（评估回写），管理员修正优先 */
      caseLevel: sql<string | null>`coalesce(${schema.students.overrides}->>'caseLevel', ${schema.students.caseLevel})`,
      learningLevel: sql<string | null>`coalesce(${schema.students.overrides}->>'learningLevel', ${schema.students.learningLevel})`,
      /** 管理员修正原始值（编辑表单回显用） */
      overrides: schema.students.overrides,
      status: schema.students.status,
      createdAt: schema.students.createdAt,
      updatedAt: schema.students.updatedAt,
    })
      .from(schema.students)
      .innerJoin(schema.users, and(eq(schema.users.id, schema.students.ownerUserId), eq(schema.users.schoolId, schoolId)))
      .leftJoin(schema.classes, and(eq(schema.classes.id, schema.students.classId), eq(schema.classes.schoolId, schoolId)))
      .leftJoin(schema.departments, and(eq(schema.departments.id, schema.classes.departmentId), eq(schema.departments.schoolId, schoolId)))
      .where(and(...conditions))
      .orderBy(orderFn(sortCol))
      .limit(pageSize)
      .offset(offsetFrom(page, pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.students).where(and(...conditions)),
    page,
    pageSize,
  })

  // 解密敏感字段 + 注入能力
  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordOwnerUserId: row.ownerUserId,
      recordStatus: row.status,
      targetType: 'student',
      targetId: row.id,
    }, event)
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      classId: row.classId,
      className: row.className,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      name: decryptSensitive(row.nameEnc, secret),
      gender: row.gender,
      birthDate: row.birthDate,
      ethnicity: row.ethnicity,
      enrolledAt: row.enrolledAt,
      boardingType: row.boardingType,
      caseLevel: row.caseLevel,
      learningLevel: row.learningLevel,
      overrides: row.overrides,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      _capabilities: capabilities,
    }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'archive', 'restore', 'transfer']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})

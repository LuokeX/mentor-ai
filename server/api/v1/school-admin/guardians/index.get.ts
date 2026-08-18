import { and, asc, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { managedRecordStatusSchema } from '../../../../../shared/contracts'
import { countSql, offsetFrom, requireSchoolManagement } from '../../../../domain/school-management'
import { resolveCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

const SORT_WHITELIST = createSortWhitelist('name', 'relation', 'commRiskLevel', 'status', 'updatedAt', 'createdAt')

export default defineEventHandler(async (event) => {
  const { schoolId, actor: user } = await requireSchoolManagement(event, ['guardians'])
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = ([20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE) as 20 | 50 | 100
  const q = (query.q as string)?.trim().slice(0, 120) || ''
  const status = managedRecordStatusSchema.or(z.literal('all')).default('all').parse(query.status)
  const ownerUserId = (query.ownerUserId as string) || 'all'
  const sort = validateSort((query.sort as string) || 'updatedAt', SORT_WHITELIST, 'updatedAt')
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const conditions = [eq(schema.guardians.schoolId, schoolId)]
  if (status !== 'all') conditions.push(eq(schema.guardians.status, status))
  if (ownerUserId !== 'all') conditions.push(eq(schema.guardians.ownerUserId, ownerUserId))
  if (q) {
    const hash = searchableHash(q, secret)
    conditions.push(or(eq(schema.guardians.nameSearch, hash), eq(schema.guardians.externalRefSearch, hash))!)
  }

  const sortCol = sort === 'name' ? schema.guardians.nameSearch
    : sort === 'relation' ? schema.guardians.relation
    : sort === 'status' ? schema.guardians.status
    : sort === 'createdAt' ? schema.guardians.createdAt
    : schema.guardians.updatedAt
  const orderFn = order === 'asc' ? asc : desc

  // 并行：数据查询、计数、关系、关联学生
  const [result, relations, studentsRaw] = await Promise.all([
    paginateResult({
      dataQuery: db.select({
        id: schema.guardians.id,
        ownerUserId: schema.guardians.ownerUserId,
        ownerName: schema.users.name,
        nameEnc: schema.guardians.nameEnc,
        phoneEnc: schema.guardians.phoneEnc,
        relation: schema.guardians.relation,
        occupation: schema.guardians.occupation,
        workUnit: schema.guardians.workUnit,
        isPrimary: schema.guardians.isPrimary,
        /** 沟通风险等级（评估回写），管理员修正优先 */
        commRiskLevel: sql<string | null>`coalesce(${schema.guardians.overrides}->>'commRiskLevel', ${schema.guardians.commRiskLevel})`,
        /** 管理员修正原始值（编辑表单回显用） */
        overrides: schema.guardians.overrides,
        status: schema.guardians.status,
        createdAt: schema.guardians.createdAt,
        updatedAt: schema.guardians.updatedAt,
      })
        .from(schema.guardians)
        .innerJoin(schema.users, and(eq(schema.users.id, schema.guardians.ownerUserId), eq(schema.users.schoolId, schoolId)))
        .where(and(...conditions))
        .orderBy(orderFn(sortCol))
        .limit(pageSize)
        .offset(offsetFrom(page, pageSize)),
      countQuery: db.select({ value: countSql }).from(schema.guardians).where(and(...conditions)),
      page,
      pageSize,
    }),
    db.select().from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.schoolId, schoolId),
      eq(schema.studentGuardians.status, 'active'),
    )),
    db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc, classId: schema.students.classId })
      .from(schema.students).where(eq(schema.students.schoolId, schoolId)),
  ])

  const studentById = new Map(studentsRaw.map(s => [s.id, s]))

  // 解密 + 关联学生 + 注入能力
  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: schoolId,
      recordOwnerUserId: row.ownerUserId,
      recordStatus: row.status,
      targetType: 'guardian',
      targetId: row.id,
    }, event)
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      name: decryptSensitive(row.nameEnc, secret),
      phoneMasked: (() => {
        const phone = decryptSensitive(row.phoneEnc, secret)
        return phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null
      })(),
      relation: row.relation,
      occupation: row.occupation,
      workUnit: row.workUnit,
      isPrimary: row.isPrimary,
      commRiskLevel: row.commRiskLevel,
      overrides: row.overrides,
      status: row.status,
      linkedStudents: relations
        .filter(r => r.guardianId === row.id)
        .map(r => studentById.get(r.studentId))
        .filter(Boolean)
        .map(s => ({
          id: s!.id,
          name: decryptSensitive(s!.nameEnc, secret),
          classId: s!.classId,
        })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      _capabilities: capabilities,
    }
  }))

  const pageCapabilities: Capability[] = ['view', 'create', 'edit', 'archive', 'restore', 'transfer']

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof rows[number]>
})

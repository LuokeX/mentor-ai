/**
 * 教师端班级列表 API（管理框架示例）
 *
 * 返回分页列表、每条记录的能力标记、页面级能力。
 * 教师只能看到自己负责的班级。
 */
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'

const SORT_WHITELIST = createSortWhitelist('name', 'grade', 'studentCount', 'status', 'updatedAt', 'createdAt')

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'graduated', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })

  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [
    eq(schema.classes.schoolId, user.schoolId),
    eq(schema.classes.ownerUserId, user.id),
  ]
  if (query.status !== 'all') conditions.push(eq(schema.classes.status, query.status))
  if (query.q) {
    conditions.push(or(ilike(schema.classes.name, `%${query.q}%`))!)
  }

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'name' ? schema.classes.name
    : validSort === 'grade' ? schema.classes.grade
    : validSort === 'studentCount' ? schema.classes.studentCount
    : validSort === 'status' ? schema.classes.status
    : validSort === 'createdAt' ? schema.classes.createdAt
    : schema.classes.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade,
      studentCount: schema.classes.studentCount, status: schema.classes.status,
      externalCode: schema.classes.externalCode, departmentId: schema.classes.departmentId,
      ownerUserId: schema.classes.ownerUserId, schoolId: schema.classes.schoolId,
      /** 四阶当前阶段（评估快照回写）：秩序奠基期/关系激活期/制度自转期/文化生成期 */
      energyStage: schema.classes.energyStage,
      createdAt: schema.classes.createdAt, updatedAt: schema.classes.updatedAt,
    }).from(schema.classes).where(and(...conditions)).orderBy(orderFn(sortCol))
      .limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.classes).where(and(...conditions)),
    page: query.page,
    pageSize: query.pageSize,
  })

  // 为每行注入能力
  const classIds = result.rows.map(row => row.id)
  // 最薄弱系统：取每班最近一次评估快照的 primaryAttribution（全量快照只在详情页下发，列表只投影薄弱系统）
  const snapshotRows = classIds.length
    ? await db.select({
        classId: schema.classes.id,
        snapshot: schema.classes.classSnapshot,
      }).from(schema.classes).where(and(
        eq(schema.classes.schoolId, user.schoolId),
        inArray(schema.classes.id, classIds),
      ))
    : []
  const weakestByClass = new Map<string, string | null>()
  for (const row of snapshotRows) {
    // 与详情页口径一致：优先取最低分维度 label，旧快照回退到核心归因（字符串直接使用）
    const snapshot = row.snapshot as {
      primaryAttribution?: string | { name?: string }
      weakestDimension?: { code: string, label: string, score: number }
    } | null
    const weakestSystem = snapshot?.weakestDimension?.label
      || (typeof snapshot?.primaryAttribution === 'string' ? snapshot.primaryAttribution : snapshot?.primaryAttribution?.name)
      || null
    weakestByClass.set(row.classId, weakestSystem)
  }
  // 男女比例：按班级统计学生性别，未分配到任何班级的学生不计入
  const genderStats = classIds.length
    ? await db.select({
        classId: schema.students.classId,
        gender: schema.students.gender,
        count: countSql,
      }).from(schema.students)
        .where(and(
          eq(schema.students.schoolId, user.schoolId),
          eq(schema.students.status, 'active'),
          inArray(schema.students.classId, classIds),
        ))
        .groupBy(schema.students.classId, schema.students.gender)
    : []
  const genderByClass = new Map<string, { male: number, female: number, unknown: number }>()
  for (const row of genderStats) {
    if (!row.classId) continue
    const entry = genderByClass.get(row.classId) || { male: 0, female: 0, unknown: 0 }
    if (row.gender === '男') entry.male += Number(row.count)
    else if (row.gender === '女') entry.female += Number(row.count)
    else entry.unknown += Number(row.count)
    genderByClass.set(row.classId, entry)
  }

  const rows = await Promise.all(result.rows.map(async (row) => {
    const capabilities: Capability[] = await resolveCapabilities({
      user,
      recordSchoolId: row.schoolId,
      recordOwnerUserId: row.ownerUserId,
      recordStatus: row.status,
      targetType: 'class',
      targetId: row.id,
    }, event)
    const gender = genderByClass.get(row.id) || { male: 0, female: 0, unknown: 0 }
    return {
      ...row,
      /** 男女比例（按在册学生实时统计） */
      genderRatio: { male: gender.male, female: gender.female, unknown: gender.unknown },
      /** 最薄弱系统维度（评估快照 primaryAttribution） */
      weakestSystem: weakestByClass.get(row.id) || null,
      _capabilities: capabilities,
    }
  }))

  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'class', event)

  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<typeof result.rows[number]>
})

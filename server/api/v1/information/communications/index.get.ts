/**
 * 教师端沟通记录列表 API
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { createSortWhitelist, validateSort, DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { ManagedListResult, Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolveCapabilities, resolvePageCapabilities } from '../../../../domain/capabilities'
import { paginateResult } from '../../../../utils/pagination'
import { decryptSensitive } from '../../../../utils/crypto'
import { canonicalCommunicationRiskLevel } from '../../../../../shared/dashboard'

const SORT_WHITELIST = createSortWhitelist('riskLevel', 'parentType', 'occurredAt', 'status', 'updatedAt', 'createdAt')
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((v) => [20, 50, 100].includes(v)).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived', 'all']).default('all'),
  riskLevel: z.enum(['crisis', 'high', 'medium', 'low', 'all']).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.communications.schoolId, user.schoolId), eq(schema.communications.ownerUserId, user.id)]
  if (query.status !== 'all') conditions.push(eq(schema.communications.status, query.status))
  if (query.riskLevel !== 'all') {
    const riskValues: Record<string, string[]> = {
      crisis: ['crisis', '安全关注'],
      high: ['high', '高', '高风险'],
      medium: ['medium', '中', '中风险'],
      low: ['low', '低', '低风险', '无', 'D', 'd']
    }
    conditions.push(inArray(schema.communications.riskLevel, riskValues[query.riskLevel] ?? []))
  }

  const validSort = validateSort(query.sort, SORT_WHITELIST, 'updatedAt')
  const sortCol = validSort === 'riskLevel' ? schema.communications.riskLevel
    : validSort === 'parentType' ? schema.communications.parentType
    : validSort === 'occurredAt' ? schema.communications.occurredAt
    : validSort === 'status' ? schema.communications.status
    : validSort === 'createdAt' ? schema.communications.createdAt : schema.communications.updatedAt
  const orderFn = query.order === 'asc' ? asc : desc

  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.communications.id,
      summaryEnc: schema.communications.summaryEnc,
      channel: schema.communications.channel,
      parentType: schema.communications.parentType,
      riskLevel: schema.communications.riskLevel,
      attitudeType: schema.communications.attitudeType,
      status: schema.communications.status,
      occurredAt: schema.communications.occurredAt,
      guardianId: schema.communications.guardianId,
      studentId: schema.communications.studentId,
      ownerUserId: schema.communications.ownerUserId,
      schoolId: schema.communications.schoolId,
      createdAt: schema.communications.createdAt,
      updatedAt: schema.communications.updatedAt,
    }).from(schema.communications).where(and(...conditions)).orderBy(orderFn(sortCol)).limit(query.pageSize).offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.communications).where(and(...conditions)),
    page: query.page, pageSize: query.pageSize,
  })
  const secret = useRuntimeConfig(event).encryptionKey
  // 关联学生 / 关联家长（主对象之外的其余对象）：按本页记录 id 批量取一次，避免逐行查询
  const recordIds = result.rows.map(row => row.id)
  const relatedStudentsByRecord = new Map<string, string[]>()
  const relatedGuardiansByRecord = new Map<string, string[]>()
  if (recordIds.length) {
    const [relatedStudentRows, relatedGuardianRows] = await Promise.all([
      db.select({
        communicationId: schema.communicationStudents.communicationId,
        nameEnc: schema.students.nameEnc
      }).from(schema.communicationStudents)
        .innerJoin(schema.students, and(
          eq(schema.students.id, schema.communicationStudents.studentId),
          eq(schema.students.schoolId, user.schoolId)
        ))
        .where(and(
          inArray(schema.communicationStudents.communicationId, recordIds),
          eq(schema.communicationStudents.schoolId, user.schoolId)
        )),
      db.select({
        communicationId: schema.communicationGuardians.communicationId,
        nameEnc: schema.guardians.nameEnc
      }).from(schema.communicationGuardians)
        .innerJoin(schema.guardians, and(
          eq(schema.guardians.id, schema.communicationGuardians.guardianId),
          eq(schema.guardians.schoolId, user.schoolId)
        ))
        .where(and(
          eq(schema.communicationGuardians.schoolId, user.schoolId),
          inArray(schema.communicationGuardians.communicationId, recordIds)
        ))
    ])
    for (const item of relatedStudentRows) {
      const list = relatedStudentsByRecord.get(item.communicationId) || []
      list.push(decryptSensitive(item.nameEnc, secret))
      relatedStudentsByRecord.set(item.communicationId, list)
    }
    for (const item of relatedGuardianRows) {
      const list = relatedGuardiansByRecord.get(item.communicationId) || []
      list.push(decryptSensitive(item.nameEnc, secret))
      relatedGuardiansByRecord.set(item.communicationId, list)
    }
  }
  // 主对象姓名：按主列 id 批量查一次（主列可能为空）
  const primaryStudentIds = [...new Set(result.rows.map(row => row.studentId).filter(Boolean))] as string[]
  const primaryGuardianIds = [...new Set(result.rows.map(row => row.guardianId).filter(Boolean))] as string[]
  const [primaryStudents, primaryGuardians] = await Promise.all([
    primaryStudentIds.length
      ? db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc }).from(schema.students)
        .where(and(eq(schema.students.schoolId, user.schoolId), inArray(schema.students.id, primaryStudentIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string }>),
    primaryGuardianIds.length
      ? db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc }).from(schema.guardians)
        .where(and(eq(schema.guardians.schoolId, user.schoolId), inArray(schema.guardians.id, primaryGuardianIds)))
      : Promise.resolve([] as Array<{ id: string, nameEnc: string }>)
  ])
  const studentNameById = new Map(primaryStudents.map(row => [row.id, decryptSensitive(row.nameEnc, secret)]))
  const guardianNameById = new Map(primaryGuardians.map(row => [row.id, decryptSensitive(row.nameEnc, secret)]))
  const rows = await Promise.all(result.rows.map(async (row) => {
    const { summaryEnc, ...safeRow } = row
    const summary = decryptSensitive(summaryEnc, secret)
    const primaryStudentName = row.studentId ? studentNameById.get(row.studentId) || null : null
    const primaryGuardianName = row.guardianId ? guardianNameById.get(row.guardianId) || null : null
    return {
      ...safeRow,
      riskLevel: canonicalCommunicationRiskLevel(safeRow.riskLevel) ?? safeRow.riskLevel,
      summaryPreview: summary.length > 80 ? `${summary.slice(0, 80)}…` : summary,
      studentName: primaryStudentName,
      guardianName: primaryGuardianName,
      // 主对象在前：界面直接展示这两列（超过 2 人时前端折叠为「张三 等 N 人」）
      studentNames: primaryStudentName
        ? [primaryStudentName, ...(relatedStudentsByRecord.get(row.id) || [])]
        : (relatedStudentsByRecord.get(row.id) || []),
      guardianNames: primaryGuardianName
        ? [primaryGuardianName, ...(relatedGuardiansByRecord.get(row.id) || [])]
        : (relatedGuardiansByRecord.get(row.id) || []),
      _capabilities: await resolveCapabilities({ user, recordSchoolId: row.schoolId, recordOwnerUserId: row.ownerUserId, recordStatus: row.status, targetType: 'communication', targetId: row.id }, event),
    }
  }))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'communication', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})

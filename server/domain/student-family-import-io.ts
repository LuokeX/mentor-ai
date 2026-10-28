import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { encryptSensitive, decryptSensitive, searchableHash } from '../utils/crypto'
import { schema, useDb, type DbTx } from '../utils/db'
import { writeAudit } from '../utils/audit'
import { transferPlans, writeAssignment } from './school-management'
import { markSchoolImportCommitted, type BusinessImportScope } from './information-import-io'
import type { ImportRowError } from './information-imports'
import {
  mergeStudentExtra,
  mergeStudentProfile,
  parseStudentFamilyWorkbook,
  StudentFamilyParseError,
  validateStudentFamilyRows,
  type StudentFamilyGuardianPlan,
  type StudentFamilyParseResult,
  type StudentFamilyResolvedRow,
  type StudentFamilyStats,
  type StudentFamilyValidateDeps,
} from './student-family-imports'
import type { StudentFamilySection } from './student-family-templates'

/**
 * 学生+家长合表导入的查库与写入层（依赖 h3 / 数据库，不参与纯单元测试）。
 * 解析与校验逻辑在 student-family-imports.ts。
 */

const PARSE_MESSAGES: Record<string, string> = {
  EMPTY_FILE: '文件为空',
  FILE_TOO_LARGE: '文件不能超过 2 MB',
  TOO_MANY_ROWS: '单个文件不能超过 2,000 行',
  INVALID_XLSX: '文件编码或格式不正确，请使用提供的 Excel 模板',
  NO_DATA_SHEET: '文件中没有可解析的数据表（请使用提供的 Excel 模板）',
}

/** 解析合表文件；结构错误与带列号的表头错误统一映射为 422。 */
export function parseStudentFamilyWorkbookOrThrow(
  event: H3Event,
  contentBase64: string,
  expectedSection?: StudentFamilySection
): StudentFamilyParseResult {
  try {
    return parseStudentFamilyWorkbook(contentBase64, expectedSection)
  } catch (error) {
    if (error instanceof StudentFamilyParseError) {
      const detail = error.detail
        ? `（第 ${error.detail.index} 列：期望「${error.detail.expected}」，实际「${error.detail.actual}」）`
        : ''
      throw createError({ statusCode: 422, message: `${error.message}${detail}` })
    }
    const code = error instanceof Error ? error.message : 'INVALID_XLSX'
    throw createError({ statusCode: 422, message: PARSE_MESSAGES[code] || '文件编码或格式不正确' })
  }
}

/** 加载合表校验所需的全校数据；教师/管理员只影响写权限，匹配仍看全校标识避免重复建档。 */
export async function loadStudentFamilyDeps(
  event: H3Event,
  input: { schoolId: string, scope: BusinessImportScope, now?: Date }
): Promise<StudentFamilyValidateDeps> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [classes, students, guardians, links] = await Promise.all([
    db.select({
      id: schema.classes.id,
      name: schema.classes.name,
      grade: schema.classes.grade,
      section: schema.classes.section,
      ownerUserId: schema.classes.ownerUserId,
      status: schema.classes.status,
    }).from(schema.classes).where(and(
      eq(schema.classes.schoolId, input.schoolId),
      eq(schema.classes.status, 'active'),
    )).orderBy(schema.classes.name),
    db.select({
      id: schema.students.id,
      classId: schema.students.classId,
      ownerUserId: schema.students.ownerUserId,
      nameSearch: schema.students.nameSearch,
      studentNoSearch: schema.students.studentNoSearch,
      idCardSearch: schema.students.idCardSearch,
      status: schema.students.status,
    }).from(schema.students).where(eq(schema.students.schoolId, input.schoolId)),
    db.select({
      id: schema.guardians.id,
      nameSearch: schema.guardians.nameSearch,
      idCardSearch: schema.guardians.idCardSearch,
      relation: schema.guardians.relation,
      ownerUserId: schema.guardians.ownerUserId,
      status: schema.guardians.status,
    }).from(schema.guardians).where(eq(schema.guardians.schoolId, input.schoolId)),
    db.select({
      studentId: schema.studentGuardians.studentId,
      guardianId: schema.studentGuardians.guardianId,
      relation: schema.studentGuardians.relation,
      status: schema.studentGuardians.status,
    }).from(schema.studentGuardians).where(eq(schema.studentGuardians.schoolId, input.schoolId)),
  ])
  return {
    classes,
    students,
    guardians,
    links,
    scope: input.scope.kind,
    userId: input.scope.kind === 'teacher' ? input.scope.userId : '',
    secret,
    now: input.now,
  }
}

export interface StudentFamilyPreview {
  checksum: string
  section: StudentFamilySection
  totalRows: number
  validRows: number
  errors: ImportRowError[]
  sample: Array<Record<string, string>>
  stats: StudentFamilyStats
}

/** 合表预检：示例只投影学生/班级/家长姓名与关系，不回显身份证、电话、地址。 */
export async function previewStudentFamilyImport(
  event: H3Event,
  input: {
    schoolId: string
    scope: BusinessImportScope
    parsed: StudentFamilyParseResult
    now?: Date
  }
): Promise<StudentFamilyPreview> {
  const deps = await loadStudentFamilyDeps(event, { schoolId: input.schoolId, scope: input.scope, now: input.now })
  const result = validateStudentFamilyRows(input.parsed.rows, deps)
  const classById = new Map(deps.classes.map(item => [item.id, item.name]))
  const planByKey = new Map(result.guardianPlans.map(item => [item.key, item]))
  return {
    checksum: input.parsed.checksum,
    section: input.parsed.section,
    totalRows: input.parsed.rows.length,
    validRows: result.resolved.length,
    errors: result.errors,
    sample: result.resolved.slice(0, 5).map(item => ({
      row: String(item.rowNumber),
      studentName: item.values.name,
      className: classById.get(item.classId) || '',
      guardians: item.guardianLinks
        .map(link => {
          const plan = planByKey.get(link.planKey)
          return plan ? `${plan.name}（${link.relation}）` : ''
        })
        .filter(Boolean)
        .join('、'),
      action: item.mode === 'create' ? '新建' : '更新',
    })),
    stats: result.stats,
  }
}

export interface StudentFamilyCommitResult {
  ok: boolean
  totalRows: number
  studentsCreated: number
  studentsUpdated: number
  guardiansCreated: number
  guardiansReused: number
  linksCreated: number
  linksReactivated: number
  skipped: number
}

const EMPTY_COMMIT_RESULT: StudentFamilyCommitResult = {
  ok: false,
  totalRows: 0,
  studentsCreated: 0,
  studentsUpdated: 0,
  guardiansCreated: 0,
  guardiansReused: 0,
  linksCreated: 0,
  linksReactivated: 0,
  skipped: 0,
}

/** 合表提交：任一校验错误整批不写；学生/家长/关联在同一事务内完成。 */
export async function commitStudentFamilyImport(
  event: H3Event,
  input: {
    schoolId: string
    actorId: string
    scope: BusinessImportScope
    contentBase64: string
    expectedSection?: StudentFamilySection
    /** 学校管理员端传入预检记录 id：同一事务内把 school_imports 置为已提交 */
    previewId?: string
    now?: Date
  }
): Promise<StudentFamilyCommitResult> {
  const db = useDb(event)
  const parsed = parseStudentFamilyWorkbook(input.contentBase64, input.expectedSection)
  const deps = await loadStudentFamilyDeps(event, { schoolId: input.schoolId, scope: input.scope, now: input.now })
  const result = validateStudentFamilyRows(parsed.rows, deps)
  if (result.errors.length) {
    return { ...EMPTY_COMMIT_RESULT, totalRows: parsed.rows.length }
  }

  const secret = deps.secret
  const importedAt = (input.now ?? new Date()).toISOString()
  let studentsCreated = 0
  let studentsUpdated = 0
  let guardiansCreated = 0
  let guardiansReused = 0
  const guardianIdByKey = new Map<string, string>()
  const studentIds: string[] = []

  await db.transaction(async (tx) => {
    await upsertGuardians(tx, {
      schoolId: input.schoolId,
      secret,
      plans: result.guardianPlans,
      guardianIdByKey,
      onCreated: () => { guardiansCreated++ },
      onReused: () => { guardiansReused++ },
    })

    for (const row of result.resolved) {
      const studentId = row.mode === 'create'
        ? await insertStudent(tx, { schoolId: input.schoolId, secret, section: parsed.section, importedAt, row })
        : await updateStudent(tx, { schoolId: input.schoolId, actorId: input.actorId, secret, section: parsed.section, importedAt, row })
      if (row.mode === 'create') studentsCreated++
      else studentsUpdated++
      studentIds.push(studentId)

      for (const link of row.guardianLinks) {
        const guardianId = guardianIdByKey.get(link.planKey)
        if (!guardianId) throw new Error('GUARDIAN_PLAN_MISSING')
        await tx.insert(schema.studentGuardians).values({
          studentId,
          guardianId,
          schoolId: input.schoolId,
          relation: link.relation,
          status: 'active',
        }).onConflictDoUpdate({
          target: [schema.studentGuardians.studentId, schema.studentGuardians.guardianId],
          set: { relation: link.relation, status: 'active' },
        })
      }
    }

    if (input.previewId) {
      await markSchoolImportCommitted(tx, {
        previewId: input.previewId,
        schoolId: input.schoolId,
        checksum: parsed.checksum,
        created: studentsCreated,
        updated: studentsUpdated,
        skipped: 0,
      })
    }
  })

  const metadata = {
    type: 'student_family',
    section: parsed.section,
    totalRows: parsed.rows.length,
    studentsCreated,
    studentsUpdated,
    guardiansCreated,
    guardiansReused,
    linksCreated: result.stats.linksToCreate,
    linksReactivated: result.stats.linksToReactivate,
  }
  if (input.previewId) {
    await writeAudit(event, {
      schoolId: input.schoolId,
      actorId: input.actorId,
      action: 'school_admin.import.commit',
      targetType: 'school_import',
      targetId: input.previewId,
      metadata,
    })
  } else {
    await writeAudit(event, {
      schoolId: input.schoolId,
      actorId: input.actorId,
      action: 'information.student_family.import',
      targetType: 'student',
      targetId: studentIds[0],
      metadata,
    })
  }

  return {
    ok: true,
    totalRows: parsed.rows.length,
    studentsCreated,
    studentsUpdated,
    guardiansCreated,
    guardiansReused,
    linksCreated: result.stats.linksToCreate,
    linksReactivated: result.stats.linksToReactivate,
    skipped: 0,
  }
}

async function upsertGuardians(tx: DbTx, input: {
  schoolId: string
  secret: string
  plans: readonly StudentFamilyGuardianPlan[]
  guardianIdByKey: Map<string, string>
  onCreated: () => void
  onReused: () => void
}) {
  const reusedIds = [...new Set(input.plans.map(item => item.existingGuardianId).filter((id): id is string => Boolean(id)))]
  const existing = reusedIds.length
    ? await tx.select({
      id: schema.guardians.id,
      phoneEnc: schema.guardians.phoneEnc,
      occupation: schema.guardians.occupation,
      workUnit: schema.guardians.workUnit,
      relation: schema.guardians.relation,
    }).from(schema.guardians).where(inArray(schema.guardians.id, reusedIds))
    : []
  const existingById = new Map(existing.map(item => [item.id, item]))

  for (const plan of input.plans) {
    if (plan.existingGuardianId) {
      input.guardianIdByKey.set(plan.key, plan.existingGuardianId)
      input.onReused()
      const current = existingById.get(plan.existingGuardianId)
      if (!current) continue
      const patch: Partial<typeof schema.guardians.$inferInsert> = { updatedAt: new Date() }
      let changed = false
      if (!current.phoneEnc && plan.phone) {
        patch.phoneEnc = encryptSensitive(plan.phone, input.secret)
        changed = true
      }
      if (!current.occupation && plan.occupation) {
        patch.occupation = plan.occupation
        changed = true
      }
      if (!current.workUnit && plan.workUnit) {
        patch.workUnit = plan.workUnit
        changed = true
      }
      if (!current.relation && plan.relation) {
        patch.relation = plan.relation
        changed = true
      }
      if (changed) {
        await tx.update(schema.guardians).set(patch).where(and(
          eq(schema.guardians.id, plan.existingGuardianId),
          eq(schema.guardians.schoolId, input.schoolId),
        ))
      }
      continue
    }

    const [guardian] = await tx.insert(schema.guardians).values({
      schoolId: input.schoolId,
      ownerUserId: plan.ownerUserId,
      nameEnc: encryptSensitive(plan.name, input.secret),
      nameSearch: searchableHash(plan.name, input.secret),
      phoneEnc: plan.phone ? encryptSensitive(plan.phone, input.secret) : null,
      relation: plan.relation,
      occupation: plan.occupation || null,
      workUnit: plan.workUnit || null,
      idCardEnc: plan.idCard ? encryptSensitive(plan.idCard, input.secret) : null,
      idCardSearch: plan.idCard ? searchableHash(plan.idCard, input.secret) : null,
    }).returning({ id: schema.guardians.id })
    if (!guardian) throw new Error('GUARDIAN_INSERT_FAILED')
    input.guardianIdByKey.set(plan.key, guardian.id)
    input.onCreated()
  }
}

async function insertStudent(tx: DbTx, input: {
  schoolId: string
  secret: string
  section: StudentFamilySection
  importedAt: string
  row: StudentFamilyResolvedRow
}): Promise<string> {
  const { row, secret } = input
  const [student] = await tx.insert(schema.students).values({
    schoolId: input.schoolId,
    ownerUserId: row.ownerUserId,
    classId: row.classId,
    nameEnc: encryptSensitive(row.values.name, secret),
    nameSearch: searchableHash(row.values.name, secret),
    gender: row.values.gender || null,
    ethnicity: row.values.ethnicity || null,
    birthDate: row.values.birthDate,
    enrolledAt: row.values.enrolledAt,
    boardingType: row.values.boardingType,
    addressEnc: row.values.address ? encryptSensitive(row.values.address, secret) : null,
    studentNoEnc: row.values.studentNo ? encryptSensitive(row.values.studentNo, secret) : null,
    studentNoSearch: row.values.studentNo ? searchableHash(row.values.studentNo, secret) : null,
    idCardEnc: row.values.idCard ? encryptSensitive(row.values.idCard, secret) : null,
    idCardSearch: row.values.idCard ? searchableHash(row.values.idCard, secret) : null,
    profileEnc: Object.keys(row.values.profile).length ? encryptSensitive(JSON.stringify(row.values.profile), secret) : null,
    extraEnc: Object.keys(row.values.extra).length
      ? encryptSensitive(JSON.stringify(mergeStudentExtra(null, input.section, row.values.extra, input.importedAt)), secret)
      : null,
  }).returning({ id: schema.students.id })
  if (!student) throw new Error('STUDENT_INSERT_FAILED')
  return student.id
}

async function updateStudent(tx: DbTx, input: {
  schoolId: string
  actorId: string
  secret: string
  section: StudentFamilySection
  importedAt: string
  row: StudentFamilyResolvedRow
}): Promise<string> {
  const { row, secret } = input
  const [existing] = await tx.select().from(schema.students).where(and(
    eq(schema.students.id, row.existingStudentId!),
    eq(schema.students.schoolId, input.schoolId),
  )).limit(1)
  if (!existing) throw new Error('STUDENT_NOT_FOUND')

  const patch: Partial<typeof schema.students.$inferInsert> = {
    updatedAt: new Date(),
    nameEnc: encryptSensitive(row.values.name, secret),
    nameSearch: searchableHash(row.values.name, secret),
  }
  if (row.values.gender) patch.gender = row.values.gender
  if (row.values.ethnicity) patch.ethnicity = row.values.ethnicity
  if (row.values.birthDate) patch.birthDate = row.values.birthDate
  if (row.values.enrolledAt) patch.enrolledAt = row.values.enrolledAt
  if (row.values.boardingType) patch.boardingType = row.values.boardingType
  if (row.values.address) patch.addressEnc = encryptSensitive(row.values.address, secret)
  if (row.values.studentNo) {
    patch.studentNoEnc = encryptSensitive(row.values.studentNo, secret)
    patch.studentNoSearch = searchableHash(row.values.studentNo, secret)
  }
  if (row.values.idCard) {
    patch.idCardEnc = encryptSensitive(row.values.idCard, secret)
    patch.idCardSearch = searchableHash(row.values.idCard, secret)
  }
  if (Object.keys(row.values.profile).length) {
    const existingProfile = parseJson(existing.profileEnc ? decryptSensitive(existing.profileEnc, secret) : null)
    patch.profileEnc = encryptSensitive(JSON.stringify(mergeStudentProfile(existingProfile, row.values.profile)), secret)
  }
  if (Object.keys(row.values.extra).length) {
    const existingExtra = parseJson(existing.extraEnc ? decryptSensitive(existing.extraEnc, secret) : null)
    patch.extraEnc = encryptSensitive(
      JSON.stringify(mergeStudentExtra(existingExtra, input.section, row.values.extra, input.importedAt)),
      secret
    )
  }
  if (existing.classId !== row.classId) patch.classId = row.classId
  if (existing.ownerUserId !== row.ownerUserId) patch.ownerUserId = row.ownerUserId

  await tx.update(schema.students).set(patch).where(and(
    eq(schema.students.id, existing.id),
    eq(schema.students.schoolId, input.schoolId),
  ))

  if (existing.ownerUserId !== row.ownerUserId) {
    await tx.update(schema.communications).set({
      ownerUserId: row.ownerUserId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.communications.studentId, existing.id),
      eq(schema.communications.schoolId, input.schoolId),
    ))
    await transferPlans(tx as ReturnType<typeof useDb>, input.schoolId, row.ownerUserId, eq(schema.plans.studentId, existing.id))
    await writeAssignment(tx as ReturnType<typeof useDb>, {
      schoolId: input.schoolId,
      targetType: 'student',
      targetId: existing.id,
      fromUserId: existing.ownerUserId,
      toUserId: row.ownerUserId,
      assignedBy: input.actorId,
      reason: '批量导入调整班级',
      metadata: { importType: 'student_family' },
    })
  }
  return existing.id
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

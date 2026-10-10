import type { H3Event } from 'h3'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { encryptSensitive, searchableHash } from '../utils/crypto'
import { schema, useDb, type DbTx } from '../utils/db'
import { writeAudit } from '../utils/audit'
import {
  buildCommunicationImportSample,
  buildStudentEventImportSample,
  parseWorkbookRows,
  validateCommunicationRows,
  validateGuardianRows,
  validateStudentEventRows,
  validateStudentRows,
  type BusinessImportDeps,
  type BusinessImportResolvedRow,
  type BusinessImportType,
  type CommunicationImportRowValues,
  type GuardianValidateDeps,
  type ImportRowError,
  type InformationImportType,
  type StudentEventImportRowValues,
  type StudentValidateDeps,
} from './information-imports'

/**
 * 信息中心批量导入的查库与写入层（依赖 h3 / 数据库，不参与单元测试）。
 * 解析与校验逻辑见 information-imports.ts。
 */

export type CommitResult = {
  ok: boolean
  totalRows: number
  created: number
  skipped: number
}

/**
 * 导入范围：教师端 = 本人负责的学生；学校管理员导入管理 = 本校在册学生。
 * 记录归属一律取学生当前的负责教师（教师端与本人一致，管理员端由校验结果带出）。
 */
export type BusinessImportScope = { kind: 'teacher', userId: string } | { kind: 'school' }

const BUSINESS_SCOPE_LABELS: Record<BusinessImportScope['kind'], string> = {
  teacher: '您负责的学生',
  school: '本校在读学生',
}

/** 解析结构错误的用户文案（与学生 / 家长导入同一套口径） */
const IMPORT_PARSE_MESSAGES: Record<string, string> = {
  EMPTY_FILE: '文件为空',
  FILE_TOO_LARGE: '文件不能超过 2 MB',
  TOO_MANY_ROWS: '单个文件不能超过 2,000 行',
  INVALID_XLSX: '文件编码或格式不正确，请使用提供的 Excel 模板',
  NO_DATA_SHEET: '文件中没有可解析的数据表（请使用提供的 Excel 模板）',
}

/** 解析导入文件，结构错误直接抛 422（预检与提交路由共用） */
export function parseImportWorkbookOrThrow(event: H3Event, type: InformationImportType, contentBase64: string): { rows: Array<Record<string, string>>, checksum: string } {
  try {
    return parseWorkbookRows(type, contentBase64)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_XLSX'
    throw createError({ statusCode: 422, message: IMPORT_PARSE_MESSAGES[code] || '文件编码或格式不正确' })
  }
}

/** 加载校验所需的库内数据（学生导入） */
export async function loadStudentDeps(event: H3Event, userId: string, schoolId: string): Promise<StudentValidateDeps> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const classes = await db.select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade }).from(schema.classes).where(and(
    eq(schema.classes.ownerUserId, userId),
    eq(schema.classes.schoolId, schoolId),
    eq(schema.classes.status, 'active'),
  )).orderBy(schema.classes.name)
  const classIds = classes.map(item => item.id)
  const existing = classIds.length
    ? await db.select({ classId: schema.students.classId, nameSearch: schema.students.nameSearch }).from(schema.students).where(and(
        inArray(schema.students.classId, classIds),
        eq(schema.students.schoolId, schoolId),
      ))
    : []
  return { classes, existing: existing.map(item => ({ classId: item.classId, nameSearch: item.nameSearch })), secret }
}

/** 加载校验所需的库内数据（家长导入） */
export async function loadGuardianDeps(event: H3Event, userId: string, schoolId: string): Promise<GuardianValidateDeps> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const students = await db.select({ id: schema.students.id, nameSearch: schema.students.nameSearch }).from(schema.students).where(and(
    eq(schema.students.ownerUserId, userId),
    eq(schema.students.schoolId, schoolId),
    eq(schema.students.status, 'active'),
  ))
  const studentIds = students.map(item => item.id)
  const relations = studentIds.length
    ? await db.select({ studentId: schema.studentGuardians.studentId, guardianId: schema.studentGuardians.guardianId }).from(schema.studentGuardians).where(and(
        inArray(schema.studentGuardians.studentId, studentIds),
        eq(schema.studentGuardians.schoolId, schoolId),
        eq(schema.studentGuardians.status, 'active'),
      ))
    : []
  const guardianIds = [...new Set(relations.map(item => item.guardianId))]
  const guardians = guardianIds.length
    ? await db.select({ id: schema.guardians.id, nameSearch: schema.guardians.nameSearch, idCardSearch: schema.guardians.idCardSearch }).from(schema.guardians).where(and(
        inArray(schema.guardians.id, guardianIds),
        eq(schema.guardians.schoolId, schoolId),
      ))
    : []
  const allIdCards = await db.select({ idCardSearch: schema.guardians.idCardSearch }).from(schema.guardians).where(
    and(eq(schema.guardians.schoolId, schoolId), isNotNull(schema.guardians.idCardSearch))
  )
  const guardianById = new Map(guardians.map(item => [item.id, item]))
  return {
    students,
    linkedByName: relations.flatMap(item => {
      const guardian = guardianById.get(item.guardianId)
      return guardian ? [{ studentId: item.studentId, nameSearch: guardian.nameSearch }] : []
    }),
    idCards: allIdCards.flatMap(item => item.idCardSearch ? [item.idCardSearch] : []),
    secret,
  }
}

/** 学生导入提交：errors 非空时整批不写入（严格模式） */
export async function commitStudentImport(event: H3Event, input: { userId: string, schoolId: string, contentBase64: string }): Promise<CommitResult> {
  const db = useDb(event)
  const { rows } = parseWorkbookRows('students', input.contentBase64)
  const deps = await loadStudentDeps(event, input.userId, input.schoolId)
  const { errors, resolved } = validateStudentRows(rows, deps)
  if (errors.length) return { ok: false, totalRows: rows.length, created: 0, skipped: 0 }
  let created = 0
  const ids: string[] = []
  await db.transaction(async (tx) => {
    for (const item of resolved) {
      const values = item.values
      const profile: Record<string, string> = {}
      // 民族/户籍与教师端学生详情页 PATCH 一致：写入 profileEnc；民族同时写入表列（与学校管理员侧对齐）
      if (values.ethnicity) profile.ethnicity = values.ethnicity
      if (values.residence) profile.residenceType = values.residence
      const [student] = await tx.insert(schema.students).values({
        schoolId: input.schoolId,
        ownerUserId: input.userId,
        classId: item.classId,
        nameEnc: encryptSensitive(values.name, deps.secret),
        nameSearch: searchableHash(values.name, deps.secret),
        gender: values.gender || null,
        ethnicity: values.ethnicity || null,
        profileEnc: Object.keys(profile).length ? encryptSensitive(JSON.stringify(profile), deps.secret) : null,
        notesEnc: values.notes ? encryptSensitive(values.notes, deps.secret) : null,
        addressEnc: values.address ? encryptSensitive(values.address, deps.secret) : null,
      }).returning({ id: schema.students.id })
      if (student) { ids.push(student.id); created++ }
    }
  })
  await writeAudit(event, {
    schoolId: input.schoolId,
    actorId: input.userId,
    action: 'information.student.import',
    targetType: 'student',
    targetId: ids[0],
    metadata: { type: 'students', totalRows: rows.length, created },
  })
  return { ok: true, totalRows: rows.length, created, skipped: 0 }
}

/** 家长导入提交：errors 非空时整批不写入（严格模式） */
export async function commitGuardianImport(event: H3Event, input: { userId: string, schoolId: string, contentBase64: string }): Promise<CommitResult> {
  const db = useDb(event)
  const { rows } = parseWorkbookRows('guardians', input.contentBase64)
  const deps = await loadGuardianDeps(event, input.userId, input.schoolId)
  const { errors, resolved } = validateGuardianRows(rows, deps)
  if (errors.length) return { ok: false, totalRows: rows.length, created: 0, skipped: 0 }
  let created = 0
  const ids: string[] = []
  await db.transaction(async (tx) => {
    for (const item of resolved) {
      const values = item.values
      const [guardian] = await tx.insert(schema.guardians).values({
        schoolId: input.schoolId,
        ownerUserId: input.userId,
        nameEnc: encryptSensitive(values.name, deps.secret),
        nameSearch: searchableHash(values.name, deps.secret),
        phoneEnc: values.phone ? encryptSensitive(values.phone, deps.secret) : null,
        relation: values.relation || null,
        workUnit: values.workUnit || null,
        idCardEnc: values.idCard ? encryptSensitive(values.idCard, deps.secret) : null,
        idCardSearch: values.idCard ? searchableHash(values.idCard, deps.secret) : null,
      }).returning({ id: schema.guardians.id })
      if (!guardian) continue
      ids.push(guardian.id)
      created++
      await tx.insert(schema.studentGuardians).values({
        studentId: item.studentId,
        guardianId: guardian.id,
        schoolId: input.schoolId,
      }).onConflictDoNothing()
    }
  })
  await writeAudit(event, {
    schoolId: input.schoolId,
    actorId: input.userId,
    action: 'information.guardian.import',
    targetType: 'guardian',
    targetId: ids[0],
    metadata: { type: 'guardians', totalRows: rows.length, created },
  })
  return { ok: true, totalRows: rows.length, created, skipped: 0 }
}

// ===== 家校沟通 / 学生事件记录（教师端信息中心 + 学校管理员导入管理共用）=====

/** 加载学生匹配所需的库内数据：教师范围限定本人负责，管理员范围为全校在册学生 */
export async function loadBusinessImportDeps(event: H3Event, input: { schoolId: string, scope: BusinessImportScope }): Promise<BusinessImportDeps> {
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const conditions = [
    eq(schema.students.schoolId, input.schoolId),
    eq(schema.students.status, 'active'),
  ]
  if (input.scope.kind === 'teacher') conditions.push(eq(schema.students.ownerUserId, input.scope.userId))
  const rows = await db.select({
    id: schema.students.id,
    nameSearch: schema.students.nameSearch,
    ownerUserId: schema.students.ownerUserId,
    className: schema.classes.name,
    grade: schema.classes.grade,
  }).from(schema.students)
    .leftJoin(schema.classes, and(
      eq(schema.classes.id, schema.students.classId),
      eq(schema.classes.schoolId, input.schoolId),
    ))
    .where(and(...conditions))
  return {
    students: rows.map(row => ({ id: row.id, nameSearch: row.nameSearch, ownerUserId: row.ownerUserId, className: row.className, grade: row.grade })),
    secret,
    studentScopeLabel: BUSINESS_SCOPE_LABELS[input.scope.kind],
  }
}

export type BusinessImportPreview = {
  checksum: string
  totalRows: number
  validRows: number
  errors: ImportRowError[]
  sample: Array<Record<string, string | number>>
}

/**
 * 沟通 / 事件导入预检：解析已完成（路由负责把结构错误映射成 422），这里只做库内校验。
 * 示例行只投影非正文列，摘要与说明不回显完整内容。
 */
export async function previewBusinessImport(event: H3Event, input: {
  schoolId: string
  type: BusinessImportType
  scope: BusinessImportScope
  rows: Array<Record<string, string>>
  checksum: string
  now?: Date
}): Promise<BusinessImportPreview> {
  const deps = await loadBusinessImportDeps(event, { schoolId: input.schoolId, scope: input.scope })
  const now = input.now ?? new Date()
  if (input.type === 'communications') {
    const { errors, resolved } = validateCommunicationRows(input.rows, deps, now)
    return { checksum: input.checksum, totalRows: input.rows.length, validRows: resolved.length, errors, sample: buildCommunicationImportSample(resolved) }
  }
  const { errors, resolved } = validateStudentEventRows(input.rows, deps, now)
  return { checksum: input.checksum, totalRows: input.rows.length, validRows: resolved.length, errors, sample: buildStudentEventImportSample(resolved) }
}

/** 沟通 / 事件导入提交：只新增记录，不做 upsert；任一错误行整批不写入（严格模式） */
export async function commitBusinessImport(event: H3Event, input: {
  schoolId: string
  actorId: string
  type: BusinessImportType
  scope: BusinessImportScope
  contentBase64: string
  /** 学校管理员端传入预检记录 id：同一事务内把 school_imports 置为已提交（状态 + checksum 守卫） */
  previewId?: string
  now?: Date
}): Promise<CommitResult> {
  const db = useDb(event)
  const { rows, checksum } = parseWorkbookRows(input.type, input.contentBase64)
  const deps = await loadBusinessImportDeps(event, { schoolId: input.schoolId, scope: input.scope })
  const now = input.now ?? new Date()
  // 两个分支分开校验，失败时保持与现有导入一致的「整批不写入」语义
  const communicationResult = input.type === 'communications' ? validateCommunicationRows(rows, deps, now) : null
  const eventResult = input.type === 'student_events' ? validateStudentEventRows(rows, deps, now) : null
  const errors = communicationResult?.errors ?? eventResult?.errors ?? []
  if (errors.length) return { ok: false, totalRows: rows.length, created: 0, skipped: 0 }

  const ids: string[] = []
  await db.transaction(async (tx) => {
    if (communicationResult) {
      for (const item of communicationResult.resolved) {
        const values = item.values
        const [record] = await tx.insert(schema.communications).values({
          schoolId: input.schoolId,
          ownerUserId: item.ownerUserId,
          studentId: item.studentId,
          channel: values.channel,
          summaryEnc: encryptSensitive(values.summary, deps.secret),
          parentType: values.parentType,
          attitudeType: values.attitudeType,
          containerLevel: values.containerLevel,
          riskLevel: values.riskLevel,
          occurredAt: values.occurredAt,
          status: 'active',
        }).returning({ id: schema.communications.id })
        if (record) ids.push(record.id)
      }
    }
    if (eventResult) {
      for (const item of eventResult.resolved) {
        const values = item.values
        const [record] = await tx.insert(schema.studentEvents).values({
          schoolId: input.schoolId,
          ownerUserId: item.ownerUserId,
          studentId: item.studentId,
          eventType: values.eventType,
          severity: values.severity,
          title: values.title,
          description: values.description,
          resolution: values.resolution,
          occurredAt: values.occurredAt,
          status: values.status,
        }).returning({ id: schema.studentEvents.id })
        if (record) ids.push(record.id)
      }
    }
    if (input.previewId) await markSchoolImportCommitted(tx, {
      previewId: input.previewId,
      schoolId: input.schoolId,
      checksum,
      created: ids.length,
    })
  })

  const created = ids.length
  if (input.previewId) {
    await writeAudit(event, {
      schoolId: input.schoolId,
      actorId: input.actorId,
      action: 'school_admin.import.commit',
      targetType: 'school_import',
      targetId: input.previewId,
      metadata: { type: input.type, totalRows: rows.length, created, updated: 0, skipped: 0 },
    })
  } else {
    await writeAudit(event, {
      schoolId: input.schoolId,
      actorId: input.actorId,
      action: input.type === 'communications' ? 'information.communication.import' : 'information.student_event.import',
      targetType: input.type === 'communications' ? 'communication' : 'student_event',
      targetId: ids[0],
      metadata: { type: input.type, totalRows: rows.length, created },
    })
  }
  return { ok: true, totalRows: rows.length, created, skipped: 0 }
}

/** 把预检记录置为已提交；状态或 checksum 不一致说明重复提交或文件被替换，抛 409 */
async function markSchoolImportCommitted(tx: DbTx, input: { previewId: string, schoolId: string, checksum: string, created: number }) {
  const [committed] = await tx.update(schema.schoolImports).set({
    status: 'committed',
    createdRows: input.created,
    updatedRows: 0,
    skippedRows: 0,
    errorCount: 0,
  }).where(and(
    eq(schema.schoolImports.id, input.previewId),
    eq(schema.schoolImports.schoolId, input.schoolId),
    eq(schema.schoolImports.status, 'previewed'),
    eq(schema.schoolImports.checksum, input.checksum),
  )).returning({ id: schema.schoolImports.id })
  if (!committed) throw createError({ statusCode: 409, message: '预检记录已提交或状态发生变化' })
}
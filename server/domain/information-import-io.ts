import type { H3Event } from 'h3'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { encryptSensitive, searchableHash } from '../utils/crypto'
import { schema, useDb } from '../utils/db'
import { writeAudit } from '../utils/audit'
import {
  parseWorkbookRows,
  validateGuardianRows,
  validateStudentRows,
  type GuardianValidateDeps,
  type StudentValidateDeps,
} from './information-imports'

/**
 * 信息中心教师端批量导入的查库与写入层（依赖 h3 / 数据库，不参与单元测试）。
 * 解析与校验逻辑见 information-imports.ts。
 */

export type CommitResult = {
  ok: boolean
  totalRows: number
  created: number
  skipped: number
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
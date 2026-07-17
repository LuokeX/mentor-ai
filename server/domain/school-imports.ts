import type { H3Event } from 'h3'
import argon2 from 'argon2'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createActivationToken, invitationExpiresAt } from './invitations'
import { encryptSensitive, hashToken, searchableHash } from '../utils/crypto'
import { schema, useDb } from '../utils/db'

export type SchoolImportType = 'users' | 'classes' | 'students' | 'guardians'
export type ImportError = { row: number, code: string, message: string }

export const importTemplates: Record<SchoolImportType, string> = {
  users: 'name,email,role\n张老师,teacher@example.edu.cn,teacher\n',
  classes: 'class_code,name,grade,teacher_email\nG7-01,七年级一班,7,teacher@example.edu.cn\n',
  students: 'student_code,name,gender,class_code,notes\nS0001,示例学生,unknown,G7-01,\n',
  guardians: 'guardian_code,student_code,name,relation,phone\nG0001,S0001,示例家长,母亲,13800000000\n'
}

const requiredHeaders: Record<SchoolImportType, string[]> = {
  users: ['name', 'email', 'role'],
  classes: ['class_code', 'name', 'grade', 'teacher_email'],
  students: ['student_code', 'name', 'gender', 'class_code', 'notes'],
  guardians: ['guardian_code', 'student_code', 'name', 'relation', 'phone']
}

function decodeFile(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length) throw new Error('EMPTY_FILE')
  if (bytes.length > 2 * 1024 * 1024) throw new Error('FILE_TOO_LARGE')
  let encoding = 'utf-8'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    encoding = 'gb18030'
    text = new TextDecoder('gb18030', { fatal: true }).decode(bytes)
  }
  return { bytes, encoding, text: text.replace(/^\uFEFF/, '') }
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++ } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(value.trim()); value = ''
    } else value += char
  }
  if (quoted) throw new Error('UNCLOSED_QUOTE')
  cells.push(value.trim())
  return cells
}

export function parseImportFile(type: SchoolImportType, contentBase64: string) {
  const { bytes, encoding, text } = decodeFile(contentBase64)
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  if (!lines.length) throw new Error('EMPTY_FILE')
  if (lines.length - 1 > 2000) throw new Error('TOO_MANY_ROWS')
  const headers = parseCsvLine(lines[0]!).map(item => item.toLowerCase())
  const errors: ImportError[] = []
  for (const header of requiredHeaders[type]) {
    if (!headers.includes(header)) errors.push({ row: 1, code: 'MISSING_HEADER', message: '缺少必填列' })
  }
  const rows = lines.slice(1).map((line, index) => {
    try {
      const values = parseCsvLine(line)
      return Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() || '']))
    } catch {
      errors.push({ row: index + 2, code: 'CSV_FORMAT', message: 'CSV 引号格式不正确' })
      return {}
    }
  })
  return { checksum, encoding, rows, errors }
}

function addError(errors: ImportError[], row: number, code: string, message: string) {
  if (errors.length < 200) errors.push({ row, code, message })
}

export async function validateSchoolImport(event: H3Event, input: {
  schoolId: string, type: SchoolImportType, contentBase64: string
}) {
  const parsed = parseImportFile(input.type, input.contentBase64)
  const errors = [...parsed.errors]
  const seen = new Set<string>()
  const db = useDb(event)
  const [users, classes, students] = await Promise.all([
    db.select({ email: schema.users.email, role: schema.users.role, schoolId: schema.users.schoolId }).from(schema.users),
    db.select({ code: schema.classes.externalCode }).from(schema.classes).where(eq(schema.classes.schoolId, input.schoolId)),
    db.select({ code: schema.students.externalRefSearch }).from(schema.students).where(eq(schema.students.schoolId, input.schoolId))
  ])
  const teacherEmails = new Set(users.filter(item => item.role === 'teacher' && item.schoolId === input.schoolId).map(item => item.email))
  const usersByEmail = new Map(users.map(item => [item.email, item]))
  const classCodes = new Set(classes.flatMap(item => item.code ? [item.code] : []))
  const studentCodes = new Set(students.flatMap(item => item.code ? [item.code] : []))
  const secret = useRuntimeConfig(event).encryptionKey
  parsed.rows.forEach((row, index) => {
    const line = index + 2
    if (input.type === 'users') {
      if (!row.name || row.name.length > 120) addError(errors, line, 'INVALID_NAME', '姓名为空或长度不正确')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email || '')) addError(errors, line, 'INVALID_EMAIL', '邮箱格式不正确')
      const existing = usersByEmail.get((row.email || '').toLowerCase())
      if (existing?.schoolId && existing.schoolId !== input.schoolId) addError(errors, line, 'EMAIL_IN_OTHER_SCHOOL', '邮箱已被其他学校使用')
      if (!['teacher', 'psychologist'].includes(row.role || '')) addError(errors, line, 'INVALID_ROLE', '角色只允许 teacher 或 psychologist')
      const key = `email:${row.email?.toLowerCase()}`
      if (seen.has(key)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复记录'); else seen.add(key)
    } else if (input.type === 'classes') {
      if (!row.class_code || !row.name) addError(errors, line, 'REQUIRED_FIELD', '必填字段为空')
      const grade = Number(row.grade)
      if (!Number.isInteger(grade) || grade < 1 || grade > 12) addError(errors, line, 'INVALID_GRADE', '年级必须为 1 到 12 的整数')
      if (!teacherEmails.has((row.teacher_email || '').toLowerCase())) addError(errors, line, 'TEACHER_NOT_FOUND', '负责教师账号不存在')
      if (seen.has(`class:${row.class_code}`)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复记录'); else seen.add(`class:${row.class_code}`)
    } else if (input.type === 'students') {
      if (!row.student_code || !row.name || !row.class_code) addError(errors, line, 'REQUIRED_FIELD', '必填字段为空')
      if (!classCodes.has(row.class_code || '')) addError(errors, line, 'CLASS_NOT_FOUND', '班级代码不存在，请先导入班级')
      if (seen.has(`student:${row.student_code}`)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复记录'); else seen.add(`student:${row.student_code}`)
    } else {
      if (!row.guardian_code || !row.student_code || !row.name) addError(errors, line, 'REQUIRED_FIELD', '必填字段为空')
      const hash = searchableHash(row.student_code || '', secret)
      if (!studentCodes.has(hash)) addError(errors, line, 'STUDENT_NOT_FOUND', '学生代码不存在，请先导入学生')
      if (row.phone && !/^1[3-9]\d{9}$/.test(row.phone)) addError(errors, line, 'INVALID_PHONE', '手机号格式不正确')
      if (seen.has(`guardian:${row.guardian_code}`)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复记录'); else seen.add(`guardian:${row.guardian_code}`)
    }
  })
  return { ...parsed, errors }
}

export async function commitSchoolImport(event: H3Event, input: {
  schoolId: string, adminId: string, type: SchoolImportType, contentBase64: string
}) {
  const parsed = await validateSchoolImport(event, input)
  if (parsed.errors.length) return { ...parsed, created: 0, updated: 0, skipped: 0, invitations: [] }
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  return db.transaction(async (tx) => {
    let created = 0; let updated = 0; let skipped = 0
    const invitations: Array<{ userId: string, activationToken: string, expiresAt: Date }> = []
    for (const row of parsed.rows) {
      if (input.type === 'users') {
        const email = row.email!.toLowerCase()
        const [existing] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
        if (existing?.schoolId && existing.schoolId !== input.schoolId) throw new Error('EMAIL_CROSS_SCHOOL')
        let userId = existing?.id
        if (!existing) {
          const [user] = await tx.insert(schema.users).values({
            schoolId: input.schoolId, name: row.name!, email, role: row.role!, status: 'invited',
            passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id })
          }).returning({ id: schema.users.id })
          userId = user!.id; created++
        } else if (existing.status === 'active') {
          skipped++
          continue
        } else {
          await tx.update(schema.users).set({ name: row.name!, role: row.role!, status: 'invited', updatedAt: new Date() }).where(eq(schema.users.id, existing.id))
          updated++
        }
        const token = createActivationToken(); const expiresAt = invitationExpiresAt()
        await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(and(eq(schema.invitations.userId, userId!), eq(schema.invitations.email, email)))
        await tx.insert(schema.invitations).values({
          schoolId: input.schoolId, userId, name: row.name!, email, role: row.role!, tokenHash: hashToken(token),
          invitedBy: input.adminId, expiresAt
        })
        invitations.push({ userId: userId!, activationToken: token, expiresAt })
      } else if (input.type === 'classes') {
        const [teacher] = await tx.select().from(schema.users).where(and(eq(schema.users.schoolId, input.schoolId), eq(schema.users.email, row.teacher_email!.toLowerCase()))).limit(1)
        const [existing] = await tx.select().from(schema.classes).where(and(eq(schema.classes.schoolId, input.schoolId), eq(schema.classes.externalCode, row.class_code!))).limit(1)
        const values = { ownerUserId: teacher!.id, name: row.name!, grade: Number(row.grade), updatedAt: new Date() }
        if (existing) { await tx.update(schema.classes).set(values).where(eq(schema.classes.id, existing.id)); updated++ }
        else { await tx.insert(schema.classes).values({ schoolId: input.schoolId, externalCode: row.class_code!, ...values }); created++ }
      } else if (input.type === 'students') {
        const [klass] = await tx.select().from(schema.classes).where(and(eq(schema.classes.schoolId, input.schoolId), eq(schema.classes.externalCode, row.class_code!))).limit(1)
        const hash = searchableHash(row.student_code!, secret)
        const [existing] = await tx.select().from(schema.students).where(and(eq(schema.students.schoolId, input.schoolId), eq(schema.students.externalRefSearch, hash))).limit(1)
        const values = {
          ownerUserId: klass!.ownerUserId, classId: klass!.id,
          nameEnc: encryptSensitive(row.name!, secret), nameSearch: searchableHash(row.name!, secret),
          gender: row.gender || null, notesEnc: row.notes ? encryptSensitive(row.notes, secret) : null,
          externalRefEnc: encryptSensitive(row.student_code!, secret), externalRefSearch: hash, updatedAt: new Date()
        }
        if (existing) { await tx.update(schema.students).set(values).where(eq(schema.students.id, existing.id)); updated++ }
        else { await tx.insert(schema.students).values({ schoolId: input.schoolId, ...values }); created++ }
      } else {
        const studentHash = searchableHash(row.student_code!, secret)
        const [student] = await tx.select().from(schema.students).where(and(eq(schema.students.schoolId, input.schoolId), eq(schema.students.externalRefSearch, studentHash))).limit(1)
        const guardianHash = searchableHash(row.guardian_code!, secret)
        const [existing] = await tx.select().from(schema.guardians).where(and(eq(schema.guardians.schoolId, input.schoolId), eq(schema.guardians.externalRefSearch, guardianHash))).limit(1)
        const values = {
          ownerUserId: student!.ownerUserId, nameEnc: encryptSensitive(row.name!, secret), nameSearch: searchableHash(row.name!, secret),
          phoneEnc: row.phone ? encryptSensitive(row.phone, secret) : null, relation: row.relation || null,
          externalRefEnc: encryptSensitive(row.guardian_code!, secret), externalRefSearch: guardianHash, updatedAt: new Date()
        }
        let guardianId: string
        if (existing) { await tx.update(schema.guardians).set(values).where(eq(schema.guardians.id, existing.id)); guardianId = existing.id; updated++ }
        else { const [guardian] = await tx.insert(schema.guardians).values({ schoolId: input.schoolId, ...values }).returning({ id: schema.guardians.id }); guardianId = guardian!.id; created++ }
        await tx.insert(schema.studentGuardians).values({ studentId: student!.id, guardianId }).onConflictDoNothing()
      }
    }
    return { ...parsed, created, updated, skipped, invitations }
  })
}

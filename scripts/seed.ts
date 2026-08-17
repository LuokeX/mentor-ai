import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import {
  classes,
  communications,
  guardians,
  schools,
  schoolSettings,
  studentGuardians,
  students,
  users
} from '../server/db/schema'
import { encryptSensitive, searchableHash } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; copy .env.example to .env first')
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required in production')
const encryptionKey = process.env.ENCRYPTION_KEY || 'development-encryption-key-change-me'
const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)
const passwordHash = await argon2.hash('Mentor@2026', { type: argon2.argon2id })

let [school] = await db.select().from(schools).where(eq(schools.code, 'demo-school')).limit(1)
if (!school) [school] = await db.insert(schools).values({ name: '六力学校（演示）', code: 'demo-school' }).returning()

const accounts = [
  { phone: '13900001001', name: '李老师', role: 'teacher', schoolId: school.id },
  { phone: '13900001002', name: '张老师', role: 'teacher', schoolId: school.id },
  { phone: '13900001003', name: '王心理专员', role: 'psychologist', schoolId: school.id, totpSecretEnc: encryptSensitive('JBSWY3DPEHPK3PXP', encryptionKey) },
  { phone: '13900001004', name: '学校管理员', role: 'school_admin', schoolId: school.id },
  { phone: '13900001005', name: '平台管理员', role: 'platform_admin', schoolId: null }
]
for (const account of accounts) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, account.phone)).limit(1)
  if (!existing) await db.insert(users).values({ ...account, passwordHash })
}
const [psych] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '13900001003')).limit(1)
await db.insert(schoolSettings).values({
  schoolId: school.id, helpPhone: '022-00000000', smsRecipients: ['13800000000'], referralPsychologistId: psych?.id
}).onConflictDoUpdate({ target: schoolSettings.schoolId, set: { referralPsychologistId: psych?.id, updatedAt: new Date() } })

const [teacherLi] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '13900001001')).limit(1)
const [teacherZhang] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '13900001002')).limit(1)
if (teacherLi && teacherZhang) {
  async function ensureClass(input: { name: string, grade: number, studentCount: number, ownerUserId: string }) {
    let [row] = await db.select().from(classes).where(eq(classes.name, input.name)).limit(1)
    if (!row) [row] = await db.insert(classes).values({
      schoolId: school.id,
      ownerUserId: input.ownerUserId,
      name: input.name,
      grade: input.grade,
      studentCount: input.studentCount
    }).returning()
    return row
  }

  async function ensureStudent(input: { name: string, classId: string, ownerUserId: string, gender: string, notes: string }) {
    const nameSearch = searchableHash(input.name, encryptionKey)
    let [row] = await db.select().from(students).where(eq(students.nameSearch, nameSearch)).limit(1)
    if (!row) [row] = await db.insert(students).values({
      schoolId: school.id,
      ownerUserId: input.ownerUserId,
      classId: input.classId,
      nameEnc: encryptSensitive(input.name, encryptionKey),
      nameSearch,
      gender: input.gender,
      notesEnc: encryptSensitive(input.notes, encryptionKey)
    }).returning()
    return row
  }

  async function ensureGuardian(input: { name: string, ownerUserId: string, phone: string, relation: string }) {
    const nameSearch = searchableHash(`${input.name}-${input.phone}`, encryptionKey)
    let [row] = await db.select().from(guardians).where(eq(guardians.nameSearch, nameSearch)).limit(1)
    if (!row) [row] = await db.insert(guardians).values({
      schoolId: school.id,
      ownerUserId: input.ownerUserId,
      nameEnc: encryptSensitive(input.name, encryptionKey),
      nameSearch,
      phoneEnc: encryptSensitive(input.phone, encryptionKey),
      relation: input.relation
    }).returning()
    return row
  }

  async function ensureStudentGuardian(studentId: string, guardianId: string, schoolId: string) {
    await db.insert(studentGuardians).values({ studentId, guardianId, schoolId }).onConflictDoNothing()
  }

  async function ensureCommunication(input: {
    ownerUserId: string
    studentId: string
    guardianId: string
    summary: string
    parentType: string
    attitudeType: string
    containerLevel: number
    riskLevel: string
  }) {
    const existing = await db.select({ id: communications.id }).from(communications).where(eq(communications.studentId, input.studentId)).limit(1)
    if (existing.length) return
    await db.insert(communications).values({
      schoolId: school.id,
      ownerUserId: input.ownerUserId,
      studentId: input.studentId,
      guardianId: input.guardianId,
      summaryEnc: encryptSensitive(input.summary, encryptionKey),
      parentType: input.parentType,
      attitudeType: input.attitudeType,
      containerLevel: input.containerLevel,
      riskLevel: input.riskLevel,
      occurredAt: new Date()
    })
  }

  const classOne = await ensureClass({ name: '七年级 3 班', grade: 7, studentCount: 38, ownerUserId: teacherLi.id })
  const classTwo = await ensureClass({ name: '八年级 1 班', grade: 8, studentCount: 42, ownerUserId: teacherZhang.id })

  const demoStudents = [
    { name: '陈一诺', classId: classOne.id, ownerUserId: teacherLi.id, gender: '女', notes: '近期作业拖延，课堂参与下降，需要观察压力来源。', guardian: { name: '陈一诺妈妈', phone: '13900001001', relation: '母亲' }, communication: '家长在群里公开质疑作业安排，情绪较急，希望老师给出明确解释。' },
    { name: '刘子航', classId: classOne.id, ownerUserId: teacherLi.id, gender: '男', notes: '和同伴有摩擦，偶尔顶撞班干部。', guardian: { name: '刘子航爸爸', phone: '13900001002', relation: '父亲' }, communication: '家长反馈孩子回家说不想上学，担心在班级里被孤立。' },
    { name: '周雨桐', classId: classOne.id, ownerUserId: teacherLi.id, gender: '女', notes: '成绩稳定，但最近明显沉默，需低压沟通。', guardian: { name: '周雨桐妈妈', phone: '13900001003', relation: '母亲' }, communication: '家长希望老师不要直接批评孩子，担心孩子压力过大。' },
    { name: '王浩然', classId: classTwo.id, ownerUserId: teacherZhang.id, gender: '男', notes: '转班适应中，和原班同学联系较多。', guardian: { name: '王浩然妈妈', phone: '13900001004', relation: '母亲' }, communication: '家长询问转班后座位和学习节奏安排，希望获得阶段性反馈。' },
    { name: '赵清予', classId: classTwo.id, ownerUserId: teacherZhang.id, gender: '女', notes: '学习主动性较强，但小组协作中容易急躁。', guardian: { name: '赵清予爸爸', phone: '13900001005', relation: '父亲' }, communication: '家长希望孩子承担更多班级事务，但老师观察到她近期疲惫。' }
  ]

  for (const item of demoStudents) {
    const student = await ensureStudent(item)
    const guardian = await ensureGuardian({ ...item.guardian, ownerUserId: item.ownerUserId })
    await ensureStudentGuardian(student.id, guardian.id, school.id)
    await ensureCommunication({
      ownerUserId: item.ownerUserId,
      studentId: student.id,
      guardianId: guardian.id,
      summary: item.communication,
      parentType: '关注型',
      attitudeType: '合作但焦虑',
      containerLevel: 5,
      riskLevel: '低风险'
    })
  }
}

await pool.end()
process.stdout.write('Seed complete. Demo password: Mentor@2026. Psychologist TOTP secret: JBSWY3DPEHPK3PXP. 教师登录账号：13900001001（李老师）/ 13900001002（张老师）\n')

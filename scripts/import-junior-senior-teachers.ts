/**
 * 一次性导入：初中/高中部班主任账号 + 测试班级（正式环境）
 * 复用 scripts/import-class-teachers.ts 的事务/审计/加密口径，
 * 扩展年级 7-12 与 section 学段（junior/senior）。
 *
 * 用法：
 *   pnpm tsx scripts/import-junior-senior-teachers.ts            # dry-run（默认）
 *   pnpm tsx scripts/import-junior-senior-teachers.ts --apply --phone-suffix
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { auditLogs, classes, schools, users } from '../server/db/schema'
import { encryptSensitive } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

interface TeacherRow { name: string; phone: string }
interface ClassRow {
  className: string
  grade: number
  section: 'junior' | 'senior'
  head: TeacherRow
}

// 初中部（grade 7）+ 高中部（grade 10/11），沿用既有「X年级数字班-测试」模式
// 注：ROWS 保持「本次待导入名单」语义，已导入项归档于注释：
//   2026-08-20：七年级八班-测试 张九辰 13963390231 | 七年级九班-测试 王伟伟 18033650136 | 七年级十班-测试 张锐 13132545177
//               高一八班-测试 张新凯 13672116029 | 高一九班-测试 张浩然 18920963515 | 高一十班-测试 王绍鹏 17277769473
//               高二八班-测试 魏苗苗 17822450916
//   2026-08-24：七年级十一班-测试 曹莹 17602669264 | 高一十一班-测试 李美慧 15626042800
const ROWS: ClassRow[] = [
  { className: '七年级十二班-测试', grade: 7, section: 'junior', head: { name: '顾守连', phone: '13852834971' } }
]

const PHONE_RE = /^1\d{10}$/

function validateData(rows: ClassRow[]): string[] {
  const errors: string[] = []
  const seenPhones = new Map<string, string>()
  const seenClasses = new Map<string, string>()
  for (const row of rows) {
    if (seenClasses.has(row.className)) errors.push(`班级重名：${row.className}`)
    else seenClasses.set(row.className, row.head.name)
    if (!PHONE_RE.test(row.head.phone)) errors.push(`${row.className} 班主任 ${row.head.name}：手机号格式不正确（${row.head.phone}）`)
    const prev = seenPhones.get(row.head.phone)
    if (prev) errors.push(`手机号重复：${row.head.phone}（${prev} 与 ${row.className} ${row.head.name}）`)
    else seenPhones.set(row.head.phone, `${row.className} ${row.head.name}`)
  }
  return errors
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const phoneSuffixPwd = args.includes('--phone-suffix')
  if (apply && !phoneSuffixPwd) throw new Error('执行导入需 --phone-suffix（初始密码=手机号后 8 位）')

  const errors = validateData(ROWS)
  if (errors.length) {
    console.error('校验失败：')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`校验通过：${ROWS.length} 个班级、${ROWS.length} 个班主任账号`)

  loadLocalEnv()
  const databaseUrl = process.env.DATABASE_URL
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required')
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool)

  try {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '13800000000')).limit(1)
    if (!admin) throw new Error('未找到平台管理员账号(13800000000)')
    const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.code, 'llschool')).limit(1)
    if (!school) throw new Error('未找到学校 llschool')
    const schoolId = school.id

    const conflict: string[] = []
    for (const row of ROWS) {
      const [hit] = await db.select({ name: users.name }).from(users).where(eq(users.phone, row.head.phone)).limit(1)
      if (hit) conflict.push(`${row.head.name} 手机号 ${row.head.phone} 已存在正式库账号（${hit.name}）`)
      const [classHit] = await db.select({ id: classes.id }).from(classes).where(eq(classes.name, row.className)).limit(1)
      if (classHit) conflict.push(`班级 ${row.className} 已存在`)
    }
    if (conflict.length) {
      console.error('与正式库冲突，已终止：')
      for (const c of conflict) console.error(`  - ${c}`)
      process.exit(1)
    }

    if (!apply) {
      console.log('导入计划（dry-run，未写库）：')
      for (const row of ROWS) console.log(`  ${row.className}（grade ${row.grade} / ${row.section}）：班主任 ${row.head.name}(${row.head.phone})`)
      console.log('将创建：teacher 账号（isClassTeacher=true，teachingGrades=[年级]）+ 班级（owner=班主任，section=学段）')
      console.log('账号字段：status=active、phoneEnc 加密、argon2id 密码哈希（初始密码=手机号后 8 位）；审计 actor=平台管理员(13800000000)')
      return
    }

    const now = new Date()
    const result = await db.transaction(async (tx) => {
      let createdUsers = 0
      let createdClasses = 0
      const byPhone = new Map<string, string>()
      for (const row of ROWS) {
        const passwordHash = await argon2.hash(row.head.phone.slice(-8), { type: argon2.argon2id })
        const [user] = await tx.insert(users).values({
          schoolId,
          name: row.head.name,
          phone: row.head.phone,
          role: 'teacher',
          status: 'active',
          passwordHash,
          activatedAt: now,
          phoneEnc: encryptSensitive(row.head.phone, encryptionKey),
          teachingGrades: [row.grade],
          isClassTeacher: true
        }).returning({ id: users.id })
        byPhone.set(row.head.phone, user.id)
        createdUsers++
        await tx.insert(auditLogs).values({
          schoolId,
          actorId: admin.id,
          action: 'school_admin.user.create',
          targetType: 'user',
          targetId: user.id,
          result: 'success',
          metadata: { role: 'teacher', source: 'junior-senior-class-import' }
        })
        const [klass] = await tx.insert(classes).values({
          schoolId,
          ownerUserId: user.id,
          name: row.className,
          grade: row.grade,
          section: row.section,
          classType: 'admin',
          studentCount: 0,
          schoolYear: null
        }).returning({ id: classes.id })
        createdClasses++
        await tx.insert(auditLogs).values({
          schoolId,
          actorId: admin.id,
          action: 'school_admin.class.create',
          targetType: 'class',
          targetId: klass.id,
          result: 'success',
          metadata: { ownerUserId: user.id, source: 'junior-senior-class-import' }
        })
      }
      return { createdUsers, createdClasses }
    })

    console.log(`\n导入完成：${result.createdUsers} 个账号、${result.createdClasses} 个班级（单事务提交并写审计）。`)
    console.log('\n账号初始密码（手机号后 8 位）：')
    for (const row of ROWS) console.log(`${row.className} | ${row.head.name} ${row.head.phone} 密码 ${row.head.phone.slice(-8)}`)
  } finally {
    await pool.end()
  }
}

void main()
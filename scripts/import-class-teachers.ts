/**
 * 一次性导入：班主任/副班主任账号 + 班级绑定（正式环境）
 *
 * 用法：
 *   pnpm tsx scripts/import-class-teachers.ts --dry-run     # 校验 + 打印导入计划（默认，不写库）
 *   pnpm tsx scripts/import-class-teachers.ts --dry-run --file <data.json>
 *   pnpm tsx scripts/import-class-teachers.ts --apply --password <统一初始密码> [--file <data.json>]
 *   pnpm tsx scripts/import-class-teachers.ts --apply --random   # 每人随机密码，执行后打印清单
 *   pnpm tsx scripts/import-class-teachers.ts --apply --phone-suffix  # 初始密码 = 各账号手机号后 8 位
 *
 * --file <data.json>：ClassRow 数组 [{ className, grade, head: {name, phone}, deputy: {name, phone}|null }]；
 * 不传则使用脚本内置的班主任/副班主任开通表数据。
 *
 * 逻辑对齐 server/api/v1/school-admin/users.post.ts 与 classes/index.post.ts：
 * argon2id 密码哈希、phoneEnc 加密、审计日志（actor 为平台管理员）。
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { randomBytes, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { auditLogs, classes, schools, users } from '../server/db/schema'
import { encryptSensitive } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

// ---------- 数据（来源：班主任/副班主任开通账号信息表） ----------
interface TeacherRow { name: string; phone: string | null }
interface ClassRow {
  className: string
  grade: number
  head: TeacherRow
  deputy: TeacherRow | null
}

const ROWS: ClassRow[] = [
  { className: '一年级1班', grade: 1, head: { name: '刘春颖', phone: '18722050462' }, deputy: { name: '苏羽', phone: '15690939581' } },
  { className: '一年级2班', grade: 1, head: { name: '张鹏鹏', phone: '18920591737' }, deputy: { name: '荆诗雯', phone: '13844270633' } },
  { className: '一年级3班', grade: 1, head: { name: '王晓辰', phone: '17610013326' }, deputy: { name: '崔亚楠', phone: '15902960110' } },
  { className: '一年级4班', grade: 1, head: { name: '刘佳', phone: '15620634594' }, deputy: { name: '何淼', phone: '18322607661' } },
  { className: '二年级1班', grade: 2, head: { name: '刘恋恋', phone: '15822918825' }, deputy: { name: '马丽莉', phone: '18333631787' } },
  { className: '二年级2班', grade: 2, head: { name: '王宇卓', phone: '18202626835' }, deputy: { name: '吕凤至', phone: '15845447541' } },
  { className: '二年级3班', grade: 2, head: { name: '李嘉卉', phone: '17695722033' }, deputy: { name: '张肖薇', phone: '18322270529' } },
  { className: '二年级4班', grade: 2, head: { name: '汪春凤', phone: '18801191285' }, deputy: { name: '东娜', phone: '15022603258' } },
  { className: '三年级1班', grade: 3, head: { name: '宋晓寅', phone: '18031398256' }, deputy: { name: '于海侠', phone: '15320130099' } },
  { className: '三年级2班', grade: 3, head: { name: '邹嘉丽', phone: '18810327797' }, deputy: { name: '高妮', phone: '15320196919' } },
  { className: '三年级3班', grade: 3, head: { name: '陈婷', phone: '18622412238' }, deputy: { name: '李广真', phone: '18888223384' } },
  { className: '四年级1班', grade: 4, head: { name: '田荣荣', phone: '18793109648' }, deputy: { name: '展慧慧', phone: '13513872075' } },
  { className: '四年级2班', grade: 4, head: { name: '郭玲', phone: '18910970689' }, deputy: { name: '郑振威', phone: '13552569362' } },
  { className: '四年级3班', grade: 4, head: { name: '张艳', phone: '18629424083' }, deputy: { name: '潘蕾', phone: '13188670214' } },
  { className: '四年级4班', grade: 4, head: { name: '褚亚楠', phone: '18513082664' }, deputy: { name: '田晨静', phone: '18622487677' } },
  { className: '五年级1班', grade: 5, head: { name: '高磊', phone: '15620135760' }, deputy: { name: '杨晨', phone: '18202617639' } },
  { className: '五年级2班', grade: 5, head: { name: '刘俊美', phone: '13034320727' }, deputy: { name: '任高杨', phone: '13512458027' } },
  { className: '五年级3班', grade: 5, head: { name: '王戌哲', phone: '13652095625' }, deputy: { name: '杨楠', phone: null } },
  { className: '五年级4班', grade: 5, head: { name: '李美琪', phone: '15620038284' }, deputy: { name: '苏雅娴', phone: '13672019863' } },
  { className: '六年级1班', grade: 6, head: { name: '王凤培', phone: '15822439172' }, deputy: { name: '陈艳冬', phone: '15822939948' } },
  { className: '六年级2班', grade: 6, head: { name: '陈冉', phone: '13821426297' }, deputy: { name: '刘英男', phone: '15222124065' } },
  { className: '六年级3班', grade: 6, head: { name: '王莉', phone: '18322742431' }, deputy: { name: '王晓晶', phone: '18810455762' } },
  { className: '六年级4班', grade: 6, head: { name: '翟争丽', phone: '18502237738' }, deputy: { name: '王喜凤', phone: '13364395552' } },
  { className: '六年级5班', grade: 6, head: { name: '石凤霞', phone: '13522128523' }, deputy: { name: '张珊涤', phone: '13512405658' } },
  { className: '六年级6班', grade: 6, head: { name: '侯春婷', phone: '18822304365' }, deputy: { name: '杜娜', phone: '13920185003' } }
]

// ---------- 校验（纯函数） ----------
const PHONE_RE = /^1\d{10}$/
const GRADE_NAME: Record<number, string> = { 1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级' }

function validateData(rows: ClassRow[]): { errors: string[]; notes: string[]; skipped: string[] } {
  const errors: string[] = []
  const notes: string[] = []
  const skipped: string[] = []
  const seenPhones = new Map<string, string>()
  const seenClasses = new Map<string, string>()

  for (const row of rows) {
    if (seenClasses.has(row.className)) errors.push(`班级重名：${row.className}（${seenClasses.get(row.className)} 与 ${row.head.name}）`)
    else seenClasses.set(row.className, row.head.name)

    // 班级名与年级一致性
    const gradeWord = GRADE_NAME[row.grade]
    if (!gradeWord) errors.push(`${row.className}：年级 ${row.grade} 超出 1-6 范围`)
    else if (!row.className.startsWith(gradeWord)) errors.push(`${row.className}：班级名与年级 ${row.grade} 不一致`)

    const teachers: Array<{ kind: string; t: TeacherRow }> = [{ kind: '班主任', t: row.head }]
    if (row.deputy) teachers.push({ kind: '副班主任', t: row.deputy })
    for (const { kind, t } of teachers) {
      if (!t.phone) {
        if (kind === '班主任') errors.push(`${row.className} ${kind} ${t.name}：缺少手机号，无法开通账号`)
        else skipped.push(`${row.className} 副班主任 ${t.name}：无手机号，跳过开通，班级副班主任留空`)
        continue
      }
      if (!PHONE_RE.test(t.phone)) errors.push(`${row.className} ${kind} ${t.name}：手机号格式不正确（${t.phone}）`)
      const prev = seenPhones.get(t.phone)
      if (prev) errors.push(`手机号重复：${t.phone}（${prev} 与 ${row.className} ${kind} ${t.name}）`)
      else seenPhones.set(t.phone, `${row.className} ${kind} ${t.name}`)
    }
  }

  // 表格笔误提示：副班主任陈艳冬年级列填 5，班级名为六年级1班，以班级名为准取 6
  const chen = rows.find(r => r.deputy?.name === '陈艳冬')
  if (chen) notes.push(`提示：副班主任陈艳冬表格年级列填 5，班级为六年级1班，脚本以班级名为准按 grade=6 处理`)

  return { errors, notes, skipped }
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*'
  const all = upper + lower + digits + symbols
  const pick = (pool: string) => pool.charAt(randomInt(pool.length))
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  for (let i = 0; i < 12; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = chars[i]!
    chars[i] = chars[j]!
    chars[j] = tmp
  }
  return chars.join('')
}

// ---------- 执行 ----------
async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--apply')
  const randomPwd = args.includes('--random')
  const phoneSuffixPwd = args.includes('--phone-suffix')
  const pwdIdx = args.indexOf('--password')
  const pwdArg = pwdIdx >= 0 ? args[pwdIdx + 1] : undefined
  const pwdModes = [randomPwd, phoneSuffixPwd, pwdArg !== undefined].filter(Boolean).length
  if (!dryRun && pwdModes !== 1) throw new Error('执行导入需且仅需提供 --password <初始密码> / --random / --phone-suffix 之一')
  if (pwdArg !== undefined && pwdArg.length < 8) throw new Error('初始密码长度至少 8 位')

  const fileIdx = args.indexOf('--file')
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined
  const rows: ClassRow[] = filePath
    ? JSON.parse(readFileSync(filePath, 'utf8')) as ClassRow[]
    : ROWS

  const { errors, notes, skipped } = validateData(rows)
  for (const note of notes) console.log(`[提示] ${note}`)
  for (const skip of skipped) console.log(`[跳过] ${skip}`)
  if (errors.length) {
    console.error(`\n校验失败（${errors.length} 项），已终止：`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const accountsToCreate = rows.reduce(
    (sum, row) => sum + 1 + (row.deputy?.phone ? 1 : 0), 0
  )
  console.log(`校验通过：${rows.length} 个班级，本次将创建 ${accountsToCreate} 个教师账号`)

  if (dryRun) {
    console.log('\n导入计划（dry-run，未写库）：')
    for (const row of rows) {
      const deputy = row.deputy?.phone
        ? `${row.deputy.name}(${row.deputy.phone})`
        : (row.deputy ? `${row.deputy.name}(无手机号，跳过)` : '未设置')
      console.log(`  ${row.className}：班主任 ${row.head.name}(${row.head.phone}) / 副班主任 ${deputy}`)
    }
    console.log(`\n将创建：${accountsToCreate} 个 teacher 账号（班主任 isClassTeacher=true，副班主任 false）→ ${rows.length} 个班级（owner=班主任，deputy=副班主任）`)
    console.log('账号字段：status=active、teachingGrades=[年级]、phoneEnc 加密、argon2id 密码哈希；审计 actor=平台管理员(13800000000)')
    return
  }

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

    // 与正式库现有账号/班级冲突检查
    const conflict: string[] = []
    for (const row of rows) {
      for (const t of [row.head, row.deputy].filter((x): x is TeacherRow => x !== null)) {
        if (t.phone) {
          const [hit] = await db.select({ name: users.name }).from(users).where(eq(users.phone, t.phone)).limit(1)
          if (hit) conflict.push(`${t.name} 手机号 ${t.phone} 已存在正式库账号（${hit.name}）`)
        }
      }
      const [classHit] = await db.select({ id: classes.id }).from(classes)
        .where(eq(classes.name, row.className)).limit(1)
      if (classHit) conflict.push(`班级 ${row.className} 已存在`)
    }
    if (conflict.length) {
      console.error('与正式库冲突，已终止：')
      for (const c of conflict) console.error(`  - ${c}`)
      process.exit(1)
    }

    const now = new Date()
    const passwordMap = new Map<string, string>()

    // 密码策略：统一 / 每人随机 / 手机号后 8 位
    const passwordFor = (t: TeacherRow): string => {
      if (pwdArg) return pwdArg
      if (phoneSuffixPwd) return t.phone!.slice(-8)
      const pwd = generatePassword()
      passwordMap.set(t.phone!, pwd)
      return pwd
    }

    const result = await db.transaction(async (tx) => {
      let createdUsers = 0
      let createdClasses = 0
      const byPhone = new Map<string, string>() // phone -> userId

      for (const row of rows) {
        const members: Array<{ kind: string; t: TeacherRow }> = [{ kind: '班主任', t: row.head }]
        if (row.deputy) members.push({ kind: '副班主任', t: row.deputy })
        for (const { kind, t } of members) {
          if (!t.phone) continue // 无手机号的副班主任：跳过账号开通（班级副班主任留空）
          const passwordHash = await argon2.hash(passwordFor(t), { type: argon2.argon2id })
          const [user] = await tx.insert(users).values({
            schoolId,
            name: t.name,
            phone: t.phone,
            role: 'teacher',
            status: 'active',
            passwordHash,
            activatedAt: now,
            phoneEnc: encryptSensitive(t.phone, encryptionKey),
            teachingGrades: [row.grade],
            isClassTeacher: kind === '班主任'
          }).returning({ id: users.id })
          byPhone.set(t.phone, user.id)
          createdUsers++
          await tx.insert(auditLogs).values({
            schoolId,
            actorId: admin.id,
            action: 'school_admin.user.create',
            targetType: 'user',
            targetId: user.id,
            result: 'success',
            metadata: { role: 'teacher', source: 'class-teacher-import' }
          })
        }
        const [klass] = await tx.insert(classes).values({
          schoolId,
          ownerUserId: byPhone.get(row.head.phone!)!,
          deputyOwnerUserId: row.deputy?.phone ? byPhone.get(row.deputy.phone)! : null,
          name: row.className,
          grade: row.grade,
          section: 'primary',
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
          metadata: { ownerUserId: byPhone.get(row.head.phone!), source: 'class-teacher-import' }
        })
      }
      return { createdUsers, createdClasses }
    })

    console.log(`\n导入完成：${result.createdUsers} 个账号、${result.createdClasses} 个班级，均在单事务内提交并写审计。`)
    console.log('\n账号初始密码（仅本次输出，请妥善保管后分发给教师）：')
    const pwdOf = (t: TeacherRow): string =>
      pwdArg ? pwdArg : phoneSuffixPwd ? t.phone!.slice(-8) : passwordMap.get(t.phone!)!
    for (const row of rows) {
      const deputyLine = row.deputy?.phone
        ? `${row.deputy.name} ${row.deputy.phone} 密码 ${pwdOf(row.deputy)}`
        : (row.deputy ? `${row.deputy.name} 未开通（无手机号）` : '未设置副班主任')
      console.log(`${row.className} | ${row.head.name} ${row.head.phone} 密码 ${pwdOf(row.head)} | ${deputyLine}`)
    }
    if (pwdArg) console.log(`\n提示：以上为统一初始密码 ${pwdArg}`)
    if (phoneSuffixPwd) console.log('\n提示：初始密码为各账号手机号后 8 位')
  } finally {
    await pool.end()
  }
}

void main()
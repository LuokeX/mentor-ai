/**
 * 单账号开通（目标库由 DATABASE_URL 决定：正式 127.0.0.1:5433 / 测试 5435 / 本地 5434）
 *
 * 用法：
 *   # dry-run（默认，不写库），显式指定正式库
 *   DATABASE_URL=postgres://mentor_app:***@127.0.0.1:5433/mentor_ai \
 *     pnpm tsx scripts/create-account.ts --name 示例教师 --phone 13800000001 --role teacher --phone-suffix
 *
 *   # 实际开通：在 dry-run 输出确认无误后追加 --apply
 *   DATABASE_URL=postgres://mentor_app:***@127.0.0.1:5433/mentor_ai \
 *     pnpm tsx scripts/create-account.ts --name 示例教师 --phone 13800000001 --role teacher --phone-suffix --apply
 *
 *   # 一人多角色：--roles 逗号分隔，第一个为主角色
 *   pnpm tsx scripts/create-account.ts --name 示例双角色 --phone 13800000002 \
 *     --roles teacher,school_admin --random --apply
 *
 *   # 带学部的角色（如学部校长）：--section 写入角色级 scope
 *   pnpm tsx scripts/create-account.ts --name 示例学部校长 --phone 13800000003 \
 *     --roles division_principal --section junior --random --apply
 *
 *   # 学校管理员（学校级管理账号；含账号开通与平台使用量看板，一校可多个）
 *   pnpm tsx scripts/create-account.ts --name 示例学校管理员 --phone 13800000004 \
 *     --role school_admin --school llschool-junior --random --apply
 *
 * 参数：
 *   --name <姓名>         必填
 *   --phone <手机号>      必填，1 开头 11 位
 *   --role <角色>         单个角色（与 --roles 二选一），默认 teacher
 *   --roles <角色列表>    逗号分隔的多个角色（如 teacher,school_admin）；第一个为主角色
 *                         取值以 roles 目录表为准，脚本不写死角色清单
 *   --section <学部>      可选：primary | junior | senior | repeat，作为角色级 scope 写入
 *                         （RoleScope.section，如学部校长所辖学部）；未指定则不写 scope
 *   --scope-grade <年级>  可选：1-12，作为角色级 scope 写入（RoleScope.grade，
 *                         如年级主任只看所辖年级）；未指定则不写 scope
 *   --school <学校 code>  默认 llschool（六力学校，现为「未分配账号」容器校）；
 *                         学部即学校：小学部 llschool-primary / 初中部 llschool-junior / 高中部 llschool-senior
 *   --password <初始密码> / --random（随机 16 位） / --phone-suffix（手机号后 8 位），
 *                         三选一，都不给时按随机 16 位处理
 *   --grades <年级>       可选，逗号分隔（如 7,8），对应 teaching_grades
 *   --class-teacher       可选，标记为班主任（is_class_teacher=true）
 *   --apply               写库（缺省为 dry-run）
 *
 * 口径对齐 server/api/v1/school-admin/users.post.ts：argon2id 密码哈希、phoneEnc 加密、
 * status=active 创建即可登录、单事务写审计（actor=平台管理员）。
 * 角色写入统一走 server/domain/user-roles.ts 的 applyUserRoles，
 * 保证「主角色 ∈ 角色集合」这个不变量。
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { randomInt } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { AppRole } from '../app/composables/useAuth'
import * as schema from '../server/db/schema'
import { applyUserRoles, listUserRoles } from '../server/domain/user-roles'
import { decryptSensitive, encryptSensitive } from '../server/utils/crypto'
import type { RoleScope } from '../shared/management'
import { SCHOOL_SECTIONS } from '../shared/school-section'
import { loadLocalEnv } from './load-env'

/** --section 允许的取值：all（全学部）等价于不写 scope，CLI 只接受具体学部 */
const SECTION_VALUES = SCHOOL_SECTIONS.filter(section => section !== 'all')

const PHONE_RE = /^1\d{10}$/
const ROLE_CODE_RE = /^[a-z][a-z0-9_]*$/

/** 16 位混合字符随机密码：保证含大写、小写、数字、符号各一个，去除易混淆字符 */
function generateRandomPassword() {
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

function argValue(args: string[], name: string) {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

/**
 * 解析角色集合：--role 与 --roles 二选一，都不给时默认 teacher。
 * 第一个是主角色（写回 users.role）。角色编码是否真实存在由 roles 目录表校验，
 * 这里只做格式检查，便于新角色登记后无需改脚本。
 */
function parseRoleCodes(args: string[]): AppRole[] {
  const single = argValue(args, '--role')?.trim()
  const multiple = argValue(args, '--roles')?.trim()
  if (single && multiple) throw new Error('--role 与 --roles 只能二选一（--role 是单角色简写）')
  const codes = [...new Set((multiple ?? single ?? 'teacher').split(',').map(token => token.trim()).filter(Boolean))]
  if (!codes.length) throw new Error('--roles 需要至少一个角色编码')
  const invalid = codes.find(code => !ROLE_CODE_RE.test(code))
  if (invalid) throw new Error(`角色编码格式不正确：${invalid}`)
  return codes as AppRole[]
}

/** 打印目标库概要（不输出口令），写库前用于人工确认 */
function describeTarget(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}（user=${decodeURIComponent(parsed.username)}）`
  } catch {
    return '（DATABASE_URL 无法解析）'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const randomPwd = args.includes('--random')
  const phoneSuffixPwd = args.includes('--phone-suffix')
  const pwdArg = argValue(args, '--password')
  const name = argValue(args, '--name')?.trim()
  const phone = argValue(args, '--phone')?.trim()
  const roleCodes = parseRoleCodes(args)
  const primaryRole = roleCodes[0]!
  const sectionArg = argValue(args, '--section')?.trim()
  const scopeGradeArg = argValue(args, '--scope-grade')?.trim()
  const schoolCode = argValue(args, '--school') ?? 'llschool'
  const gradesArg = argValue(args, '--grades')
  const isClassTeacher = args.includes('--class-teacher')

  if (!name) throw new Error('缺少 --name')
  if (!phone || !PHONE_RE.test(phone)) throw new Error('--phone 需为 1 开头的 11 位手机号')
  if (sectionArg && !(SECTION_VALUES as readonly string[]).includes(sectionArg)) {
    throw new Error(`--section 仅支持 ${SECTION_VALUES.join(' / ')}`)
  }
  const pwdModes = [randomPwd, phoneSuffixPwd, pwdArg !== undefined].filter(Boolean).length
  if (pwdModes > 1) throw new Error('--password / --random / --phone-suffix 只能选一个（都不给则随机 16 位）')
  if (pwdArg !== undefined && pwdArg.length < 8) throw new Error('初始密码长度至少 8 位')
  const teachingGrades = gradesArg
    ? gradesArg.split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x) && x >= 1 && x <= 12)
    : []
  if (gradesArg && teachingGrades.length === 0) throw new Error('--grades 需为 1-12 的整数，逗号分隔')

  const password = pwdArg ?? (phoneSuffixPwd ? phone.slice(-8) : generateRandomPassword())
  // 角色级 scope：指定 --section 时写入集合内每个角色（本期只有学部校长这类角色消费它，
  // 其余角色带 scope 无副作用）；未指定时保持空 scope
  const scopeGrade = scopeGradeArg ? Number(scopeGradeArg) : undefined
  if (scopeGradeArg && (!Number.isInteger(scopeGrade) || scopeGrade! < 1 || scopeGrade! > 12)) {
    throw new Error('--scope-grade 仅支持 1-12 的年级')
  }
  const roleScopes: Partial<Record<AppRole, RoleScope>> = {}
  if (sectionArg || scopeGrade) {
    for (const code of roleCodes) {
      roleScopes[code] = {
        ...(sectionArg ? { section: sectionArg } : {}),
        ...(scopeGrade ? { grade: scopeGrade } : {})
      }
    }
  }

  loadLocalEnv()
  const databaseUrl = process.env.DATABASE_URL
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required')

  console.log(`目标库：${describeTarget(databaseUrl)}`)
  console.log(`开通计划：${name}（${phone}）→ 学校 code=${schoolCode}；teachingGrades=${JSON.stringify(teachingGrades)}；isClassTeacher=${isClassTeacher}`)
  console.log(`角色集合：${roleCodes.join(', ')}；主角色=${primaryRole}（--role/--roles 的第一个，也是登录后的缺省落地角色）`)
  console.log(sectionArg || scopeGrade
    ? `角色 scope：${roleCodes.map(code => `${code} → ${JSON.stringify(roleScopes[code])}`).join('；')}`
    : '角色 scope：无（未指定 --section）')
  console.log(`密码策略：${pwdArg ? '指定密码' : phoneSuffixPwd ? '手机号后 8 位' : '随机 16 位'}`)

  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  try {
    const [school] = await db.select({ id: schema.schools.id, name: schema.schools.name }).from(schema.schools)
      .where(eq(schema.schools.code, schoolCode)).limit(1)
    if (!school) throw new Error(`未找到学校 code=${schoolCode}`)

    // 角色编码校验：以 roles 目录表为准，脚本不写死角色清单（新角色登记后即可使用）
    const catalog = await db.select({ code: schema.roles.code }).from(schema.roles)
    const knownRoles = new Set(catalog.map(row => row.code))
    const unknownRoles = roleCodes.filter(code => !knownRoles.has(code))
    if (unknownRoles.length) {
      throw new Error(`roles 目录中不存在这些角色：${unknownRoles.join('、')}（可选：${[...knownRoles].sort().join(', ')}）`)
    }

    // 审计 actor 沿用既有账号导入口径：平台管理员
    const [admin] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.phone, '13800000000')).limit(1)
    if (!admin) throw new Error('未找到平台管理员账号（13800000000）')

    const [existing] = await db.select({
      id: schema.users.id, name: schema.users.name, role: schema.users.role, status: schema.users.status, schoolId: schema.users.schoolId
    }).from(schema.users).where(eq(schema.users.phone, phone)).limit(1)
    if (existing) {
      throw new Error(`手机号 ${phone} 已存在账号：${existing.name}（${existing.role}/${existing.status}，school=${existing.schoolId}），已终止`)
    }

    const sameName = await db.select({ name: schema.users.name, role: schema.users.role }).from(schema.users)
      .where(eq(schema.users.schoolId, school.id))
    const dupNames = sameName.filter(u => u.name === name)
    if (dupNames.length) console.log(`[提示] 该校已存在同名账号 ${dupNames.length} 个（${dupNames.map(u => u.role).join('/')}），请确认是否为同一人`)

    if (!apply) {
      console.log(`\ndry-run（未写库）：将在「${school.name}」创建 1 个账号，角色集合 [${roleCodes.join(', ')}]（主角色 ${primaryRole}），status=active 且创建后可直接登录。`)
      console.log(sectionArg || scopeGrade
        ? `将写入 user_roles.scope：${JSON.stringify(roleScopes)}（--section / --scope-grade 作用于集合内每个角色）`
        : '将写入 user_roles.scope：{}（未指定 --section）')
      console.log('确认无误后追加 --apply 执行。')
      return
    }

    const now = new Date()
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    const created = await db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        schoolId: school.id,
        name,
        phone,
        role: primaryRole,
        status: 'active',
        passwordHash,
        activatedAt: now,
        phoneEnc: encryptSensitive(phone, encryptionKey),
        teachingGrades,
        isClassTeacher
      }).returning({ id: schema.users.id })
      if (!user) throw new Error('账号创建失败')
      // 角色集合与 scope：users.role 已写入主角色，user_roles 由收口模块补齐并校验不变量
      await applyUserRoles(tx, { userId: user.id, roleCodes, primaryRole, scopes: roleScopes })
      await tx.insert(schema.auditLogs).values({
        schoolId: school.id,
        actorId: admin.id,
        action: 'school_admin.user.create',
        targetType: 'user',
        targetId: user.id,
        result: 'success',
        metadata: {
          role: primaryRole,
          roles: roleCodes,
          scopes: roleScopes,
          source: 'create-account-script',
          passwordProvided: true,
          activatedExistingInvitation: false,
          operator: admin.name
        }
      })
      return user
    })

    // 落库后自检：手机号可解密回原值、密码哈希可校验、角色集合与主角色一致
    const [check] = await db.select({
      id: schema.users.id, name: schema.users.name, phone: schema.users.phone, phoneEnc: schema.users.phoneEnc,
      role: schema.users.role, status: schema.users.status, passwordHash: schema.users.passwordHash, schoolId: schema.users.schoolId
    }).from(schema.users).where(eq(schema.users.id, created.id)).limit(1)
    if (!check) throw new Error('落库校验失败：未读到新建账号')
    const decrypted = decryptSensitive(check.phoneEnc, encryptionKey)
    const pwdOk = await argon2.verify(check.passwordHash!, password)
    const roleRows = await listUserRoles(db, check.id)
    const primaryOk = roleRows.some(entry => entry.roleCode === check.role)

    console.log('\n开通完成：')
    console.log(`  账号 ID：${check.id}`)
    console.log(`  姓名/手机号：${check.name} / ${check.phone}（phoneEnc 解密校验：${decrypted === phone ? '通过' : '不通过'}）`)
    console.log(`  主角色/状态：${check.role} / ${check.status}（学校：${school.name}）`)
    console.log(`  角色集合：${roleRows.map(entry => Object.keys(entry.scope).length ? `${entry.roleCode}（scope=${JSON.stringify(entry.scope)}）` : entry.roleCode).join('、')}（主角色一致性：${primaryOk ? '通过' : '不通过'}）`)
    console.log(`  密码校验：${pwdOk ? '通过' : '不通过'}`)
    console.log(`  初始密码：${pwdArg ? '（管理员指定）' : password}   ← 仅本次输出，请安全转交并提醒首次登录后修改`)
    console.log('  审计：已将 school_admin.user.create 写入 audit_logs（actor=平台管理员，含角色集合与 scope）')
  } finally {
    await pool.end()
  }
}

void main()

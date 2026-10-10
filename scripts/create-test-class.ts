/**
 * 为教师创建测试班级（目标库由 DATABASE_URL 决定：正式 127.0.0.1:5433 / 测试 5435 / 本地 5434）
 *
 * 命名与字段口径对齐库里既有测试班级（如「一年级十一班-测试」「七年级十二班-测试」「高一五班-测试」）：
 *   name = <年级中文><该年级下一个未占用的中文序号>班-测试
 *   class_type=admin、section 按年级折算、student_count=0、school_year/established_at/location 等留空
 *
 * 用法：
 *   # dry-run（默认，不写库）
 *   DATABASE_URL=postgres://mentor_app:***@127.0.0.1:5433/mentor_ai \
 *     pnpm tsx scripts/create-test-class.ts --teacher 13800000001 --grade 7 --sync-profile
 *
 *   # 实际创建：dry-run 输出确认无误后追加 --apply
 *   DATABASE_URL=postgres://mentor_app:***@127.0.0.1:5433/mentor_ai \
 *     pnpm tsx scripts/create-test-class.ts --teacher 13800000001 --grade 7 --sync-profile --apply
 *
 * 参数：
 *   --teacher <手机号>  必填，班级负责人（owner）的手机号
 *   --grade <1-12>      必填，班级年级（决定班级名、section）
 *   --deputy <手机号>   可选，副班主任
 *   --sync-profile      同时把该教师任教年级设为该年级并标记为班主任（is_class_teacher=true）
 *   --apply             写库（缺省为 dry-run）
 *
 * 写入口径对齐 server/api/v1/school-admin/classes/index.post.ts：单事务插入班级 + 审计
 * （actor=平台管理员）；有 --sync-profile 时在同一事务内更新教师档案并追加一条 user.update 审计。
 */
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { schoolSectionOfGrade } from '../shared/school-section'
import { auditLogs, classes, schools, users } from '../server/db/schema'
import { loadLocalEnv } from './load-env'

const PHONE_RE = /^1\d{10}$/

/** 年级 → 班级名前缀：1-6 一年级…六年级，7-9 七年级…九年级，10-12 高一…高三 */
function gradeLabel(grade: number) {
  const chinese = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (grade >= 1 && grade <= 9) return `${chinese[grade]}年级`
  return `高${chinese[grade - 9]}`
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CN_VALUES: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17, 十八: 18, 十九: 19
}

/** 数字 → 中文序号（覆盖 1-30，够班级序号用） */
function toChineseNumeral(value: number): string {
  if (value < 10) return CN_DIGITS[value]!
  if (value === 10) return '十'
  if (value < 20) return `十${CN_DIGITS[value - 10]}`
  if (value % 10 === 0) return `${CN_DIGITS[Math.floor(value / 10)]}十`
  return `${CN_DIGITS[Math.floor(value / 10)]}十${CN_DIGITS[value % 10]}`
}

/** 从既有班名尾部解析中文序号：'七年级十三班-测试' → 13；无法解析返回 null */
function parseClassNumeral(name: string): number | null {
  const matched = /([一二三四五六七八九十]+)班-测试$/.exec(name.trim())
  if (!matched) return null
  return CN_VALUES[matched[1]!] ?? null
}

function argValue(args: string[], name: string) {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
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
  const syncProfile = args.includes('--sync-profile')
  const teacherPhone = argValue(args, '--teacher')?.trim()
  const deputyPhone = argValue(args, '--deputy')?.trim()
  const grade = Number(argValue(args, '--grade'))

  if (!teacherPhone || !PHONE_RE.test(teacherPhone)) throw new Error('--teacher 需为 1 开头的 11 位手机号')
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) throw new Error('--grade 需为 1-12 的整数')
  if (deputyPhone && !PHONE_RE.test(deputyPhone)) throw new Error('--deputy 需为 1 开头的 11 位手机号')
  const section = schoolSectionOfGrade(grade)
  if (!section) throw new Error(`年级 ${grade} 无法折算学段`)

  loadLocalEnv()
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  console.log(`目标库：${describeTarget(databaseUrl)}`)

  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool)

  try {
    const [teacher] = await db.select({
      id: users.id, name: users.name, role: users.role, status: users.status, schoolId: users.schoolId
    }).from(users).where(eq(users.phone, teacherPhone)).limit(1)
    if (!teacher) throw new Error(`未找到手机号 ${teacherPhone} 的账号`)
    if (teacher.status !== 'active') throw new Error(`账号 ${teacher.name} 状态为 ${teacher.status}，不能作为班级负责人`)
    if (!teacher.schoolId) throw new Error(`账号 ${teacher.name} 未关联学校`)

    const [school] = await db.select({ id: schools.id, name: schools.name }).from(schools)
      .where(eq(schools.id, teacher.schoolId)).limit(1)
    if (!school) throw new Error('未找到教师所属学校')

    let deputyId: string | null = null
    if (deputyPhone) {
      const [deputy] = await db.select({
        id: users.id, name: users.name, status: users.status, schoolId: users.schoolId
      }).from(users).where(eq(users.phone, deputyPhone)).limit(1)
      if (!deputy) throw new Error(`未找到手机号 ${deputyPhone} 的副班主任账号`)
      if (deputy.schoolId !== school.id) throw new Error(`副班主任 ${deputy.name} 不属于同一学校`)
      deputyId = deputy.id
    }

    const [admin] = await db.select({ id: users.id, name: users.name }).from(users)
      .where(eq(users.phone, '13800000000')).limit(1)
    if (!admin) throw new Error('未找到平台管理员账号（13800000000）')

    // 既有测试班级：解析同年级已用序号，取下一个（口径：八、九、十、十一…递增）
    const testClasses = await db.select({ name: classes.name }).from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.grade, grade)))
    const used = testClasses.map(c => parseClassNumeral(c.name)).filter((n): n is number => n !== null)
    const nextNumeral = (used.length ? Math.max(...used) : 7) + 1
    const className = `${gradeLabel(grade)}${toChineseNumeral(nextNumeral)}班-测试`

    const [nameHit] = await db.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.name, className))).limit(1)
    if (nameHit) throw new Error(`班级名「${className}」已存在`)

    const existingOwned = await db.select({ name: classes.name }).from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.ownerUserId, teacher.id)))
    if (existingOwned.length) {
      console.log(`[提示] 该教师已是 ${existingOwned.map(c => `「${c.name}」`).join('、')} 的负责人，请确认是否再建一个测试班级`)
    }

    console.log(`开通计划：${teacher.name}（${teacherPhone}）→ 班级「${className}」`)
    console.log(`  年级 ${grade} / 学段 ${section} / class_type=admin / student_count=0 / 副班主任 ${deputyPhone ?? '无'}`)
    console.log(`  同年级测试班级已用序号：${used.length ? used.sort((a, b) => a - b).join('、') : '（无）'}`)
    if (syncProfile) console.log(`  同步档案：teaching_grades=[${grade}]、is_class_teacher=true`)

    if (!apply) {
      console.log('\ndry-run（未写库）。确认无误后追加 --apply 执行。')
      return
    }

    const now = new Date()
    const created = await db.transaction(async (tx) => {
      const [klass] = await tx.insert(classes).values({
        schoolId: school.id,
        ownerUserId: teacher.id,
        deputyOwnerUserId: deputyId,
        name: className,
        grade,
        section,
        classType: 'admin',
        studentCount: 0,
        status: 'active'
      }).returning({ id: classes.id, name: classes.name })
      if (!klass) throw new Error('班级创建失败')
      await tx.insert(auditLogs).values({
        schoolId: school.id,
        actorId: admin.id,
        action: 'school_admin.class.create',
        targetType: 'class',
        targetId: klass.id,
        result: 'success',
        metadata: { ownerUserId: teacher.id, departmentId: null, source: 'create-test-class-script' }
      })
      if (syncProfile) {
        await tx.update(users).set({
          teachingGrades: [grade],
          isClassTeacher: true,
          updatedAt: now
        }).where(eq(users.id, teacher.id))
        await tx.insert(auditLogs).values({
          schoolId: school.id,
          actorId: admin.id,
          action: 'school_admin.user.update',
          targetType: 'user',
          targetId: teacher.id,
          result: 'success',
          metadata: {
            changedFields: ['teachingGrades', 'isClassTeacher'],
            source: 'create-test-class-script'
          }
        })
      }
      return klass
    })

    // 落库后自检
    const [check] = await db.select({
      id: classes.id, name: classes.name, grade: classes.grade, section: classes.section,
      classType: classes.classType, status: classes.status, ownerUserId: classes.ownerUserId,
      deputyOwnerUserId: classes.deputyOwnerUserId, studentCount: classes.studentCount,
      schoolYear: classes.schoolYear, location: classes.location, establishedAt: classes.establishedAt
    }).from(classes).where(eq(classes.id, created.id)).limit(1)
    if (!check) throw new Error('落库校验失败：未读到新建班级')
    const [profile] = await db.select({
      teachingGrades: users.teachingGrades, isClassTeacher: users.isClassTeacher
    }).from(users).where(eq(users.id, teacher.id)).limit(1)

    console.log('\n创建完成：')
    console.log(`  班级 ID：${check.id}`)
    console.log(`  班级名：${check.name}（年级 ${check.grade} / 学段 ${check.section} / ${check.classType} / ${check.status}）`)
    console.log(`  负责人：${teacher.name}（${teacherPhone}）；副班主任：${check.deputyOwnerUserId ? deputyPhone : '无'}`)
    console.log(`  学生数 ${check.studentCount}；school_year=${check.schoolYear ?? '空'}；location=${check.location ?? '空'}；established_at=${check.establishedAt ?? '空'}`)
    console.log(`  教师档案：teaching_grades=${JSON.stringify(profile?.teachingGrades ?? [])}、is_class_teacher=${profile?.isClassTeacher}`)
    console.log('  审计：school_admin.class.create' + (syncProfile ? ' + school_admin.user.update' : '') + '（actor=平台管理员）')
  } finally {
    await pool.end()
  }
}

void main()

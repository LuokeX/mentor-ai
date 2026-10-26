/**
 * 一次性迁移：把「六力学校」按学部拆成三所独立学校（六力学校-小学部 / 初中部 / 高中部）。
 *
 * 背景：组织模型是「学部与学校同级」——每个学部在平台里就是一所独立学校（各自的班级、
 * 教师、管理员与业务数据），而不是一所学校内部的 section。迁移后每所学校的看板都按
 * 「本校全部班级」取数。
 *
 * 迁移规则：
 *  1. 班级：`classes.section` 判定学部；为空时按 `grade` 折算（1-6 小学 / 7-9 初中 / 10-12 高中）。
 *  2. 教师：优先按负责或副负责的班级，其次按负责学生所在班级，最后按 `teaching_grades`；
 *     三者都判断不出的账号留在原校（原校保留为「未分配」容器，账号仍可正常登录）。
 *  3. 业务数据：按 owner / 学生 / 班级归属随人一起迁移（对话、方案、评估、通知、产品事件、
 *     安全事件、转介、家校沟通、班级事件、奖励与执行项等）；审计日志与管理员授权记录留档不迁。
 *  4. 账号：小学部/初中部校长、心理专员、学校管理员随对应学部迁入；初中部/高中部管理员与
 *     高中部校长按需新建（初始密码 = 手机号后 8 位）。三所学校的校长都不再配置学部 scope，
 *     直接看本校全部班级。
 *
 * 用法：
 *   pnpm tsx scripts/split-schools-by-section.ts             # dry-run（默认，只打印计划）
 *   pnpm tsx scripts/split-schools-by-section.ts --apply     # 写库（单事务）
 *   --source <code>   原校 code，默认 llschool
 *
 * 迁移前建议先备份开发库：
 *   docker exec mentor-ai-local-postgres-1 pg_dump -U mentor_app -d mentor_ai_dev > /tmp/mentor_ai_dev.bak.sql
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { applyUserRoles } from '../server/domain/user-roles'
import { encryptSensitive } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

type Section = 'primary' | 'junior' | 'senior'

interface TargetSpec {
  section: Section
  code: string
  name: string
  /** 需要迁入或新建的账号 */
  accounts: Array<{
    phone: string
    name: string
    role: 'division_principal' | 'school_admin'
    /** 已存在的账号迁移；不存在则新建 */
    create?: boolean
  }>
}

const TARGETS: TargetSpec[] = [
  {
    section: 'primary',
    code: 'llschool-primary',
    name: '六力学校-小学部',
    accounts: [
      { phone: '13800000001', name: '六力学校-小学部管理员', role: 'school_admin' },
      { phone: '13800001001', name: '六力学校-小学部校长', role: 'division_principal' }
    ]
  },
  {
    section: 'junior',
    code: 'llschool-junior',
    name: '六力学校-初中部',
    accounts: [
      { phone: '13800000011', name: '六力学校-初中部管理员', role: 'school_admin', create: true },
      { phone: '13800001002', name: '六力学校-初中部校长', role: 'division_principal' }
    ]
  },
  {
    section: 'senior',
    code: 'llschool-senior',
    name: '六力学校-高中部',
    accounts: [
      { phone: '13800000012', name: '六力学校-高中部管理员', role: 'school_admin', create: true },
      { phone: '13800001003', name: '六力学校-高中部校长', role: 'division_principal', create: true }
    ]
  }
]

/**
 * 心理专员随其服务的学部走：现存安全事件与转介绝大多数由初中部教师（张忠程等）触发，
 * 归入初中部；小学部的少量事件由该校管理员在设置里补配心理专员。
 */
const PSYCHOLOGIST_PHONE = '13800000002'
const PSYCHOLOGIST_TARGET: Section = 'junior'

/**
 * 手动指定的学部归属（手机号 → 学部）。
 * 16688096890（张忠程）同时挂着初中验收班级与一个小学测试班级，按人工判断归初中部；
 * 他名下的全部班级（含那个测试班级）一起过去，保证「班级负责教师与班级同校」。
 */
const USER_SECTION_OVERRIDES: Record<string, Section> = {
  '16688096890': 'junior'
}

/** 业务数据表：按表中的归属列把行迁到与 owner/班级/学生相同的学校。 */
const OWNED_TABLES: Array<{ table: string, columns: string[] }> = [
  { table: 'ai_model_calls', columns: ['owner_user_id'] },
  { table: 'assessment_attempts', columns: ['owner_user_id'] },
  { table: 'assessment_sessions', columns: ['owner_user_id'] },
  { table: 'assistant_feedback', columns: ['user_id'] },
  { table: 'chat_messages', columns: ['owner_user_id'] },
  { table: 'chat_sessions', columns: ['owner_user_id'] },
  { table: 'class_events', columns: ['owner_user_id', 'class_id'] },
  { table: 'communications', columns: ['owner_user_id', 'student_id'] },
  { table: 'guardians', columns: ['owner_user_id'] },
  { table: 'invitations', columns: ['user_id', 'invited_by'] },
  { table: 'notifications', columns: ['user_id'] },
  { table: 'plan_action_evidence', columns: ['owner_user_id'] },
  { table: 'plan_actions', columns: ['owner_user_id'] },
  { table: 'plan_feedback', columns: ['owner_user_id'] },
  { table: 'plan_operation_events', columns: ['owner_user_id'] },
  { table: 'plan_reviews', columns: ['owner_user_id'] },
  { table: 'plans', columns: ['owner_user_id', 'class_id', 'student_id'] },
  { table: 'product_events', columns: ['user_id'] },
  { table: 'record_assignments', columns: ['to_user_id', 'from_user_id', 'assigned_by'] },
  { table: 'referral_events', columns: ['actor_id'] },
  { table: 'referrals', columns: ['psychologist_id'] },
  { table: 'routing_decisions', columns: ['owner_user_id'] },
  { table: 'safety_events', columns: ['owner_user_id'] },
  { table: 'student_events', columns: ['owner_user_id', 'student_id'] },
  { table: 'students', columns: ['owner_user_id', 'class_id'] },
  { table: 'student_guardians', columns: ['student_id'] },
  { table: 'user_consents', columns: ['user_id'] }
]

const SECTION_GRADES: Record<Section, number[]> = {
  primary: [1, 2, 3, 4, 5, 6],
  junior: [7, 8, 9],
  senior: [10, 11, 12]
}

function sectionOf(input: { section: string | null, grade: number | null }): Section | null {
  const normalized = (input.section ?? '').trim()
  if (normalized === 'primary' || normalized === 'junior' || normalized === 'senior') return normalized
  if (input.grade === null) return null
  for (const [section, grades] of Object.entries(SECTION_GRADES) as Array<[Section, number[]]>) {
    if (grades.includes(input.grade)) return section
  }
  return null
}

function sectionsOfGrades(raw: unknown): Section[] {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? [])
  const numbers = text.replace(/[[\]{}"']/g, '').split(',').map(item => Number(item.trim())).filter(item => Number.isFinite(item))
  const set = new Set<Section>()
  for (const grade of numbers) {
    const section = sectionOf({ section: null, grade })
    if (section) set.add(section)
  }
  return [...set]
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const sourceCode = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'llschool'
  loadLocalEnv()
  const databaseUrl = process.env.DATABASE_URL
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required')

  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })
  console.log(`目标库：${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)
  console.log(`模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（只打印计划）'}；原校 code=${sourceCode}`)

  try {
    const [source] = await db.select().from(schema.schools).where(eq(schema.schools.code, sourceCode)).limit(1)
    if (!source) throw new Error(`原校不存在：${sourceCode}`)
    console.log(`原校：${source.name}（${source.id}）`)

    const allClasses = await db.select({
      id: schema.classes.id,
      name: schema.classes.name,
      grade: schema.classes.grade,
      section: schema.classes.section,
      ownerUserId: schema.classes.ownerUserId,
      deputyOwnerUserId: schema.classes.deputyOwnerUserId,
      schoolId: schema.classes.schoolId
    }).from(schema.classes).where(inArray(schema.classes.schoolId, [source.id]))

    const allStudents = await db.select({
      id: schema.students.id,
      classId: schema.students.classId,
      ownerUserId: schema.students.ownerUserId
    }).from(schema.students).where(eq(schema.students.schoolId, source.id))

    const teacherRoles = await db.select({ userId: schema.userRoles.userId })
      .from(schema.userRoles).where(eq(schema.userRoles.roleCode, 'teacher'))
    const teacherIds = new Set(teacherRoles.map(row => row.userId))

    const allUsers = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      phone: schema.users.phone,
      teachingGrades: schema.users.teachingGrades
    }).from(schema.users).where(eq(schema.users.schoolId, source.id))

    // 班级 → 学部
    const overrideByUserId = new Map<string, Section>()
    for (const user of allUsers) {
      const override = USER_SECTION_OVERRIDES[user.phone]
      if (override) overrideByUserId.set(user.id, override)
    }
    const classTarget = new Map<string, Section>()
    const unattributedClasses: typeof allClasses = []
    const overriddenClasses: typeof allClasses = []
    for (const item of allClasses) {
      const ownerOverride = item.ownerUserId ? overrideByUserId.get(item.ownerUserId) : undefined
      const section = ownerOverride ?? sectionOf({ section: item.section, grade: item.grade })
      if (!section) unattributedClasses.push(item)
      else {
        classTarget.set(item.id, section)
        const natural = sectionOf({ section: item.section, grade: item.grade })
        if (ownerOverride && natural !== ownerOverride) overriddenClasses.push(item)
      }
    }

    // 学生 → 学部（跟随其班级）
    const studentTarget = new Map<string, Section>()
    for (const student of allStudents) {
      const section = student.classId ? classTarget.get(student.classId) : undefined
      if (section) studentTarget.set(student.id, section)
    }
    const unattributedStudents = allStudents.filter(item => !studentTarget.has(item.id))

    // 人员 → 学部
    const classesByUser = new Map<string, Array<{ section: Section, id: string }>>()
    for (const item of allClasses) {
      const section = classTarget.get(item.id)
      if (!section) continue
      for (const userId of [item.ownerUserId, item.deputyOwnerUserId]) {
        if (!userId) continue
        const entry = classesByUser.get(userId) ?? []
        entry.push({ section, id: item.id })
        classesByUser.set(userId, entry)
      }
    }
    const studentsByUser = new Map<string, Section[]>()
    for (const student of allStudents) {
      const section = studentTarget.get(student.id)
      if (!section || !student.ownerUserId) continue
      const entry = studentsByUser.get(student.ownerUserId) ?? []
      entry.push(section)
      studentsByUser.set(student.ownerUserId, entry)
    }

    const userTarget = new Map<string, Section>()
    const unresolved: Array<{ id: string, name: string, phone: string }> = []
    for (const user of allUsers) {
      if (!teacherIds.has(user.id)) continue
      const override = overrideByUserId.get(user.id)
      if (override) {
        userTarget.set(user.id, override)
        continue
      }
      const fromClasses = new Set((classesByUser.get(user.id) ?? []).map(item => item.section))
      let section: Section | null = fromClasses.size === 1 ? [...fromClasses][0]! : null
      if (!section) {
        const fromStudents = new Set(studentsByUser.get(user.id) ?? [])
        if (fromStudents.size === 1) section = [...fromStudents][0]!
      }
      if (!section) {
        const fromGrades = sectionsOfGrades(user.teachingGrades)
        if (fromGrades.length === 1) section = fromGrades[0]!
      }
      if (section) userTarget.set(user.id, section)
      else unresolved.push({ id: user.id, name: user.name, phone: user.phone })
    }

    // 账号迁移（管理员/校长/心理专员）
    const accountMoves: Array<{ phone: string, name: string, role: string, section: Section, existing: boolean }> = []
    for (const target of TARGETS) {
      for (const account of target.accounts) {
        const [existing] = await db.select({ id: schema.users.id, name: schema.users.name, schoolId: schema.users.schoolId })
          .from(schema.users).where(eq(schema.users.phone, account.phone)).limit(1)
        if (!existing && !account.create) throw new Error(`账号不存在且未标记新建：${account.phone}（${account.name}）`)
        accountMoves.push({ phone: account.phone, name: account.name, role: account.role, section: target.section, existing: Boolean(existing) })
      }
    }
    const [psychologist] = await db.select({ id: schema.users.id, name: schema.users.name, phone: schema.users.phone })
      .from(schema.users).where(eq(schema.users.phone, PSYCHOLOGIST_PHONE)).limit(1)
    if (psychologist) {
      accountMoves.push({ phone: psychologist.phone, name: psychologist.name, role: 'psychologist', section: PSYCHOLOGIST_TARGET, existing: true })
    }

    const staffMoves = new Map<string, Section>()
    for (const move of accountMoves) {
      const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, move.phone)).limit(1)
      if (user) staffMoves.set(user.id, move.section)
    }

    // 计划输出
    console.log('\n=== 迁移计划 ===')
    for (const target of TARGETS) {
      const classes = allClasses.filter(item => classTarget.get(item.id) === target.section)
      const students = allStudents.filter(item => studentTarget.get(item.id) === target.section)
      const users = [...userTarget.entries()].filter(([, section]) => section === target.section).map(([id]) => id)
      const accounts = accountMoves.filter(item => item.section === target.section)
      console.log(`\n${target.name}（${target.code}）`)
      const gradeLabels = [...new Set(classes.map(item => `${item.grade}年级`))].sort()
      console.log(`  班级 ${classes.length} 个（${gradeLabels.join('/') || '—'}）`)
      console.log(`  教师 ${users.length} 人；学生 ${students.length} 人`)
      console.log(`  账号：${accounts.map(item => `${item.name}(${item.phone}, ${item.role}${item.existing ? ', 迁移' : ', 新建'})`).join('；') || '—'}`)
    }
    const leftoverAccounts = allUsers.filter(item => !userTarget.has(item.id) && !accountMoves.some(move => move.phone === item.phone))
    console.log(`\n留在原校的账号 ${leftoverAccounts.length} 个（未分配学部，原校保留为容器）：`)
    console.log(`  ${leftoverAccounts.map(item => `${item.name}(${item.phone})`).join('、')}`)
    if (unattributedClasses.length) console.log(`\n无法判定学部的班级 ${unattributedClasses.length} 个：${unattributedClasses.map(item => item.name).join('、')}`)
    if (overriddenClasses.length) {
      console.log(`\n按人工指定随负责教师迁移的班级 ${overriddenClasses.length} 个：`)
      const names = new Map(allUsers.map(item => [item.id, item.name]))
      for (const item of overriddenClasses) {
        console.log(`  ${item.name}（${item.grade}年级 → ${classTarget.get(item.id)}，负责教师 ${names.get(item.ownerUserId) ?? item.ownerUserId}）`)
      }
    }
    if (unattributedStudents.length) console.log(`无法判定学部的学生 ${unattributedStudents.length} 个：${unattributedStudents.map(item => item.id).join('、')}`)

    // 跨校副班主任提示
    const deputyConflicts = allClasses.filter((item) => {
      if (!item.deputyOwnerUserId) return false
      const classSection = classTarget.get(item.id)
      const deputySection = userTarget.get(item.deputyOwnerUserId)
      return classSection && deputySection !== classSection
    })
    if (deputyConflicts.length) {
      console.log(`\n副班主任与班级学部不一致的班级 ${deputyConflicts.length} 个（迁移时清空副班主任）：${deputyConflicts.map(item => item.name).join('、')}`)
    }

    const perTableCounts: Array<{ table: string, section: Section, count: number }> = []
    const userIdsOf = (section: Section) => [
      ...[...userTarget.entries()].filter(([, item]) => item === section).map(([id]) => id),
      ...[...staffMoves.entries()].filter(([, item]) => item === section).map(([id]) => id)
    ]
    for (const target of TARGETS) {
      const userIds = userIdsOf(target.section)
      const classIds = allClasses.filter(item => classTarget.get(item.id) === target.section).map(item => item.id)
      const studentIds = allStudents.filter(item => studentTarget.get(item.id) === target.section).map(item => item.id)
      for (const spec of OWNED_TABLES) {
        const conditions = spec.columns.map(column => {
          const ids = column === 'class_id' ? classIds : column === 'student_id' ? studentIds : userIds
          if (!ids.length) return null
          return sql`${sql.raw(column)} in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
        }).filter((item): item is ReturnType<typeof sql> => Boolean(item))
        if (!conditions.length) continue
        const where = sql.join(conditions, sql` or `)
        const result = await db.execute(sql`
          select count(*)::int as value from ${sql.raw(spec.table)}
          where school_id = ${source.id} and (${where})`)
        const count = Number((result.rows[0] as { value: number } | undefined)?.value ?? 0)
        if (count > 0) perTableCounts.push({ table: spec.table, section: target.section, count })
      }
      // 转介与外发队列跟随安全事件（教师）归属
      const userList = userIds.length ? sql`(${sql.join(userIds.map(id => sql`${id}`), sql`, `)})` : sql`(null)`
      const referralResult = await db.execute(sql`
        select count(*)::int as value from referrals r
        join safety_events se on se.id = r.safety_event_id
        where r.school_id = ${source.id} and se.owner_user_id in ${userList}`)
      const referralCount = Number((referralResult.rows[0] as { value: number } | undefined)?.value ?? 0)
      if (referralCount > 0) perTableCounts.push({ table: 'referrals（跟随安全事件）', section: target.section, count: referralCount })
      const outboxResult = await db.execute(sql`
        select count(*)::int as value from notification_outbox o
        join referrals r on r.id::text = o.payload->>'referralId'
        join safety_events se on se.id = r.safety_event_id
        where o.school_id = ${source.id} and se.owner_user_id in ${userList}`)
      const outboxCount = Number((outboxResult.rows[0] as { value: number } | undefined)?.value ?? 0)
      if (outboxCount > 0) perTableCounts.push({ table: 'notification_outbox', section: target.section, count: outboxCount })
    }
    console.log('\n按表迁移行数：')
    for (const target of TARGETS) {
      const rows = perTableCounts.filter(item => item.section === target.section)
      console.log(`  ${target.name}：${rows.map(item => `${item.table} ${item.count}`).join('； ') || '—'}`)
    }

    if (!apply) {
      console.log('\nDRY-RUN 结束；确认无误后加 --apply 写库。')
      return
    }

    // ===== 写库 =====
    await db.transaction(async (tx) => {
      const targetSchoolIds = new Map<Section, string>()
      for (const target of TARGETS) {
        let [school] = await tx.select().from(schema.schools).where(eq(schema.schools.code, target.code)).limit(1)
        if (!school) {
          [school] = await tx.insert(schema.schools).values({ name: target.name, code: target.code }).returning()
        }
        if (!school) throw new Error(`学校创建失败：${target.code}`)
        targetSchoolIds.set(target.section, school.id)
        const [settings] = await tx.select().from(schema.schoolSettings).where(eq(schema.schoolSettings.schoolId, school.id)).limit(1)
        if (!settings) {
          const [sourceSettings] = await tx.select().from(schema.schoolSettings).where(eq(schema.schoolSettings.schoolId, source.id)).limit(1)
          await tx.insert(schema.schoolSettings).values({
            schoolId: school.id,
            helpPhone: sourceSettings?.helpPhone ?? null,
            smsRecipients: sourceSettings?.smsRecipients ?? [],
            crisisGuide: sourceSettings?.crisisGuide ?? '请尽快联系校内心理专员，并按学校安全流程跟进。',
            safetyContactRecipients: sourceSettings?.safetyContactRecipients ?? [],
            aiDataMode: sourceSettings?.aiDataMode ?? 'redacted',
            aiApprovalReference: sourceSettings?.aiApprovalReference ?? null,
            aiNoticeVersion: sourceSettings?.aiNoticeVersion ?? 'pilot-v1',
            referralAckMinutes: sourceSettings?.referralAckMinutes ?? 5,
            referralEscalationMinutes: sourceSettings?.referralEscalationMinutes ?? 15
          })
        }
      }

      // 心理专员写入对应学校的设置（按手机号全局查，避免重跑时因为人已迁走而丢配置）
      const [psych] = await tx.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.phone, PSYCHOLOGIST_PHONE)).limit(1)
      console.log(`  心理专员：${psych?.id ? `${PSYCHOLOGIST_TARGET}（${PSYCHOLOGIST_PHONE}）` : '未找到账号，暂不配置'}`)
      for (const target of TARGETS) {
        const schoolId = targetSchoolIds.get(target.section)!
        await tx.update(schema.schoolSettings)
          .set({ referralPsychologistId: target.section === PSYCHOLOGIST_TARGET ? psych?.id ?? null : null, updatedAt: new Date() })
          .where(eq(schema.schoolSettings.schoolId, schoolId))
      }

      // 班级迁移（含清空跨学部副班主任）
      for (const target of TARGETS) {
        const schoolId = targetSchoolIds.get(target.section)!
        const classIds = allClasses.filter(item => classTarget.get(item.id) === target.section).map(item => item.id)
        if (classIds.length) {
          await tx.update(schema.classes).set({ schoolId, updatedAt: new Date() }).where(inArray(schema.classes.id, classIds))
        }
        const conflictIds = deputyConflicts.filter(item => classTarget.get(item.id) === target.section).map(item => item.id)
        if (conflictIds.length) {
          await tx.update(schema.classes).set({ deputyOwnerUserId: null, updatedAt: new Date() }).where(inArray(schema.classes.id, conflictIds))
        }
      }

      // 教师迁移
      for (const target of TARGETS) {
        const schoolId = targetSchoolIds.get(target.section)!
        const userIds = [...userTarget.entries()].filter(([, section]) => section === target.section).map(([id]) => id)
        if (userIds.length) {
          await tx.update(schema.users).set({ schoolId, updatedAt: new Date() }).where(inArray(schema.users.id, userIds))
        }
      }

      // 业务数据迁移（教师 + 随校迁入的管理员/校长/心理专员都算）
      for (const target of TARGETS) {
        const schoolId = targetSchoolIds.get(target.section)!
        const userIds = userIdsOf(target.section)
        const classIds = allClasses.filter(item => classTarget.get(item.id) === target.section).map(item => item.id)
        const studentIds = allStudents.filter(item => studentTarget.get(item.id) === target.section).map(item => item.id)
        for (const spec of OWNED_TABLES) {
          const conditions = spec.columns.map(column => {
            const ids = column === 'class_id' ? classIds : column === 'student_id' ? studentIds : userIds
            if (!ids.length) return null
            return sql`${sql.raw(column)} in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
          }).filter((item): item is ReturnType<typeof sql> => Boolean(item))
          if (!conditions.length) continue
          const where = sql.join(conditions, sql` or `)
          await tx.execute(sql`
            update ${sql.raw(spec.table)} set school_id = ${schoolId}
            where school_id = ${source.id} and (${where})`)
        }
        await tx.execute(sql`
          update notification_outbox set school_id = ${schoolId}
          where school_id = ${source.id} and payload->>'referralId' in (
            select id::text from referrals where school_id = ${schoolId}
          )`)
      }

      // 转介跟随其安全事件所在的学校（教师触发安全事件 → 转介应留在同一所学校）
      await tx.execute(sql`
        update referrals r set school_id = se.school_id
        from safety_events se
        where se.id = r.safety_event_id and r.school_id = ${source.id}`)
      // 外发队列再对齐一次（转介归属已在上面同步）
      for (const target of TARGETS) {
        const schoolId = targetSchoolIds.get(target.section)!
        await tx.execute(sql`
          update notification_outbox set school_id = ${schoolId}
          where school_id = ${source.id} and payload->>'referralId' in (
            select id::text from referrals where school_id = ${schoolId}
          )`)
      }

      // 账号迁移与新建
      for (const move of accountMoves) {
        const target = TARGETS.find(item => item.section === move.section)!
        const schoolId = targetSchoolIds.get(move.section)!
        const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, move.phone)).limit(1)
        if (existing) {
          await tx.update(schema.users)
            .set({ schoolId, name: move.name, updatedAt: new Date() })
            .where(eq(schema.users.id, existing.id))
          await applyUserRoles(tx, { userId: existing.id, roleCodes: [move.role], primaryRole: move.role as 'division_principal' | 'school_admin', schoolId })
        } else {
          const password = move.phone.slice(-8)
          const [created] = await tx.insert(schema.users).values({
            schoolId,
            name: move.name,
            phone: move.phone,
            phoneEnc: encryptSensitive(move.phone, encryptionKey),
            role: move.role,
            status: 'active',
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
            activatedAt: new Date()
          }).returning()
          if (!created) throw new Error(`账号创建失败：${move.phone}`)
          await applyUserRoles(tx, { userId: created.id, roleCodes: [move.role], primaryRole: move.role as 'division_principal' | 'school_admin', schoolId })
          console.log(`  新建账号：${move.name} ${move.phone} 初始密码 ${password}`)
        }
      }

      // 校长不再配置学部 scope：看本校全部班级（角色的 scope 只保留 grade 等其它键）
      const principalIds = accountMoves.filter(item => item.role === 'division_principal')
        .map(item => item.phone)
      if (principalIds.length) {
        const principals = await tx.select({ id: schema.users.id }).from(schema.users)
          .where(inArray(schema.users.phone, principalIds))
        for (const principal of principals) {
          const [row] = await tx.select({ scope: schema.userRoles.scope }).from(schema.userRoles)
            .where(inArray(schema.userRoles.userId, [principal.id])).limit(1)
          const scope = { ...(row?.scope ?? {}) }
          if ('section' in scope) delete (scope as { section?: string }).section
          await tx.update(schema.userRoles).set({ scope, updatedAt: new Date() })
            .where(inArray(schema.userRoles.userId, [principal.id]))
        }
      }

      // 迁移审计
      const [platformAdmin] = await tx.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.phone, '13800000000')).limit(1)
      await tx.insert(schema.auditLogs).values({
        actorId: platformAdmin?.id ?? null,
        schoolId: source.id,
        action: 'platform_admin.school.split_by_section',
        targetType: 'school',
        targetId: source.id,
        result: 'success',
        metadata: {
          source: source.code,
          targets: TARGETS.map(item => ({ code: item.code, name: item.name, schoolId: targetSchoolIds.get(item.section) })),
          classes: allClasses.length,
          teachers: userTarget.size,
          leftoverAccounts: leftoverAccounts.length
        }
      })
    })

    console.log('\n迁移完成。')
    console.log(`原校 ${source.name}（${source.code}）保留为未分配容器，班级与业务数据已全部迁出。`)
    console.log('下一步：pnpm tsx scripts/dashboard-smoke.ts 核对三所学校看板隔离。')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('迁移失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

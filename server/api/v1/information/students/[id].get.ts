import { and, desc, eq, inArray } from 'drizzle-orm'
import { apiContext } from '../../../../utils/handler'
import { uuidParam } from '../../../../utils/params'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { user, db, secret } = await apiContext(event, ['teacher'])
  const id = uuidParam(event, 'id')
  const [student] = await db.select().from(schema.students).where(and(
    eq(schema.students.id, id),
    eq(schema.students.ownerUserId, user.id),
    eq(schema.students.schoolId, user.schoolId!)
  )).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })

  const [klass, relations, communications, classOptions, guardianOptions, plans] = await Promise.all([
    student.classId ? db.select().from(schema.classes).where(and(
      eq(schema.classes.id, student.classId),
      eq(schema.classes.schoolId, user.schoolId!),
      eq(schema.classes.ownerUserId, user.id),
    )).limit(1) : Promise.resolve([]),
    db.select().from(schema.studentGuardians).where(and(
      eq(schema.studentGuardians.studentId, id),
      eq(schema.studentGuardians.schoolId, user.schoolId!),
      eq(schema.studentGuardians.status, 'active'),
    )),
    db.select().from(schema.communications).where(and(eq(schema.communications.studentId, id), eq(schema.communications.schoolId, user.schoolId!))).orderBy(desc(schema.communications.occurredAt)),
    db.select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade }).from(schema.classes).where(and(eq(schema.classes.ownerUserId, user.id), eq(schema.classes.schoolId, user.schoolId!))).orderBy(schema.classes.name),
    db.select().from(schema.guardians).where(and(eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.plans).where(and(eq(schema.plans.studentId, id), eq(schema.plans.ownerUserId, user.id), eq(schema.plans.schoolId, user.schoolId!))).orderBy(desc(schema.plans.updatedAt)).limit(20)
  ])
  // 班主任姓名：学生负责教师就是班主任（学生档案归属学校，负责教师可能不是班主任，取班级 owner）
  let classTeacherName: string | null = null
  if (klass[0]?.ownerUserId) {
    const [teacher] = await db.select({ name: schema.users.name }).from(schema.users).where(and(
      eq(schema.users.id, klass[0].ownerUserId),
      eq(schema.users.schoolId, user.schoolId!),
    )).limit(1)
    if (teacher) classTeacherName = teacher.name
  }
  const guardianIds = relations.map(relation => relation.guardianId)
  const linkedGuardians = guardianIds.length
    ? await db.select().from(schema.guardians).where(and(
        inArray(schema.guardians.id, guardianIds),
        eq(schema.guardians.schoolId, user.schoolId!),
        eq(schema.guardians.ownerUserId, user.id),
      ))
    : []
  const guardianById = new Map([...linkedGuardians, ...guardianOptions].map(row => [row.id, row]))
  const profileText = decryptSensitive(student.profileEnc, secret)
  const profile = profileText ? JSON.parse(profileText) : {}
  // 个体问题预警级别：只认 student_case 模块快照；learning_problem 等其他模块快照不覆盖 caseLevel（与列表口径一致）
  const studentSnapshot = (student.studentSnapshot as {
    module?: string
    levelName?: string
    attributions?: Array<{ code: string, name: string, rank: number } | string>
  } | null) ?? null
  return {
    student: {
      ...student,
      name: decryptSensitive(student.nameEnc, secret),
      profile,
      notes: decryptSensitive(student.notesEnc, secret),
      className: klass[0]?.name || null,
      classTeacherName,
      /** 个体问题预警级别（红色-紧急响应…紫色-待观察），来自 student_case 评估快照 */
      caseLevelName: studentSnapshot?.module === 'student_case'
        ? (studentSnapshot.levelName || student.caseLevel || null)
        : (student.caseLevel || null),
      /** 命中的五类十五型编码（按优先级排序），如 [{ code: 'A1', name: '注意力分散型' }] */
      caseCodes: (studentSnapshot?.attributions || [])
        .filter((a: any) => typeof a === 'string' || a.rank === 0 || a.rank === 1 || a.rank === 2)
        .map((a: any) => typeof a === 'string' ? ({ code: a, name: a }) : ({ code: a.code, name: a.name })),
      aiContext: { type: 'student', id: student.id, label: decryptSensitive(student.nameEnc, secret) },
      nameEnc: undefined,
      profileEnc: undefined,
      notesEnc: undefined,
      nameSearch: undefined
    },
    class: klass[0] || null,
    classOptions,
    guardianOptions: guardianOptions.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, secret), phone: decryptSensitive(row.phoneEnc, secret), nameEnc: undefined, phoneEnc: undefined, nameSearch: undefined })),
    guardians: linkedGuardians.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, secret), phone: decryptSensitive(row.phoneEnc, secret), nameEnc: undefined, phoneEnc: undefined, nameSearch: undefined })),
    communications: communications.map(row => {
      const guardian = row.guardianId ? guardianById.get(row.guardianId) : null
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, secret),
        guardianName: guardian ? decryptSensitive(guardian.nameEnc, secret) : null,
        relation: guardian?.relation || null,
        summaryEnc: undefined
      }
    }),
    plans: plans.map(row => {
      const report = row.report as any
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, secret),
        summaryEnc: undefined,
        riskLabel: report?.risk?.label,
        sourceLabel: row.sourceChatSessionId ? 'AI 咨询' : row.sourceAssessmentAttemptId ? '模块评估' : '手动记录'
      }
    })
  }
})

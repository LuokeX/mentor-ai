import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { decryptSensitive } from '../../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const [klass] = await db.select().from(schema.classes).where(and(
    eq(schema.classes.id, id),
    eq(schema.classes.schoolId, user.schoolId),
    eq(schema.classes.ownerUserId, user.id),
  )).limit(1)
  if (!klass) throw createError({ statusCode: 404, message: '班级不存在或不属于当前教师' })

  // 班主任姓名
  let classTeacherName: string | null = null
  if (klass.ownerUserId) {
    const [teacher] = await db.select({ name: schema.users.name }).from(schema.users).where(and(
      eq(schema.users.id, klass.ownerUserId),
      eq(schema.users.schoolId, user.schoolId),
    )).limit(1)
    if (teacher) classTeacherName = teacher.name
  }

  // 男女比例（在册学生实时统计）
  const genderRows = await db.select({
    gender: schema.students.gender,
    count: sql<number>`count(*)::int`,
  }).from(schema.students).where(and(
    eq(schema.students.classId, id),
    eq(schema.students.schoolId, user.schoolId),
    eq(schema.students.status, 'active'),
  )).groupBy(schema.students.gender)
  const genderRatio = { male: 0, female: 0, unknown: 0 }
  for (const row of genderRows) {
    if (row.gender === '男') genderRatio.male = Number(row.count)
    else if (row.gender === '女') genderRatio.female = Number(row.count)
    else genderRatio.unknown = Number(row.count)
  }

  // 班级近期事件（德育或班级重点事件）
  const events = await db.select().from(schema.classEvents).where(and(
    eq(schema.classEvents.classId, id),
    eq(schema.classEvents.schoolId, user.schoolId),
    eq(schema.classEvents.ownerUserId, user.id),
  )).orderBy(desc(schema.classEvents.occurredAt)).limit(50)

  const snapshot = klass.classSnapshot as {
    levelName?: string
    primaryAttribution?: string | { name?: string }
    dimensions?: Record<string, number>
    dimensionLabels?: Record<string, string>
    /** 取最低分维度（docx 班级系统建设「最薄弱系统」口径） */
    weakestDimension?: { code: string, label: string, score: number }
    /** 维度均分 < 3.0 的「需关注」维度 */
    attentionDimensions?: string[]
    assessedAt?: string
  } | null
  const weakestSystem = snapshot?.weakestDimension?.label
    || (typeof snapshot?.primaryAttribution === 'string' ? snapshot.primaryAttribution : snapshot?.primaryAttribution?.name)
    || null

  return {
    class: {
      ...klass,
      classSnapshot: undefined,
      classTeacherName,
      genderRatio,
      /** 四阶当前阶段 */
      stage: klass.energyStage || null,
      /** 最薄弱系统维度（优先取最低分维度，旧快照回退到核心归因） */
      weakestSystem,
      /** 需关注维度（均分 < 3.0） */
      attentionDimensions: snapshot?.attentionDimensions || [],
      /** 五系统维度分 */
      dimensions: snapshot?.dimensions || null,
      /** 最近一次评估时间 */
      assessedAt: snapshot?.assessedAt || null,
    },
    events,
  }
})
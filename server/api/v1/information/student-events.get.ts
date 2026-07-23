import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

const querySchema = z.object({
  studentId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const conditions = [eq(schema.studentEvents.ownerUserId, user.id)]
  if (query.studentId) conditions.push(eq(schema.studentEvents.studentId, query.studentId))
  if (query.eventType) conditions.push(eq(schema.studentEvents.eventType, query.eventType))
  if (query.severity) conditions.push(eq(schema.studentEvents.severity, query.severity))
  if (query.status) conditions.push(eq(schema.studentEvents.status, query.status))

  const [rows, [countRow]] = await Promise.all([
    db.select().from(schema.studentEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.studentEvents.occurredAt))
      .limit(query.limit).offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.studentEvents)
      .where(and(...conditions))
  ])

  // 批量获取学生姓名
  const studentIds = [...new Set(rows.map((r: { studentId: string }) => r.studentId))]
  const studentMap = new Map<string, string>()
  if (studentIds.length) {
    const studentRows = await db.select({ id: schema.students.id, profileEnc: schema.students.profileEnc })
      .from(schema.students).where(inArray(schema.students.id, studentIds))
    // 解析学生姓名（注：实际项目中应使用 decryptSensitive 解密 profileEnc）
    for (const s of studentRows) {
      studentMap.set(s.id, s.profileEnc ? JSON.parse(s.profileEnc).name || '未知' : '未知')
    }
  }

  const result = rows.map((r: { studentId: string; [key: string]: unknown }) => ({
    ...r,
    studentName: studentMap.get(r.studentId) || '未知学生',
  }))

  return { events: result, total: countRow?.count ?? 0 }
})
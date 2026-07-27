import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)

  const [attempt] = await db.select({ id: schema.assessmentAttempts.id, status: schema.assessmentAttempts.status })
    .from(schema.assessmentAttempts)
    .where(and(
      eq(schema.assessmentAttempts.id, id),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, user.schoolId),
    ))
    .limit(1)

  if (!attempt) throw createError({ statusCode: 404, message: '评估记录不存在' })

  // 已提交的评估不允许物理删除或归档
  if (attempt.status === 'submitted') {
    throw createError({ statusCode: 409, message: '已提交的评估不支持删除，如需弃用请联系管理员处理' })
  }

  // 草稿评估标记为归档
  await db.update(schema.assessmentAttempts)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(
      eq(schema.assessmentAttempts.id, id),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, user.schoolId),
    ))

  return { archived: true }
})

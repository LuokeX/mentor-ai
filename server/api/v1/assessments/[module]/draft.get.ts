import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  // 多量表模块必须按量表过滤，否则会把另一张量表的草稿答案取回来合并进当前作答：
  // 题号重合时（q1…q10 很常见）教师会看到一批自己没答过的题目已经被勾上。
  const instrumentCode = z.string().max(200).optional().parse(getQuery(event).instrumentCode || undefined)
  const [draft] = await useDb(event).select({
    id: schema.assessmentAttempts.id,
    answers: schema.assessmentAttempts.answers,
    assessmentCode: schema.assessmentAttempts.assessmentCode,
    updatedAt: schema.assessmentAttempts.updatedAt
  }).from(schema.assessmentAttempts).where(and(
    eq(schema.assessmentAttempts.ownerUserId, user.id),
    eq(schema.assessmentAttempts.module, module),
    eq(schema.assessmentAttempts.status, 'draft'),
    ...(instrumentCode ? [eq(schema.assessmentAttempts.assessmentCode, instrumentCode)] : [])
  )).orderBy(desc(schema.assessmentAttempts.updatedAt)).limit(1)
  return draft || null
})

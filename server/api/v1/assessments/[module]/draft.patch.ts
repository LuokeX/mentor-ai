import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { findInvalidDraftAnswers } from '../../../../domain/assessment-answers'
import { resolveAssessmentDefinition } from '../../../../domain/module-resources'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const draftSchema = z.object({
  attemptId: z.string().uuid().optional(),
  // 取值范围不能写死 1..5，否则 0/1 二值选项组的量表整张不可用。
  // 实际值域按题目自己的选项集合校验，见 findInvalidDraftAnswers。
  answers: z.record(z.string(), z.number().int()),
  // 多量表模块必须带上当前作答的量表，否则草稿会绑到模块默认量表：
  // 题号不重合时答第一题就 422；题号重合（q1…q10 很常见）时草稿以错误的量表编码落库，
  // 进而让 completed 状态和跨量表触发条件（PRIOR_*）全部读错量表。
  instrumentCode: z.string().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = draftSchema.parse(await readBody(event))
  const db = useDb(event)

  const definition = (await resolveAssessmentDefinition(event, module, user.schoolId, body.instrumentCode)).payload

  const invalid = findInvalidDraftAnswers(definition.questions, body.answers)
  if (invalid.length) {
    throw createError({
      statusCode: 422,
      message: `草稿包含不属于当前题库的答案或超出选项范围：${invalid.slice(0, 5).join('、')}`
    })
  }

  if (body.attemptId) {
    const [draft] = await db.update(schema.assessmentAttempts).set({
      answers: body.answers,
      // 教师中途换量表时草稿要跟着改绑，否则会留下「答案属于 B 表、编码写着 A 表」的记录
      assessmentCode: definition.code,
      definitionVersion: definition.version,
      updatedAt: new Date()
    }).where(and(
      eq(schema.assessmentAttempts.id, body.attemptId),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, user.schoolId),
      eq(schema.assessmentAttempts.module, module),
      eq(schema.assessmentAttempts.status, 'draft')
    )).returning({ id: schema.assessmentAttempts.id, updatedAt: schema.assessmentAttempts.updatedAt })
    if (!draft) throw createError({ statusCode: 404, message: '草稿不存在或已经提交' })
    return { attemptId: draft.id, updatedAt: draft.updatedAt }
  }
  const [draft] = await db.insert(schema.assessmentAttempts).values({
    schoolId: user.schoolId,
    ownerUserId: user.id,
    module,
    assessmentCode: definition.code,
    definitionVersion: definition.version,
    status: 'draft',
    answers: body.answers
  }).returning({ id: schema.assessmentAttempts.id, updatedAt: schema.assessmentAttempts.updatedAt })
  if (!draft) throw createError({ statusCode: 500, message: '草稿保存失败' })
  return { attemptId: draft.id, updatedAt: draft.updatedAt }
})

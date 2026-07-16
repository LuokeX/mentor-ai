import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assessmentDefinitions } from '../../../../../shared/assessments'
import type { AssessmentDefinition } from '../../../../../shared/assessments'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const draftSchema = z.object({
  attemptId: z.string().uuid().optional(),
  answers: z.record(z.string(), z.number().int().min(1).max(5))
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = draftSchema.parse(await readBody(event))
  const db = useDb(event)

  // 动态加载题库定义（优先 content_packages，fallback 硬编码）
  const [row] = await db
    .select({ payload: schema.contentPackages.payload, code: schema.contentPackages.code, version: schema.contentPackages.version })
    .from(schema.contentPackages)
    .where(and(
      eq(schema.contentPackages.code, `assessment-${module}`),
      eq(schema.contentPackages.status, 'published')
    ))
    .orderBy(desc(schema.contentPackages.version))
    .limit(1)
  const definition: AssessmentDefinition = row
    ? { ...(row.payload as unknown as AssessmentDefinition), code: (row.payload as any).code || row.code, version: (row.payload as any).version || row.version }
    : assessmentDefinitions[module]

  const allowedIds = new Set(definition.questions.map(question => question.id))
  if (Object.keys(body.answers).some(id => !allowedIds.has(id))) {
    throw createError({ statusCode: 422, message: '草稿包含不属于当前题库的答案' })
  }

  if (body.attemptId) {
    const [draft] = await db.update(schema.assessmentAttempts).set({ answers: body.answers, updatedAt: new Date() }).where(and(
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
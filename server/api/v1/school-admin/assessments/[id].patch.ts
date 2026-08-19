import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { recomputeAssessmentResult } from '../../../../domain/plan-admin'
import { writeAudit } from '../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  // 作答值域不写死：按该评估所属量表题目选项集合校验（findInvalidAnswers）
  answers: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  // 弃用语义：直接归档本评估（不连动方案；连动归档走 [id]/archive.post）
  status: z.literal('archived').optional(),
  expectedUpdatedAt: z.string().datetime()
}).refine(value => value.answers !== undefined || value.status !== undefined, {
  message: '至少提供 answers 或 status 之一'
})

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['assessments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const now = new Date()

  const [attempt] = await db.select().from(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.schoolId, schoolId)))
    .limit(1)
  if (!attempt) throw createError({ statusCode: 404, message: '评估不存在' })
  if (attempt.status === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '评估已归档，请先恢复后再编辑' })
  }
  if (!matchesExpectedUpdatedAt(attempt.updatedAt, body.expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
  }

  await db.transaction(async (tx) => {
    const patch: Partial<typeof schema.assessmentAttempts.$inferInsert> = { updatedAt: now }
    let recomputed: { result: Record<string, unknown>, definitionVersion: string } | null = null
    if (body.answers !== undefined) {
      // 重算 result 复用提交链的确定性逻辑（见 domain/plan-admin.ts recomputeAssessmentResult）
      recomputed = await recomputeAssessmentResult(event, tx, {
        schoolId,
        ownerUserId: attempt.ownerUserId,
        module: attempt.module,
        assessmentCode: attempt.assessmentCode,
        attemptId: attempt.id,
        answers: body.answers
      })
      patch.answers = body.answers
      patch.result = recomputed.result
      // definitionVersion 跟随三库当前发布版本。
      // 方案快照（title/summary/actions/tools/instrumentSnapshots）不随重算更新：
      // 方案内容以生成时固化的快照为准，避免管理员修正评估导致已进入执行态的方案内容漂移。
      patch.definitionVersion = recomputed.definitionVersion
    }
    if (body.status === 'archived') {
      patch.status = 'archived'
      patch.archivedAt = now
      patch.archivedBy = user.id
      patch.archivedPreviousStatus = attempt.status
    }
    const [updated] = await tx.update(schema.assessmentAttempts).set(patch)
      .where(and(
        eq(schema.assessmentAttempts.id, id),
        eq(schema.assessmentAttempts.schoolId, schoolId),
        updatedAtMatches(schema.assessmentAttempts.updatedAt, body.expectedUpdatedAt)
      ))
      .returning({ id: schema.assessmentAttempts.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
    }
    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.assessment.patch',
      targetType: 'assessment', targetId: id,
      metadata: {
        answers: body.answers !== undefined ? { before: attempt.answers, after: body.answers } : undefined,
        definitionVersion: recomputed ? { before: attempt.definitionVersion, after: recomputed.definitionVersion } : undefined,
        status: body.status !== undefined ? { before: attempt.status, after: 'archived' } : undefined
      }
    }, tx)
  })
  return { ok: true }
})
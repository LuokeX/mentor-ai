import { z } from 'zod'
import { and, desc, eq, ne } from 'drizzle-orm'
import { assessmentDefinitions } from '../../../../../shared/assessments'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { evaluateAssessment } from '../../../../domain/rules'
import { encryptSensitive } from '../../../../utils/crypto'
import { createSafetyReferral } from '../../../../domain/safety'
import { writeAudit } from '../../../../utils/audit'
import { expressRuleResult } from '../../../../integrations/deepseek'

const bodySchema = z.object({
  attemptId: z.string().uuid().optional(),
  answers: z.record(z.string(), z.number().int().min(1).max(5))
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event))
  const definition = assessmentDefinitions[module]
  if (definition.questions.some(question => !body.answers[question.id])) {
    throw createError({ statusCode: 422, message: '请完成全部题目' })
  }
  const db = useDb(event)
  const previous = module === 'self_growth'
    ? await db.select({ answers: schema.assessmentAttempts.answers })
        .from(schema.assessmentAttempts)
        .where(and(
          eq(schema.assessmentAttempts.ownerUserId, user.id),
          eq(schema.assessmentAttempts.module, module),
          eq(schema.assessmentAttempts.status, 'submitted')
        ))
        .orderBy(desc(schema.assessmentAttempts.submittedAt))
        .limit(3)
    : []
  let previousConsecutiveLowMeaning = 0
  for (const item of previous) {
    if (Number(item.answers.q3) <= 2) previousConsecutiveLowMeaning++
    else break
  }
  const result = evaluateAssessment(module, body.answers, { previousConsecutiveLowMeaning })
  const narrative = result.blocked ? null : await expressRuleResult(event, module, result)
  const presentedResult = { ...result, narrative }
  const [attempt] = body.attemptId
    ? await db.update(schema.assessmentAttempts).set({
        answers: body.answers, result: presentedResult as unknown as Record<string, unknown>, status: 'submitted', submittedAt: new Date(), updatedAt: new Date()
      }).where(and(
        eq(schema.assessmentAttempts.id, body.attemptId),
        eq(schema.assessmentAttempts.ownerUserId, user.id),
        eq(schema.assessmentAttempts.schoolId, user.schoolId),
        ne(schema.assessmentAttempts.status, 'submitted')
      )).returning()
    : await db.insert(schema.assessmentAttempts).values({
        schoolId: user.schoolId, ownerUserId: user.id, module,
        assessmentCode: definition.code, definitionVersion: definition.version,
        status: 'submitted', answers: body.answers, result: presentedResult as unknown as Record<string, unknown>, submittedAt: new Date()
      }).returning()
  if (!attempt) throw createError({ statusCode: body.attemptId ? 404 : 500, message: body.attemptId ? '草稿不存在或已经提交' : '评估记录保存失败' })

  let fuse: { eventId: string, referralId: string, crisisGuide: string } | null = null
  if (result.blocked) {
    const referral = await createSafetyReferral(event, {
      schoolId: user.schoolId, ownerUserId: user.id, sourceType: 'assessment', sourceId: attempt.id,
      text: `${definition.title}触发高风险规则：${result.reasons.join('；')}`, matchedRules: result.matchedRuleIds
    })
    fuse = { eventId: referral.safety.id, referralId: referral.referral.id, crisisGuide: referral.crisisGuide }
  } else {
    await db.insert(schema.plans).values({
      schoolId: user.schoolId, ownerUserId: user.id, module,
      title: `${definition.title}行动方案`,
      summaryEnc: encryptSensitive(narrative || result.reasons.join('；'), useRuntimeConfig(event).encryptionKey),
      actions: result.actions, tools: result.tools,
      sourceVersions: [`${definition.code}@${definition.version}`, ...result.matchedRuleIds]
    })
  }
  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'assessment.submit', targetType: 'assessment', targetId: attempt.id,
    metadata: { module, level: result.level, blocked: result.blocked, ruleIds: result.matchedRuleIds }
  })
  return { attemptId: attempt.id, result: presentedResult, fuse }
})

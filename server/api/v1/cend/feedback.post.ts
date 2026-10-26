import { z } from 'zod'
import { CEND_TASK_REWARDS, grantTaskRewardTx } from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { writeAudit } from '../../../utils/audit'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({
  content: z.string().trim().min(2).max(2000),
  rating: z.coerce.number().int().min(1).max(5).optional()
})

/** 提交产品反馈；首次提交发放 300 积分。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const cend = await requireCendContext(event, user)
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const result = await db.transaction(async (tx) => {
    const [feedback] = await tx.insert(schema.cendFeedback).values({
      userId: user.id,
      content: body.content,
      rating: body.rating ?? null
    }).returning({ id: schema.cendFeedback.id })
    const task = await grantTaskRewardTx(tx, user.id, 'submit_feedback')
    await writeAudit(event, {
      schoolId: cend.id,
      actorId: user.id,
      action: 'cend.feedback.submit',
      targetType: 'cend_feedback',
      targetId: feedback?.id,
      metadata: { rating: body.rating ?? null, reward: task.awarded ? CEND_TASK_REWARDS.submit_feedback : 0 }
    }, tx)
    return { feedbackId: feedback?.id, reward: task.awarded ? task.reward : 0 }
  })

  return { ok: true, ...result }
})

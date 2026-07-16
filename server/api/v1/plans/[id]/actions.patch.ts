import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    actionIndex: z.number().int().min(0).max(50),
    status: z.enum(['pending', 'in_progress', 'completed']),
  }).parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({ id: schema.plans.id, actions: schema.plans.actions })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const actions = (plan.actions as Array<{ title: string; detail: string; status: string }>) || []
  if (body.actionIndex >= actions.length) {
    throw createError({ statusCode: 422, message: '动作索引越界' })
  }

  const action = actions[body.actionIndex]!
  actions[body.actionIndex] = { title: action.title, detail: action.detail, status: body.status }

  await db.update(schema.plans)
    .set({ actions: actions as any, updatedAt: new Date() })
    .where(eq(schema.plans.id, plan.id))

  return { ok: true }
})
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { useDb, schema } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({ module: moduleIdSchema }).parse(await readBody(event))
  const [decision] = await useDb(event).update(schema.routingDecisions)
    .set({ confirmedModule: body.module })
    .where(and(eq(schema.routingDecisions.id, id), eq(schema.routingDecisions.ownerUserId, user.id)))
    .returning()
  if (!decision) throw createError({ statusCode: 404, message: '路由记录不存在' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'chat.route.confirm', targetType: 'conversation', targetId: decision.sessionId, metadata: { module: body.module } })
  return { ok: true, module: body.module }
})

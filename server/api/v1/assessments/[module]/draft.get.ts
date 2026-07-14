import { and, desc, eq } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const [draft] = await useDb(event).select({
    id: schema.assessmentAttempts.id,
    answers: schema.assessmentAttempts.answers,
    updatedAt: schema.assessmentAttempts.updatedAt
  }).from(schema.assessmentAttempts).where(and(
    eq(schema.assessmentAttempts.ownerUserId, user.id),
    eq(schema.assessmentAttempts.module, module),
    eq(schema.assessmentAttempts.status, 'draft')
  )).orderBy(desc(schema.assessmentAttempts.updatedAt)).limit(1)
  return draft || null
})

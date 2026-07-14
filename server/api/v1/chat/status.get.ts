import { and, count, eq, or } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const [knowledge] = await useDb(event).select({ count: count() }).from(schema.knowledgeBases).where(and(
    eq(schema.knowledgeBases.status, 'published'),
    or(
      eq(schema.knowledgeBases.scope, 'global'),
      and(eq(schema.knowledgeBases.scope, 'school'), eq(schema.knowledgeBases.schoolId, user.schoolId!))
    )
  ))
  return {
    provider: 'deepseek',
    modelConfigured: Boolean(useRuntimeConfig(event).deepseekApiKey),
    mode: useRuntimeConfig(event).deepseekApiKey ? 'deepseek' : 'local_fallback',
    publishedKnowledgeBases: knowledge?.count || 0
  }
})

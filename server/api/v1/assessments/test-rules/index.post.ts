import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { assessmentDefinitions } from '../../../../../shared/assessments'
import type { AssessmentDefinition } from '../../../../../shared/assessments'
import { moduleIdSchema } from '../../../../../shared/contracts'
import type { RuleConfig } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { executeRules } from '../../../../domain/rules-executor'

const bodySchema = z.object({
  module: moduleIdSchema,
  answers: z.record(z.string(), z.number().int().min(1).max(5)),
  config: z.object({}).passthrough() // RuleConfig, 不做完整校验
})

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [row] = await db
    .select({ payload: schema.contentPackages.payload })
    .from(schema.contentPackages)
    .where(and(
      eq(schema.contentPackages.code, `assessment-${body.module}`),
      eq(schema.contentPackages.status, 'published')
    ))
    .orderBy(desc(schema.contentPackages.version))
    .limit(1)

  const definition: AssessmentDefinition = row
    ? (row.payload as unknown as AssessmentDefinition)
    : assessmentDefinitions[body.module]

  const result = executeRules(body.config as unknown as RuleConfig, body.answers, definition)
  return result
})
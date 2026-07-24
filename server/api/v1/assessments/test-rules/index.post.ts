import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { assessmentDefinitions } from '../../../../../shared/assessments'
import type { AssessmentDefinition } from '../../../../../shared/assessments'
import { attributionConfigSchema, moduleIdSchema } from '../../../../../shared/contracts'
import type { AttributionConfig } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { executeRules } from '../../../../domain/rules-executor'

const bodySchema = z.object({
  module: moduleIdSchema,
  answers: z.record(z.string(), z.number().int().min(1).max(5)),
  config: attributionConfigSchema
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

  const result = executeRules(body.config as unknown as AttributionConfig, body.answers, definition)
  return result
})

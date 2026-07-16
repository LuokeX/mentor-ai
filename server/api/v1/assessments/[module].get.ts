import { assessmentDefinitions } from '../../../../shared/assessments'
import { moduleIdSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { and, desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['teacher'])
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))

  // 优先从 content_packages 加载已发布版本
  const db = useDb(event)
  const [row] = await db
    .select({ payload: schema.contentPackages.payload, code: schema.contentPackages.code, version: schema.contentPackages.version })
    .from(schema.contentPackages)
    .where(and(
      eq(schema.contentPackages.code, `assessment-${module}`),
      eq(schema.contentPackages.status, 'published')
    ))
    .orderBy(desc(schema.contentPackages.version))
    .limit(1)

  if (row) return { ...(row.payload as any), code: (row.payload as any).code || row.code, version: (row.payload as any).version || row.version }
  return assessmentDefinitions[module]
})
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../../shared/management'
import type { Capability, ManagedListResult } from '../../../../../shared/management'
import { countSql, offsetFrom } from '../../../../domain/school-management'
import { resolvePageCapabilities } from '../../../../domain/capabilities'
import { requireUser } from '../../../../utils/auth'
import { paginateResult } from '../../../../utils/pagination'
import { schema, useDb } from '../../../../utils/db'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const schoolId = user.schoolId
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)
  const result = await paginateResult({
    dataQuery: db.select({
      id: schema.schoolImports.id,
      importType: schema.schoolImports.importType,
      status: schema.schoolImports.status,
      totalRows: schema.schoolImports.totalRows,
      createdRows: schema.schoolImports.createdRows,
      updatedRows: schema.schoolImports.updatedRows,
      skippedRows: schema.schoolImports.skippedRows,
      errorCount: schema.schoolImports.errorCount,
      createdAt: schema.schoolImports.createdAt,
    }).from(schema.schoolImports)
      .where(eq(schema.schoolImports.schoolId, schoolId))
      .orderBy(desc(schema.schoolImports.createdAt))
      .limit(query.pageSize)
      .offset(offsetFrom(query.page, query.pageSize)),
    countQuery: db.select({ value: countSql }).from(schema.schoolImports).where(eq(schema.schoolImports.schoolId, schoolId)),
    page: query.page,
    pageSize: query.pageSize,
  })
  const rows = result.rows.map(row => ({ ...row, _capabilities: ['view'] as Capability[] }))
  const pageCapabilities: Capability[] = await resolvePageCapabilities(user, 'import', event)
  return { rows, page: result.page, pageSize: result.pageSize, total: result.total, capabilities: pageCapabilities } satisfies ManagedListResult<(typeof rows)[number]>
})

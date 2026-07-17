import { z } from 'zod'
import { importTemplates } from '../../../../../domain/school-imports'
import { requireUser } from '../../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['school_admin'])
  const type = z.enum(['users', 'classes', 'students', 'guardians']).parse(getRouterParam(event, 'type'))
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${type}.csv"`
  })
  return `\uFEFF${importTemplates[type]}`
})

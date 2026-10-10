import { z } from 'zod'
import { importTemplates, SCHOOL_IMPORT_TYPES } from '../../../../../domain/school-imports'
import { buildImportTemplate, isBusinessImportType } from '../../../../../domain/information-imports'
import { requireUser } from '../../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['school_admin'])
  const type = z.enum(SCHOOL_IMPORT_TYPES).parse(getRouterParam(event, 'type'))
  if (isBusinessImportType(type)) {
    // 家校沟通 / 学生事件记录与教师端共用同一份 xlsx 模板（列一致，仅学生匹配范围不同）
    setResponseHeaders(event, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${type}.xlsx"`
    })
    return buildImportTemplate(type)
  }
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${type}.csv"`
  })
  return `\uFEFF${importTemplates[type]}`
})

import { requireUser } from '../../../../utils/auth'
import { buildImportTemplate } from '../../../../domain/information-imports'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['teacher'])
  const buf = buildImportTemplate('communications')
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="information_communications_import_template.xlsx"')
  return buf
})

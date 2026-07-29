import { moduleResourceFileImportSchema } from '../../../../../shared/contracts'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { projectModuleResourcePayload } from '../../../../domain/module-resource-projection'
import { previewModuleResourcePayload, validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceFileImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源文件参数不正确' })
  const body = parsed.data
  let payload: Record<string, unknown>
  try {
    payload = parseModuleResourceFile(body)
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '资源文件解析失败' })
  }
  const validation = validateModuleResourcePayload({ module: body.module, libraryType: body.libraryType, payload })
  const projection = projectModuleResourcePayload({
    libraryId: '00000000-0000-0000-0000-000000000001',
    versionId: '00000000-0000-0000-0000-000000000002',
    module: body.module,
    libraryType: body.libraryType,
    scope: body.scope,
    schoolId: body.schoolId || null
  }, payload)
  return {
    payload,
    validation,
    preview: validation.ok ? previewModuleResourcePayload({ module: body.module, libraryType: body.libraryType, payload }) : null,
    projection: {
      assessmentCount: projection.assessments.length,
      attributionRuleCount: projection.attributionRules.length,
      attributionItemCount: projection.attributionItems.length,
      toolCount: projection.tools.length,
      templateCount: projection.outputTemplates.length,
      routeCount: projection.keywordRoutes.length
    }
  }
})

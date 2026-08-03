import { moduleResourceFileImportSchema } from '../../../../../shared/contracts'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { projectModuleResourcePayload } from '../../../../domain/module-resource-projection'
import { previewModuleResourcePayload, validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { runCrossRefCheck } from '../../../../domain/module-resource-cross-ref-runner'
import { resolveModuleResourceCounterpart } from '../../../../domain/module-resources'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceFileImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源文件参数不正确' })
  const body = parsed.data
  let payload: Record<string, unknown>
  // 解析走到「不报错但很可能解析错」的兜底分支时，提示要带到预检面板上
  const parseWarnings: string[] = []
  try {
    payload = parseModuleResourceFile(body, parseWarnings)
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '资源文件解析失败' })
  }
  const validation = validateModuleResourcePayload({
    module: body.module,
    libraryType: body.libraryType,
    payload,
    // 之前预检没传 counterpart，「现行归因库引用的题目在新量表中不存在」这条守卫
    // 要等到发布时才触发，导入阶段看不出来。
    counterpart: await resolveModuleResourceCounterpart(event, {
      module: body.module,
      libraryType: body.libraryType,
      schoolId: body.schoolId || null
    })
  })
  // 跨库校验必须在导入时就跑。只在编辑器手动点的话，勾了「预检通过后直接发布」
  // 就能把跨库断裂的资源直接推上线。
  const crossRef = await runCrossRefCheck(event, body.module, {
    kind: 'byPayload',
    libraryType: body.libraryType,
    payload,
    scope: body.scope,
    schoolId: body.schoolId || null
  }, {
    schoolId: body.schoolId || null
  })
  const crossRefErrors = crossRef.issues.filter(issue => issue.severity === 'error')
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
    parseWarnings,
    crossRef,
    // 前端的「确认导入」按钮以此为准：库内校验和跨库引用都必须过
    canImport: validation.ok && crossRefErrors.length === 0,
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

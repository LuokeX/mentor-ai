/**
 * 批量导入预检：必须上传全部 5 个库文件（量表/归因/工具/输出模板/关键词路由），
 * 本次上传的 5 个库之间互相校验（不与其他已发布版本校验）。
 * 版本号必须 x.y.z 格式且在该模块范围内未被占用。
 */
import { moduleResourceBatchImportSchema } from '../../../../../shared/contracts'
import type { LibraryType } from '../../../../../shared/contracts'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { projectModuleResourcePayload } from '../../../../domain/module-resource-projection'
import { previewModuleResourcePayload, validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { runCrossRefCheck } from '../../../../domain/module-resource-cross-ref-runner'
import { buildBatchCounterpart } from '../../../../domain/module-resource-batch'
import { findExistingVersionLibraries, resolveModuleResourceCounterpart } from '../../../../domain/module-resources'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const parsed = moduleResourceBatchImportSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '资源文件参数不正确' })
  }
  const body = parsed.data
  const schoolId = body.scope === 'school' ? (body.schoolId || null) : null

  // 0. 版本号真实化：该模块+范围内不得重复（草稿也占位，(library_id, version) 全局唯一）
  const versionConflicts = await findExistingVersionLibraries(event, {
    module: body.module, scope: body.scope, schoolId, version: body.version
  })

  // 1. 全部解析。某个文件解析失败整体 400，不进入校验
  const files: Array<{
    libraryType: LibraryType
    filename: string
    payload: Record<string, unknown>
    parseWarnings: string[]
  }> = []
  for (const file of body.files) {
    const parseWarnings: string[] = []
    let payload: Record<string, unknown>
    try {
      payload = parseModuleResourceFile({
        module: body.module,
        libraryType: file.libraryType,
        filename: file.filename,
        contentBase64: file.contentBase64
      }, parseWarnings)
    } catch (error: any) {
      throw createError({ statusCode: 400, message: `《${file.filename}》解析失败：${error?.message || ''}` })
    }
    files.push({ libraryType: file.libraryType, filename: file.filename, payload, parseWarnings })
  }

  // 2. 库内校验。对侧优先用本次一并上传的库，没上传才回退现行已发布版本
  const uploaded = new Map<LibraryType, Record<string, unknown>>(
    files.map(file => [file.libraryType, file.payload])
  )
  const validations = new Map<LibraryType, { ok: boolean, errors: Array<{ severity: string, message: string, path?: string }>, warnings: Array<{ severity: string, message: string, path?: string }> }>()
  for (const file of files) {
    validations.set(file.libraryType, validateModuleResourcePayload({
      module: body.module,
      libraryType: file.libraryType,
      payload: file.payload,
      counterpart: buildBatchCounterpart(
        uploaded,
        await resolveModuleResourceCounterpart(event, { module: body.module, libraryType: file.libraryType, schoolId }),
        file.libraryType
      )
    }))
  }

  // 3. 跨库校验：本次上传的库全部顶替同槽位，未上传的库仍用现行已发布版本
  const crossRef = await runCrossRefCheck(event, body.module,
    files.map(file => ({
      kind: 'byPayload' as const,
      libraryType: file.libraryType,
      payload: file.payload,
      scope: body.scope,
      schoolId
    })),
    { schoolId }
  )
  const crossRefErrors = crossRef.issues.filter(issue => issue.severity === 'error')

  // 4. 汇总每个文件的预览与投影计数
  const entries = files.map(file => {
    const validation = validations.get(file.libraryType)!
    const projection = projectModuleResourcePayload({
      libraryId: '00000000-0000-0000-0000-000000000001',
      versionId: '00000000-0000-0000-0000-000000000002',
      module: body.module,
      libraryType: file.libraryType,
      scope: body.scope,
      schoolId
    }, file.payload)
    return {
      libraryType: file.libraryType,
      filename: file.filename,
      validation,
      parseWarnings: file.parseWarnings,
      preview: validation.ok
        ? previewModuleResourcePayload({ module: body.module, libraryType: file.libraryType, payload: file.payload })
        : null,
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

  return {
    entries,
    crossRef,
    versionConflicts,
    // 前端「确认导入」按钮以此为准：版本号未占用、全部库内校验通过且跨库引用无 error
    canImport: versionConflicts.length === 0
      && entries.every(entry => entry.validation.ok)
      && crossRefErrors.length === 0
  }
})
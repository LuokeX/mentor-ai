/**
 * 业务填写向导的编译预检。
 *
 * 把向导收集的中文输入编译成 5 个标准库文件，逐个跑真实的解析 + 校验，
 * 再做一次跨库校验，最后连同「回读稿」一起返回。
 *
 * 导入不在这里做——页面拿到 base64 后直接调现有的 /import，5 个库各调一次。
 * 这样每个库走的都是和手工上传完全相同的路径，不新开第二条导入链。
 */
import { wizardInputSchema } from '../../../../../shared/business-wizard'
import { compileWizardInput } from '../../../../domain/business-wizard-compile'
import { checkCrossReferences } from '../../../../domain/module-resource-cross-ref'
import { parseModuleResourceFile } from '../../../../domain/module-resource-file-import'
import { projectModuleResourcePayload } from '../../../../domain/module-resource-projection'
import { validateModuleResourcePayload } from '../../../../domain/module-resource-validation'
import { requireUser } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const parsed = wizardInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw createError({
      statusCode: 400,
      message: `填写内容还不完整：${issue?.path.join('.') || ''} ${issue?.message || ''}`
    })
  }
  const input = parsed.data

  let compiled: ReturnType<typeof compileWizardInput>
  try {
    compiled = compileWizardInput(input)
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '编译失败' })
  }

  const payloads = new Map<string, Record<string, unknown>>()
  const libraries: Array<{ id: string, libraryType: string }> = []
  const results = []

  for (const lib of compiled.libraries) {
    const diagnostics: string[] = []
    let payload: Record<string, unknown>
    try {
      payload = parseModuleResourceFile({
        module: input.module,
        libraryType: lib.libraryType,
        filename: `${lib.libraryType}.xlsx`,
        contentBase64: lib.buffer.toString('base64')
      }, diagnostics)
    } catch (error: any) {
      results.push({
        libraryType: lib.libraryType, label: lib.label, ok: false,
        errors: [{ message: `生成的${lib.label}无法解析：${error?.message || ''}` }],
        warnings: [], diagnostics, counts: {}, contentBase64: lib.buffer.toString('base64')
      })
      continue
    }
    const validation = validateModuleResourcePayload({
      module: input.module, libraryType: lib.libraryType, payload
    })
    const projection = projectModuleResourcePayload({
      libraryId: '00000000-0000-0000-0000-000000000001',
      versionId: '00000000-0000-0000-0000-000000000002',
      module: input.module, libraryType: lib.libraryType, scope: 'global', schoolId: null
    }, payload)

    payloads.set(lib.libraryType, payload)
    libraries.push({ id: lib.libraryType, libraryType: lib.libraryType })
    results.push({
      libraryType: lib.libraryType,
      label: lib.label,
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      diagnostics,
      counts: {
        量表: projection.assessments.length,
        归因项: projection.attributionItems.length,
        规则: projection.attributionRules.length,
        工具: projection.tools.length,
        输出模板: projection.outputTemplates.length,
        关键词: projection.keywordRoutes.length
      },
      contentBase64: lib.buffer.toString('base64')
    })
  }

  // 向导产出的是完整自洽的一整套，直接拿编译结果做跨库校验，
  // 不需要和库里现行版本混合——业务这次填的就是全部。
  const crossRef = checkCrossReferences(input.module, libraries, payloads)
  const crossRefErrors = crossRef.issues.filter(issue => issue.severity === 'error')

  return {
    module: input.module,
    results,
    crossRef,
    codes: compiled.codes,
    readback: compiled.readback,
    issues: compiled.issues,
    canImport: results.every(r => r.ok)
      && crossRefErrors.length === 0
      && !compiled.issues.some(i => i.severity === 'error')
  }
})

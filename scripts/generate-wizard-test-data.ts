#!/usr/bin/env node
/**
 * 用最新业务填写向导（compileWizardInput）生成 5 模块 × 5 库的 test-data。
 *
 * 用法：
 *   pnpm tsx scripts/generate-wizard-test-data.mjs           生成并写回 test-data
 *   pnpm tsx scripts/generate-wizard-test-data.mjs --verify  生成后走真实导入链校验
 *
 * 输入：business-libraries/wizard-inputs/<module>.ts（WizardInput，版本 4.0.0）
 * 输出：business-libraries/test-data/<module>/<library>.xlsx
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { checkCrossReferences } from '../server/domain/module-resource-cross-ref'
import { SELF_GROWTH_WIZARD_INPUT } from '../business-libraries/wizard-inputs/self_growth'
import { CLASS_SYSTEM_WIZARD_INPUT } from '../business-libraries/wizard-inputs/class_system'
import { HOME_SCHOOL_WIZARD_INPUT } from '../business-libraries/wizard-inputs/home_school'
import { STUDENT_CASE_WIZARD_INPUT } from '../business-libraries/wizard-inputs/student_case'
import { LEARNING_PROBLEM_WIZARD_INPUT } from '../business-libraries/wizard-inputs/learning_problem'

const INPUTS: Record<string, any> = {
  self_growth: SELF_GROWTH_WIZARD_INPUT,
  class_system: CLASS_SYSTEM_WIZARD_INPUT,
  home_school: HOME_SCHOOL_WIZARD_INPUT,
  student_case: STUDENT_CASE_WIZARD_INPUT,
  learning_problem: LEARNING_PROBLEM_WIZARD_INPUT
}
const LIB_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']
const OUT = resolve('business-libraries/test-data')
const verify = process.argv.includes('--verify')

for (const [module, input] of Object.entries(INPUTS)) {
  const compiled = compileWizardInput(input)
  const blocking = compiled.issues.filter(i => i.severity === 'error')
  if (blocking.length) {
    console.error(`【${module}】编译 error：`)
    blocking.forEach(i => console.error('  ' + i.message))
    process.exit(1)
  }
  const dir = resolve(OUT, module)
  mkdirSync(dir, { recursive: true })
  for (const lib of compiled.libraries) {
    writeFileSync(resolve(dir, `${lib.libraryType}.xlsx`), lib.buffer)
  }
  console.log(`【${module}】已生成 ${compiled.libraries.length} 个库（version ${input.version}），warning ${compiled.issues.filter(i => i.severity === 'warning').length} 条`)
  for (const w of compiled.issues.filter(i => i.severity === 'warning')) console.log('  ⚠ ' + w.message)

  if (verify) {
    const payloads = new Map<string, any>()
    const libs: any[] = []
    for (const lib of compiled.libraries) {
      const payload = parseModuleResourceFile({
        module, libraryType: lib.libraryType, filename: `${lib.libraryType}.xlsx`,
        contentBase64: lib.buffer.toString('base64')
      })
      const v = validateModuleResourcePayload({ module, libraryType: lib.libraryType, payload })
      if (!v.ok) {
        console.error(`【${module}】${lib.label} 校验失败：`)
        v.errors.forEach(e => console.error('  ' + e.message))
        process.exit(1)
      }
      payloads.set(lib.libraryType, payload)
      libs.push({ id: lib.libraryType, libraryType: lib.libraryType })
    }
    const cr = checkCrossReferences(module, libs, payloads)
    const errs = cr.issues.filter(i => i.severity === 'error')
    if (errs.length) {
      console.error(`【${module}】跨库错误 ${errs.length} 条：`)
      errs.slice(0, 5).forEach(e => console.error('  ' + e.message))
      process.exit(1)
    }
    console.log(`【${module}】导入链校验通过（解析 + 校验 + 跨库 0 错误）`)
  }
}
console.log('done')
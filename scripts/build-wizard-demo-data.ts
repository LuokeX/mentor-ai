#!/usr/bin/env node
/**
 * 用业务填写向导输入（wizard-inputs，单一事实来源）重新生成 5 个模块的打样三库数据。
 *
 * 流程：读取 business-libraries/wizard-inputs/<module>.ts → compileWizardInput
 *       → 写回 business-libraries/test-data/<module>/（5 库 xlsx）。
 *
 * 用法：pnpm exec tsx scripts/build-wizard-demo-data.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { SELF_GROWTH_WIZARD_INPUT } from '../business-libraries/wizard-inputs/self_growth'
import { CLASS_SYSTEM_WIZARD_INPUT } from '../business-libraries/wizard-inputs/class_system'
import { HOME_SCHOOL_WIZARD_INPUT } from '../business-libraries/wizard-inputs/home_school'
import { STUDENT_CASE_WIZARD_INPUT } from '../business-libraries/wizard-inputs/student_case'
import { LEARNING_PROBLEM_WIZARD_INPUT } from '../business-libraries/wizard-inputs/learning_problem'

const BASE = resolve('business-libraries/test-data')
const LIB_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']

const INPUTS: Array<[string, typeof SELF_GROWTH_WIZARD_INPUT]> = [
  ['self_growth', SELF_GROWTH_WIZARD_INPUT],
  ['class_system', CLASS_SYSTEM_WIZARD_INPUT],
  ['home_school', HOME_SCHOOL_WIZARD_INPUT],
  ['student_case', STUDENT_CASE_WIZARD_INPUT],
  ['learning_problem', LEARNING_PROBLEM_WIZARD_INPUT]
]

function writeLibs(module: string, compiled: ReturnType<typeof compileWizardInput>) {
  for (const lib of compiled.libraries) {
    writeFileSync(resolve(BASE, module, `${lib.libraryType}.xlsx`), lib.buffer)
  }
}

const problems: string[] = []

for (const [module, input] of INPUTS) {
  const compiled = compileWizardInput(input)
  const errors = compiled.issues.filter(i => i.severity === 'error')
  if (errors.length) problems.push(`${module}: 编译 error: ${errors.map(e => e.message).join(' | ')}`)
  const warns = compiled.issues.filter(i => i.severity === 'warning')
  console.log(`[${module}] 版本${input.version} 量表${input.scales.length} 归因${input.attributions.length} 等级${input.levels.length} 工具${input.tools.length} 关键词${input.keywords.length}`
    + `${input.optionGroups.length ? ` 自定义组${input.optionGroups.map(g => g.name).join('、')}` : ''}`
    + (warns.length ? ` | warnings: ${warns.map(w => w.message.slice(0, 40)).join('；')}` : ''))

  writeLibs(module, compiled)
}

console.log('\n==== 问题清单 ====')
console.log(problems.length ? problems.join('\n') : '无')
if (problems.some(p => p.includes('编译 error'))) process.exit(1)
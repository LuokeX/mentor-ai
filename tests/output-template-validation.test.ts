import { describe, expect, it } from 'vitest'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { OUTPUT_TEMPLATE_PLACEHOLDERS } from '../shared/contracts'

const base = {
  code: 'TPL_TEST', module: 'home_school' as const, attributionLevel: 'none', type: 'summary' as const, order: 1
}

describe('output_template 占位符白名单校验', () => {
  it('白名单内的占位符全部通过（渲染器支持的完整集合）', () => {
    const content = OUTPUT_TEMPLATE_PLACEHOLDERS.map(p => '${' + p + '}').join('；')
    const v = validateModuleResourcePayload({
      module: 'home_school', libraryType: 'output_template',
      payload: { templates: [{ ...base, content }] }
    })
    expect(v.errors).toEqual([])
  })

  it('未注册占位符报 error 并给出合法清单（防止渲染期静默置空）', () => {
    const v = validateModuleResourcePayload({
      module: 'home_school', libraryType: 'output_template',
      payload: { templates: [{ ...base, content: '结论：${诊断结果}，建议${AI建议}。' }] }
    })
    const placeholderErrors = v.errors.filter(e => e.message.includes('占位符'))
    expect(placeholderErrors).toHaveLength(2)
    expect(placeholderErrors[0]!.message).toContain('${诊断结果}')
    expect(placeholderErrors[1]!.message).toContain('${AI建议}')
    expect(placeholderErrors[0]!.message).toContain('主要归因')
  })
})
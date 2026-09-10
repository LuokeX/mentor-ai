import { describe, expect, it } from 'vitest'
import { buildFormatInstruction } from '../server/agent/prompts'

describe('Agent 行为要点（formatInstruction）', () => {
  it('保留回答先行：基于现有信息直接给初步判断，不先发起多轮追问', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('回答先行')
    expect(text).toContain('不诊断、不承诺效果、不替代量表结论')
  })

  it('量表结果优先于初步判断，并引导 recommend_assessment 推荐卡', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('量表结果优先于初步判断')
    expect(text).toContain('recommend_assessment')
  })

  it('禁止输出「选项：」列表、JSON 与代码块', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不输出"选项："列表')
    expect(text).toContain('不输出 JSON')
    expect(text).toContain('不输出代码块')
  })

  it('保留不做诊断、不碰确定性规则结论等既有约束', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不做精神、医学、法律诊断')
    expect(text).toContain('不计算量表分数')
    expect(text).toContain('不复述姓名、电话、邮箱等个人信息')
  })

  it('有教师画像时并入身份前缀', () => {
    const text = buildFormatInstruction({ teacherProfileText: '班主任（5年）；语文学科教师' })
    expect(text.startsWith('您是班主任（5年）；语文学科教师。')).toBe(true)
    expect(text).toContain('回答先行')
  })
})

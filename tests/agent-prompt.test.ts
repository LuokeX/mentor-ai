import { describe, expect, it } from 'vitest'
import { buildFormatInstruction } from '../server/agent/prompts'

describe('Agent 行为要点（formatInstruction）', () => {
  it('保留回答先行：基于现有信息直接给初步判断，不先发起多轮追问', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('回答先行')
    expect(text).toContain('不诊断、不承诺效果、不替代量表结论')
    expect(text).toContain('不要先发起多轮澄清追问')
  })

  it('末尾澄清必须落到具体信息点：禁止方向二选一，也不反问能查到的事实', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('只在回答末尾问一个具体问题')
    expect(text).toContain('哪个学生或哪类班级')
    expect(text).toContain('最近一次发生的时间与场合')
    expect(text).toContain('家长原话')
    expect(text).toContain('教师已经试过什么')
    expect(text).toContain('方向二选一')
    expect(text).toContain('能从工具与上下文查到的事实不要反问教师')
  })

  it('量表结果优先于初步判断，并引导 recommend_assessment 推荐卡', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('量表结果优先于初步判断')
    expect(text).toContain('recommend_assessment')
  })

  it('要求先检索知识库再回答，未命中时说明而不是编造', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('先检索再回答')
    expect(text).toContain('knowledge_search')
    expect(text).toContain('resource_lookup')
    expect(text).toContain('平台里暂时没有对应资源')
    // 寒暄与能力询问不强制检索，避免每轮都多一次工具往返
    expect(text).toContain('你能提供什么帮助')
  })

  it('禁止输出「选项：」列表、JSON 与代码块', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不输出"选项："列表')
    expect(text).toContain('不输出 JSON')
    expect(text).toContain('不输出代码块')
  })

  it('正文不写初步理解/免责声明，也不写来源标注与卡片内部标识', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不要在回答开头加')
    expect(text).toContain('先说我的初步理解')
    expect(text).toContain('不要在正文里写来源标注')
    expect(text).toContain('模块英文 ID')
    expect(text).toContain('约 N 分钟')
  })

  it('按情境回应：事实查询直接回答，情绪出现时共情且不附和', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('共情开场')
    expect(text).toContain('事实查询直接回答')
    expect(text).toContain('不强制共情开场')
    expect(text).toContain('教师表达情绪时')
    // 空泛套话必须明确禁止
    expect(text).toContain('我理解你的感受')
    expect(text).toContain('这确实不容易')
    // 共情不等于附和：不认同负面评价、不替对方定性、不替教师下结论
    expect(text).toContain('共情不等于附和')
    expect(text).toContain('不讲理')
    expect(text).toContain('谁对谁错')
    expect(text).toContain('您不对')
    expect(text.indexOf('共情开场')).toBeLessThan(text.indexOf('回答先行'))
  })

  it('共情要贴着他的原话，不放大也不缩小情绪', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不放大也不缩小')
    expect(text).toContain('就不要写成快撑不住了')
  })

  it('避免报告腔：禁止排比句、感叹号连用与首先其次最后式表达', () => {
    const text = buildFormatInstruction({})
    expect(text).toContain('不要排比句')
    expect(text).toContain('首先/其次/最后')
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

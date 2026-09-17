import { describe, expect, it } from 'vitest'
import { decideEntryObjectUse, decideMentionResolution, matchMentionedNames, type MentionedObject } from '../server/domain/assistant-object-mention'
import { effectiveObject } from '../server/agent/tools/record-context'
import { buildAgentTools } from '../server/agent/tools'
import { resolveObjectScopedArgs } from '../server/agent/tools/record-context'

const student = (id: string, label: string): MentionedObject => ({ type: 'student', id, label })
const klass = (id: string, label: string): MentionedObject => ({ type: 'class', id, label })

describe('本轮对象识别（消息里写学生/班级名）', () => {
  it('按名单做包含匹配：姓名出现在句中即命中，长度不足 2 字的不作为依据', () => {
    expect(matchMentionedNames('张小明今天又没交数学作业', ['张小明', '李雷'])).toEqual(['张小明'])
    // 含数字、间隔号或超长姓名也能命中（切片段查哈希做不到）
    expect(matchMentionedNames('验收学生-1789524636366 的情况', ['验收学生-1789524636366'])).toEqual(['验收学生-1789524636366'])
    expect(matchMentionedNames('阿依古丽·买买提这周请假了', ['阿依古丽·买买提'])).toEqual(['阿依古丽·买买提'])
    // 单字姓名在自由文本里误命中概率过高，不参与识别
    expect(matchMentionedNames('王老师说他今天没来', ['王'])).toEqual([])
  })

  it('恰好命中一个学生时按该学生回答（同句出现班级名也以学生为准）', () => {
    expect(decideMentionResolution([student('s1', '张小明')], [klass('c1', '三年二班')]))
      .toEqual({ kind: 'single', object: { type: 'student', id: 's1', label: '张小明' } })
  })

  it('没有学生、恰好一个班级时按班级回答', () => {
    expect(decideMentionResolution([], [klass('c1', '三年二班')]))
      .toEqual({ kind: 'single', object: { type: 'class', id: 'c1', label: '三年二班' } })
  })

  it('命中多个对象时不猜，返回候选交教师确认', () => {
    const ambiguous = decideMentionResolution([student('s1', '张小明'), student('s2', '张小军')], [])
    expect(ambiguous.kind).toBe('ambiguous')
    expect(ambiguous.kind === 'ambiguous' && ambiguous.candidates).toHaveLength(2)
    expect(decideMentionResolution([], [klass('c1', '三年二班'), klass('c2', '四年二班')]).kind).toBe('ambiguous')
  })

  it('没有命中时返回 none，不推断「没有这个学生」', () => {
    expect(decideMentionResolution([], [])).toEqual({ kind: 'none' })
  })

  it('未绑定会话时识别结果作为本轮对象；已绑定会话只提示是否切换', () => {
    const binding = { type: 'student' as const, id: 's-bound' }
    // 未绑定：单命中 → 本轮对象，无候选、无切换提示
    expect(decideEntryObjectUse({ binding: null, mention: { kind: 'single', object: student('s1', '张小明') } }))
      .toEqual({ turnContext: { type: 'student', id: 's1', label: '张小明' }, candidates: [], suggestedSwitch: null })
    // 未绑定：多命中 → 候选交界面点选
    const ambiguous = decideEntryObjectUse({
      binding: null,
      mention: { kind: 'ambiguous', candidates: [student('s1', '张小明'), student('s2', '张小军')] }
    })
    expect(ambiguous.candidates).toHaveLength(2)
    // 已绑定：提到的是同一个对象 → 不提示
    expect(decideEntryObjectUse({ binding, mention: { kind: 'single', object: student('s-bound', '李雷') } }).suggestedSwitch)
      .toBeNull()
    // 已绑定：提到另一个对象 → 只提示切换，不收口本轮（避免把两个学生的信息混在一轮里）
    const switched = decideEntryObjectUse({ binding, mention: { kind: 'single', object: student('s2', '张小明') } })
    expect(switched.turnContext).toBeNull()
    expect(switched.suggestedSwitch).toEqual({ type: 'student', id: 's2', label: '张小明' })
    // 已绑定：多命中时不打扰教师
    expect(decideEntryObjectUse({ binding, mention: { kind: 'ambiguous', candidates: [student('s2', '张小明')] } }).suggestedSwitch)
      .toBeNull()
  })
})

describe('本轮对象的作用范围', () => {
  const turn = { type: 'student' as const, id: 's-turn', label: '张小明' }

  it('会话已绑定对象时以绑定为准，一句提及不改写作用范围', () => {
    const binding = { type: 'student' as const, id: 's-bound', label: '李雷' }
    expect(effectiveObject({ businessContext: binding, turnContext: turn })).toEqual(binding)
    expect(resolveObjectScopedArgs(effectiveObject({ businessContext: binding, turnContext: turn }), {}).args)
      .toEqual({ studentId: 's-bound' })
  })

  it('会话未绑定对象时按本轮识别到的对象收口（方案、沟通、评估历史与档案读取一致）', () => {
    expect(effectiveObject({ businessContext: null, turnContext: turn })).toEqual(turn)
    expect(resolveObjectScopedArgs(effectiveObject({ businessContext: null, turnContext: turn }), {}).args)
      .toEqual({ studentId: 's-turn' })
    // 沟通记录没有班级维度：本轮对象是班级时不兜底，退回教师维度并逐条标注对象
    const classTurn = { type: 'class' as const, id: 'c-turn', label: '三年二班' }
    expect(resolveObjectScopedArgs(effectiveObject({ businessContext: null, turnContext: classTurn }), {}, ['student', 'guardian']).args)
      .toEqual({})
  })

  it('有本轮对象时才暴露档案读取工具，不带档案咨询时一律不暴露', () => {
    const base = { schoolId: 's', userId: 'u', sessionId: 'c' }
    const names = (ctx: Parameters<typeof buildAgentTools>[0]) => buildAgentTools(ctx).map(tool => tool.name)
    expect(names({ ...base, turnContext: turn })).toContain('record_snapshot')
    expect(names({ ...base, businessContext: { type: 'student', id: 's-bound', label: '李雷' } })).toContain('record_snapshot')
    expect(names(base)).not.toContain('record_snapshot')
    expect(names({ ...base, turnContext: turn, withoutRecord: true })).toEqual(['knowledge_search', 'module_route', 'resource_lookup', 'resource_detail'])
  })
})

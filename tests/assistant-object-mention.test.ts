import { describe, expect, it } from 'vitest'
import { decideEntryObjectUse, decideMentionObjects, matchMentionedNames, type MentionedObject } from '../server/domain/assistant-object-mention'
import { effectiveObjects, resolveAssistantScope, scopeMarker } from '../server/agent/tools/record-context'
import { buildAgentTools } from '../server/agent/tools'

const student = (id: string, label: string): MentionedObject => ({ type: 'student', id, label })
const klass = (id: string, label: string): MentionedObject => ({ type: 'class', id, label })
const ref = (type: 'student' | 'class' | 'guardian', id: string, label: string) => ({ type, id, label })

describe('本轮对象识别（消息里写学生/班级名）', () => {
  it('按名单做包含匹配：姓名出现在句中即命中，长度不足 2 字的不作为依据', () => {
    expect(matchMentionedNames('张小明今天又没交数学作业', ['张小明', '李雷'])).toEqual(['张小明'])
    // 含数字、间隔号或超长姓名也能命中（切片段查哈希做不到）
    expect(matchMentionedNames('验收学生-1789524636366 的情况', ['验收学生-1789524636366'])).toEqual(['验收学生-1789524636366'])
    expect(matchMentionedNames('阿依古丽·买买提这周请假了', ['阿依古丽·买买提'])).toEqual(['阿依古丽·买买提'])
    // 单字姓名在自由文本里误命中概率过高，不参与识别
    expect(matchMentionedNames('王老师说他今天没来', ['王'])).toEqual([])
  })

  it('命中一个学生时按该学生回答（同句出现班级名也不并入）', () => {
    expect(decideMentionObjects([student('s1', '张小明')], [klass('c1', '三年二班')]))
      .toEqual({ kind: 'objects', objects: [student('s1', '张小明')], candidates: [] })
  })

  it('没有学生时按班级；多个班级整体作为本轮对象集', () => {
    expect(decideMentionObjects([], [klass('c1', '三年二班')]))
      .toEqual({ kind: 'objects', objects: [klass('c1', '三年二班')], candidates: [] })
    expect(decideMentionObjects([], [klass('c1', '三年二班'), klass('c2', '四年二班')]).objects)
      .toEqual([klass('c1', '三年二班'), klass('c2', '四年二班')])
  })

  it('命中多个学生时整体作为本轮对象集（@ 多名学生）', () => {
    expect(decideMentionObjects([student('s1', '张小明'), student('s2', '张小军')], []))
      .toEqual({
        kind: 'objects',
        objects: [student('s1', '张小明'), student('s2', '张小军')],
        candidates: []
      })
  })

  it('同名对应多条档案时不替教师猜，降级为候选', () => {
    const duplicated = decideMentionObjects([student('s1', '张小明'), student('s2', '张小明')], [])
    expect(duplicated.kind).toBe('objects')
    expect(duplicated.kind === 'objects' && duplicated.objects).toEqual([])
    expect(duplicated.kind === 'objects' && duplicated.candidates).toHaveLength(2)
  })

  it('命中数超过上限（5 个）时多出的进候选', () => {
    const many = Array.from({ length: 7 }, (_, index) => student(`s${index}`, `学生${index}`))
    const resolved = decideMentionObjects(many, [])
    expect(resolved.kind === 'objects' && resolved.objects).toHaveLength(5)
    expect(resolved.kind === 'objects' && resolved.candidates).toHaveLength(2)
  })

  it('没有命中时返回 none，不推断「没有这个学生」', () => {
    expect(decideMentionObjects([], [])).toEqual({ kind: 'none' })
  })

  it('未绑定会话时识别结果作为本轮对象集；已绑定会话只提示是否整组切换', () => {
    const binding = [ref('student', 's-bound', '李雷')]
    // 未绑定：命中 → 本轮对象集，无候选、无切换提示
    expect(decideEntryObjectUse({ binding: [], mention: { kind: 'objects', objects: [student('s1', '张小明'), student('s2', '张小军')], candidates: [] } }))
      .toEqual({
        turnObjects: [student('s1', '张小明'), student('s2', '张小军')],
        candidates: [],
        suggestedSwitch: []
      })
    // 未绑定：同名档案 → 候选交界面点选
    const duplicated = decideEntryObjectUse({
      binding: [],
      mention: { kind: 'objects', objects: [], candidates: [student('s1', '张小明'), student('s2', '张小明')] }
    })
    expect(duplicated.turnObjects).toEqual([])
    expect(duplicated.candidates).toHaveLength(2)
    // 已绑定：提到的是同一组对象 → 不提示
    expect(decideEntryObjectUse({ binding, mention: { kind: 'objects', objects: [student('s-bound', '李雷')], candidates: [] } }).suggestedSwitch)
      .toEqual([])
    // 已绑定：提到不同的一组对象 → 只提示切换，不收口本轮（避免把两组对象的信息混在一轮里）
    const switched = decideEntryObjectUse({
      binding,
      mention: { kind: 'objects', objects: [student('s2', '张小明'), student('s3', '张小军')], candidates: [] }
    })
    expect(switched.turnObjects).toEqual([])
    expect(switched.suggestedSwitch).toEqual([student('s2', '张小明'), student('s3', '张小军')])
    // 已绑定：没有识别到对象时不打扰教师
    expect(decideEntryObjectUse({ binding, mention: { kind: 'none' } }).suggestedSwitch).toEqual([])
  })
})

describe('本轮对象的作用范围', () => {
  const turn = [ref('student', 's-turn', '张小明')]

  it('会话已绑定对象时以绑定为准，一句提及不改写作用范围', () => {
    const binding = [ref('student', 's-bound', '李雷')]
    expect(effectiveObjects({ businessContexts: binding, turnContexts: turn })).toEqual(binding)
    expect(resolveAssistantScope(effectiveObjects({ businessContexts: binding, turnContexts: turn }), {}).objects)
      .toEqual([{ type: 'student', id: 's-bound' }])
  })

  it('会话未绑定对象时按本轮识别到的对象集收口（方案、沟通、评估历史与档案读取一致）', () => {
    expect(effectiveObjects({ businessContexts: [], turnContexts: turn })).toEqual(turn)
    expect(resolveAssistantScope(effectiveObjects({ businessContexts: [], turnContexts: turn }), {}).objects)
      .toEqual([{ type: 'student', id: 's-turn' }])
    // 多对象：@ 多名学生时逐个对象都参与收口
    const twoTurns = [ref('student', 's1', '张小明'), ref('student', 's2', '张小军')]
    expect(resolveAssistantScope(twoTurns, {}).objects).toEqual([
      { type: 'student', id: 's1' },
      { type: 'student', id: 's2' }
    ])
    // 沟通记录没有班级维度：对象集里只有班级时不兜底，退回教师维度并逐条标注对象
    const classTurn = [ref('class', 'c-turn', '三年二班')]
    expect(resolveAssistantScope(classTurn, {}, ['student', 'guardian']).objects).toEqual([])
    // 混合对象集：按工具能力过滤，保留支持的类型
    expect(resolveAssistantScope(
      [ref('class', 'c-turn', '三年二班'), ref('student', 's1', '张小明')],
      {},
      ['student', 'guardian']
    ).objects).toEqual([{ type: 'student', id: 's1' }])
  })

  it('scope 标记区分单个与多个对象', () => {
    expect(scopeMarker([])).toBeNull()
    expect(scopeMarker([{ type: 'student', id: 's1' }])).toBe('current_object')
    expect(scopeMarker([{ type: 'student', id: 's1' }, { type: 'student', id: 's2' }])).toBe('current_objects')
  })

  it('有本轮对象时才暴露档案读取工具，不带档案咨询时一律不暴露', () => {
    const base = { schoolId: 's', userId: 'u', sessionId: 'c' }
    const names = (ctx: Parameters<typeof buildAgentTools>[0]) => buildAgentTools(ctx).map(tool => tool.name)
    expect(names({ ...base, turnContexts: turn })).toContain('record_snapshot')
    expect(names({ ...base, businessContexts: [ref('student', 's-bound', '李雷')] })).toContain('record_snapshot')
    expect(names(base)).not.toContain('record_snapshot')
    expect(names({ ...base, turnContexts: turn, withoutRecord: true })).toEqual(['knowledge_search', 'module_route', 'resource_lookup', 'resource_detail'])
  })
})

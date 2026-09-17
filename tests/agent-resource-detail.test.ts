import { describe, expect, it } from 'vitest'
import {
  RESOURCE_DETAIL_LIMIT,
  RESOURCE_DETAIL_STEP_LIMIT,
  buildAttributionDetailItems,
  buildToolDetailItems,
  resourceDetailTool
} from '../server/agent/tools/resource-detail'
import { collectToolEvidence } from '../server/agent/evidence'
import { goldenToolPayload } from './fixtures/business-resource-golden'
import type { AgentToolContext } from '../server/agent/types'

const ctx = {
  event: {},
  user: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' }
} as unknown as AgentToolContext

/** 与已发布归因库 payload 同形状的样例（字段名取自 attributionItemSchema）。 */
const attributionPayload = {
  attributionItems: [
    {
      code: 'SC_AT_01',
      name: '注意力分散型',
      highManifestation: '课堂持续走神，需反复提醒；作业拖拉，完不成课堂任务',
      typicalTrigger: '需区分发展性注意力波动（低年级正常）与病理性持续注意力缺陷',
      suggestedAction: '用定时器分段法 + 关系锚定开始干预',
      toolTags: ['学习', 'student_case']
    },
    {
      code: 'SC_AT_02',
      name: '动机缺失型',
      highManifestation: '对学业失去兴趣，不做不交作业',
      typicalTrigger: '内在动机系统被长期挫败感破坏',
      suggestedAction: '先补一次小成功体验，再谈目标',
      toolTags: ['学习']
    },
    {
      code: 'SC_AT_03',
      name: '技能不足型',
      highManifestation: '识字量、计算能力落后导致学业困难',
      suggestedAction: '拆小步子补基础技能',
      toolTags: []
    }
  ]
}

describe('三库明细：归因库字段映射', () => {
  it('返回表现/成因/建议动作/标签，字段名与已发布 payload 对齐', () => {
    const items = buildAttributionDetailItems(attributionPayload)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      libraryType: 'attribution',
      code: 'SC_AT_01',
      name: '注意力分散型',
      manifestations: '课堂持续走神，需反复提醒；作业拖拉，完不成课堂任务',
      causes: '需区分发展性注意力波动（低年级正常）与病理性持续注意力缺陷',
      suggestedAction: '用定时器分段法 + 关系锚定开始干预',
      tags: ['学习', 'student_case']
    })
    // 缺失字段返回 null，不臆造内容
    expect(items[2]?.causes).toBeNull()
  })

  it('按现象关键词筛选，并让名称命中的条目排在前面', () => {
    const bySymptom = buildAttributionDetailItems(attributionPayload, { keyword: '作业拖拉' })
    expect(bySymptom.map(item => item.name)).toEqual(['注意力分散型'])
    const byName = buildAttributionDetailItems(attributionPayload, { keyword: '动机' })
    expect(byName[0]?.name).toBe('动机缺失型')
  })

  it('按名称包含匹配，且条数不超过上限', () => {
    expect(buildAttributionDetailItems(attributionPayload, { name: '技能' }).map(item => item.name)).toEqual(['技能不足型'])
    expect(buildAttributionDetailItems(attributionPayload, { limit: 2 })).toHaveLength(2)
    expect(RESOURCE_DETAIL_LIMIT).toBeLessThanOrEqual(6)
  })

  it('正文命中防线的字段置空，名称含禁用措辞时整条丢弃', () => {
    const items = buildAttributionDetailItems({
      attributionItems: [
        { name: '教养不当型', suggestedAction: '按红线熔断流程转交心理专员', highManifestation: '体罚、言语羞辱或忽视' },
        { name: '危机响应迟滞', highManifestation: '上报与联动明显慢于制度要求' },
        { name: '六力诊断型', highManifestation: '六力模型的执行功能维度偏低', suggestedAction: '先安排一次分段任务' }
      ]
    })
    // 「危机响应迟滞」名称本身是教师侧禁用措辞 → 整条不给；含内部编码的名称（工具名/体系名）保留
    expect(items.map(item => item.name)).toEqual(['教养不当型', '六力诊断型'])
    expect(items[0]?.suggestedAction).toBeNull()
    // 正文里的红线词（红线）与内部编码（六力）一律置空，名称之外的文本不外发
    expect(items[1]?.manifestations).toBeNull()
    expect(items[1]?.suggestedAction).toBe('先安排一次分段任务')
    expect(JSON.stringify(items)).not.toContain('红线')
  })
})

describe('三库明细：工具库字段映射', () => {
  it('返回适用症状与关键步骤；症状文本命中红线词时只置空该字段，不挡掉整张工具卡', () => {
    const items = buildToolDetailItems(goldenToolPayload.tools)
    expect(items).toHaveLength(1)
    expect(items[0]?.name).toBe('三步降温沟通卡')
    // 样例症状是「家长情绪激烈但未触发红线」：整句按防线置空，步骤与名称照常返回
    expect(items[0]?.manifestations).toBeNull()
    expect(items[0]?.steps).toEqual(['接住情绪', '复述事实', '约定下一步'])
    expect(JSON.stringify(items)).not.toContain('红线')
    expect(JSON.stringify(items)).not.toContain('应急预案')
  })

  it('步骤条数受上限约束，缺 name 的条目不返回', () => {
    const steps = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 步`)
    const items = buildToolDetailItems([{ code: 'X', name: '分段推进卡', steps }, { code: 'Y', symptoms: '没有名称' }])
    expect(items).toHaveLength(1)
    expect(items[0]?.steps).toHaveLength(RESOURCE_DETAIL_STEP_LIMIT)
    expect(RESOURCE_DETAIL_STEP_LIMIT).toBeLessThanOrEqual(8)
  })

  it('按关键词在症状与步骤里筛选', () => {
    expect(buildToolDetailItems(goldenToolPayload.tools, { keyword: '降温' })).toHaveLength(1)
    expect(buildToolDetailItems(goldenToolPayload.tools, { keyword: '没有这个词' })).toHaveLength(0)
  })
})

describe('三库明细：工具参数校验与证据归类', () => {
  it('缺少必填模块时返回空结果与提示，不抛错', async () => {
    const result = await resourceDetailTool.execute({}, ctx) as { items: unknown[], message?: string }
    expect(result.items).toEqual([])
    expect(result.message).toBeTruthy()
  })

  it('库类型非法时返回提示（只支持归因库与工具库）', async () => {
    const result = await resourceDetailTool.execute({ module: 'student_case', libraryType: 'assessment' }, ctx) as { items: unknown[], message?: string }
    expect(result.items).toEqual([])
    expect(result.message).toContain('attribution')
  })

  it('明细作为平台正式资料进入证据（kind=knowledge），逐条给证据', () => {
    const evidence = collectToolEvidence('resource_detail', {
      status: 'success',
      items: [
        { libraryType: 'attribution', code: 'SC_AT_01', name: '注意力分散型' },
        { libraryType: 'attribution', code: 'SC_AT_02', name: '动机缺失型' }
      ]
    })
    expect(evidence.map(item => item.kind)).toEqual(['knowledge', 'knowledge'])
    expect(evidence.map(item => item.id)).toEqual([
      'resource_detail:attribution:SC_AT_01',
      'resource_detail:attribution:SC_AT_02'
    ])
  })

  it('零命中按 observation 归类，不能据此断言平台没有该内容', () => {
    const evidence = collectToolEvidence('resource_detail', { status: 'empty', items: [] })
    expect(evidence[0]?.kind).toBe('observation')
  })
})

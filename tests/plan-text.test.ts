import { describe, expect, it } from 'vitest'
import { buildPlanTextSegments, parsePlanText } from '../app/utils/plan-text'

describe('方案正文结构化排版（parsePlanText）', () => {
  it('空文本返回空数组', () => {
    expect(parsePlanText('')).toEqual([])
    expect(parsePlanText('   \n  ')).toEqual([])
    expect(parsePlanText(null)).toEqual([])
    expect(parsePlanText(undefined)).toEqual([])
  })

  it('多条目方案块：中文序号标题单独成行，标题后的正文另起一段', () => {
    const blocks = parsePlanText('一、针对「任务过载」：当你发现待办清单越写越长的时候，拿这张清单出来过一遍。')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.kind).toBe('heading')
    expect(blocks[0]!.marker).toBe('一、')
    expect(blocks[0]!.segments).toEqual([
      { text: '针对' },
      { text: '「任务过载」', emphasis: 'keyword' },
    ])
    expect(blocks[1]!.kind).toBe('paragraph')
    expect(blocks[1]!.segments.map(segment => segment.text).join('')).toBe(
      '当你发现待办清单越写越长的时候，拿这张清单出来过一遍。',
    )
  })

  it('单条目方案块：无序号标题行仍识别为小标题', () => {
    const blocks = parsePlanText('使用工具「责任边界思维」\n找一张纸，画两个圈：内圈是你直接能控制的事。')
    expect(blocks[0]!.kind).toBe('heading')
    expect(blocks[0]!.marker).toBeUndefined()
    expect(blocks[0]!.segments).toEqual([
      { text: '使用工具' },
      { text: '「责任边界思维」', emphasis: 'keyword' },
    ])
    expect(blocks[1]!.kind).toBe('paragraph')
  })

  it('三库机械条目的阿拉伯序号步骤与提示/话术/达标标签分行呈现', () => {
    const blocks = parsePlanText([
      '1. 结构化沟通三步法: 先让两个孩子分开。',
      '提示：注意只听、不评判。',
      '话术：“我们先停一下，喝口水。”',
      '达标：双方都能平静说完。',
    ].join('\n'))
    expect(blocks.map(block => block.kind)).toEqual(['step', 'paragraph', 'paragraph', 'paragraph'])
    expect(blocks[0]!.marker).toBe('1.')
    expect(blocks[0]!.segments[0]!.text).toBe('结构化沟通三步法: 先让两个孩子分开。')
    expect(blocks[1]!.segments[0]).toEqual({ text: '提示：', emphasis: 'label' })
    expect(blocks[2]!.segments[0]).toEqual({ text: '话术：', emphasis: 'label' })
    expect(blocks[3]!.segments[0]).toEqual({ text: '达标：', emphasis: 'label' })
  })

  it('带圈序号按列表项渲染（AI 改写列举问题清单时使用）', () => {
    const blocks = parsePlanText('①做老师以来，最让你骄傲的一个瞬间是什么？\n②你最近一次觉得「做不下去了」是什么时候？')
    expect(blocks[0]!.kind).toBe('step')
    expect(blocks[0]!.marker).toBe('①')
    expect(blocks[1]!.kind).toBe('step')
    expect(blocks[1]!.segments).toContainEqual({ text: '「做不下去了」', emphasis: 'keyword' })
  })

  it('配套工具块单独作为子标题，与建议正文区分', () => {
    const blocks = parsePlanText([
      '一、针对「边界感丧失」',
      '先做一次提前说明，别等事情发生了才讲。',
      '',
      '—— 配套工具：同事深度对话卡',
      '先做一套「深度对话卡片」，每张写一个开放性问题。',
    ].join('\n'))
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'subheading', 'paragraph'])
    expect(blocks[2]!.marker).toBe('——')
    expect(blocks[2]!.segments).toEqual([{ text: '配套工具：同事深度对话卡' }])
  })

  it('圆点列表项识别为步骤', () => {
    const blocks = parsePlanText('• 先做一次提前说明\n- 已经碰上了，就用标准回应')
    expect(blocks.map(block => block.kind)).toEqual(['step', 'step'])
    expect(blocks[0]!.marker).toBe('•')
  })

  it('短引号内容按关键词加粗，长引号内容（可直接开口的话术）按引用着色', () => {
    const short = buildPlanTextSegments('不说「你这个想法不对」。')
    expect(short).toContainEqual({ text: '「你这个想法不对」', emphasis: 'keyword' })
    const long = buildPlanTextSegments('你可以说：「各位家长，我的工作时间是周一到周五 8:00—17:00，晚上和周末是家庭时间。」')
    expect(long).toContainEqual({
      text: '「各位家长，我的工作时间是周一到周五 8:00—17:00，晚上和周末是家庭时间。」',
      emphasis: 'quote',
    })
  })

  it('残留的 Markdown 粗体按关键词加粗并去掉星号', () => {
    const segments = buildPlanTextSegments('重点是 **先处理情绪**，再谈事情。')
    expect(segments).toEqual([
      { text: '重点是 ' },
      { text: '先处理情绪', emphasis: 'keyword' },
      { text: '，再谈事情。' },
    ])
  })

  it('能力清单这类标签加粗，普通句子里的冒号不加粗', () => {
    const labelled = parsePlanText('班级管理能力：能不能建立秩序、带出氛围。')
    expect(labelled[0]!.segments[0]).toEqual({ text: '班级管理能力：', emphasis: 'label' })
    // 冒号前同样是短句，但不属于标签词汇表：整句保持普通正文，避免满屏重点
    const plain = parsePlanText('规则很简单：每个人轮流说一句感谢的话。')
    expect(plain[0]!.kind).toBe('paragraph')
    expect(plain[0]!.segments.every(segment => !segment.emphasis)).toBe(true)
  })

  it('未收尾的引号与空行不产生空段落', () => {
    const blocks = parsePlanText('第一句「没写完的引号\n\n第二句。')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.segments.map(segment => segment.text).join('')).toBe('第一句「没写完的引号')
    expect(blocks[1]!.segments.map(segment => segment.text).join('')).toBe('第二句。')
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAX_GENERATED_TITLE_LENGTH,
  MAX_GENERATED_TOOLS,
  MAX_TOOL_POLISH_ATTEMPTS,
  MAX_TOOL_POLISH_CONTENT,
  mergeActionResults,
  mergePolishResults,
  parsePolishOutput,
  runGeneratedPolishRetry,
  runPolishWithRetry,
  type PolishAttemptResult,
  type PolishTool,
} from '../server/domain/tool-step-polish'

const inputTools: PolishTool[] = [
  { title: '结构化沟通三步法', content: '1. 分开冷静: 分开冷静\n   话术：我们先休息一下\n   达标：两人平静', code: 'T-001' },
  { title: '家庭作业约定术', content: '1. 约定时间: 每周固定\n   提示：提前一天提醒\n   达标：按时完成两次', code: 'T-002' },
]

const okOutput = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  tools: [
    { title: '结构化沟通三步法', content: '先让两个孩子分开，各自冷静几分钟。你可以这样说：“我们先停一下，喝口水，过会儿再聊。”' },
    { title: '家庭作业约定术', content: '先和孩子约好每周固定时间做作业，提前一天提醒他。' },
  ],
  ...overrides,
})

describe('parsePolishOutput', () => {
  it('合法输出全部通过校验并关联回输入工具', () => {
    const result = parsePolishOutput(okOutput(), inputTools)
    expect(result.errors).toEqual([])
    expect(result.matched.size).toBe(2)
    expect(result.matched.get('结构化沟通三步法')).toContain('先让两个孩子分开')
    expect(result.matched.get('家庭作业约定术')).toContain('每周固定时间')
  })

  it('输出数量与输入不一致时报错', () => {
    const output = JSON.stringify({ tools: [{ title: '结构化沟通三步法', content: 'A' }] })
    const result = parsePolishOutput(output, inputTools)
    expect(result.errors.join('；')).toContain('数量 1，应为 2')
  })

  it('输出中出现未知工具名时报错', () => {
    const output = JSON.stringify({ tools: [{ title: '不存在的工具', content: 'A' }] })
    const result = parsePolishOutput(output, inputTools)
    expect(result.errors.join('；')).toContain('输入中没有的工具名')
  })

  it('内容为空时报错', () => {
    const output = JSON.stringify({ tools: [{ title: '结构化沟通三步法', content: '   ' }, { title: '家庭作业约定术', content: 'B' }] })
    const result = parsePolishOutput(output, inputTools)
    expect(result.errors.join('；')).toContain('内容为空')
  })

  it('内容超长时报错', () => {
    const output = JSON.stringify({ tools: [{ title: '结构化沟通三步法', content: 'x'.repeat(MAX_TOOL_POLISH_CONTENT + 1) }, { title: '家庭作业约定术', content: 'B' }] })
    const result = parsePolishOutput(output, inputTools)
    expect(result.errors.join('；')).toContain('内容过长')
  })

  it('缺少某个工具时报错', () => {
    const output = JSON.stringify({ tools: [{ title: '结构化沟通三步法', content: 'A' }] })
    const result = parsePolishOutput(output, inputTools)
    expect(result.errors.join('；')).toContain('缺少工具')
  })

  it('非 JSON 输出直接报解析错误', () => {
    const result = parsePolishOutput('not-json', inputTools)
    expect(result.errors.join('；')).toContain('不是合法 JSON')
  })

  it('结构非法（缺 tools 字段）时报校验错误', () => {
    const result = parsePolishOutput(JSON.stringify({ items: [] }), inputTools)
    expect(result.errors.join('；')).toContain('结构校验失败')
  })
})

describe('mergePolishResults', () => {
  it('通过校验的工具用 AI 版、其余保留三库原文，工具编码不丢', () => {
    const matched = new Map([['结构化沟通三步法', '人话版 A']])
    const merged = mergePolishResults(inputTools, matched)
    expect(merged[0]).toEqual({ ...inputTools[0], content: '人话版 A' })
    expect(merged[1]).toEqual(inputTools[1])
  })

  it('无任何匹配时原样返回（逐项回退）', () => {
    const merged = mergePolishResults(inputTools, new Map())
    expect(merged).toEqual(inputTools)
  })
})

describe('runPolishWithRetry', { timeout: 15_000 }, () => {
  it('首次尝试全部通过则直接返回，不重试', async () => {
    let calls = 0
    const { tools, attempts } = await runPolishWithRetry(inputTools, async () => {
      calls++
      return { matched: new Map([['结构化沟通三步法', 'A'], ['家庭作业约定术', 'B']]), errors: [] }
    })
    expect(calls).toBe(1)
    expect(attempts).toBe(1)
    expect(tools[0].content).toBe('A')
  })

  it('首次部分失败，重试全部通过；重试时携带上次输出', async () => {
    const calls: PolishAttemptResult[] = []
    const { tools, attempts } = await runPolishWithRetry(inputTools, async (_attempt, previous) => {
      calls.push(previous || { matched: new Map(), errors: [] })
      if (!previous) {
        return { matched: new Map([['结构化沟通三步法', 'A']]), errors: ['缺少工具「家庭作业约定术」'], raw: '{"tools":[...]}' }
      }
      expect(previous.errors.join('；')).toContain('缺少工具')
      expect(previous.raw).toContain('"tools"')
      return { matched: new Map([['结构化沟通三步法', 'A'], ['家庭作业约定术', 'B']]), errors: [] }
    })
    expect(attempts).toBe(2)
    expect(tools.map(tool => tool.content)).toEqual(['A', 'B'])
  })

  it('连续 3 次失败：不超上限，全部回退原文', async () => {
    let calls = 0
    const { tools, attempts } = await runPolishWithRetry(inputTools, async () => {
      calls++
      return { matched: new Map([['结构化沟通三步法', '部分成功']]), errors: ['缺少工具「家庭作业约定术」'] }
    })
    expect(calls).toBe(MAX_TOOL_POLISH_ATTEMPTS)
    expect(attempts).toBe(MAX_TOOL_POLISH_ATTEMPTS)
    // 合法项保留 AI 版，非法项回退原文
    expect(tools[0].content).toBe('部分成功')
    expect(tools[1]).toEqual(inputTools[1])
  })
})

const generatedOutput = (tools: Array<{ title: string, content: string }>) =>
  JSON.stringify({ tools })

describe('parsePolishOutput 模式 B（expected 为空 · 无工具生成）', () => {
  it('合法输出 1 条通过', () => {
    const result = parsePolishOutput(
      generatedOutput([{ title: '课间冲突化解四步', content: '先把两个孩子隔开，各自冷静后分别询问经过……' }]),
      [],
    )
    expect(result.errors).toEqual([])
    expect(result.matched.size).toBe(1)
    expect(result.matched.get('课间冲突化解四步')).toContain('先把两个孩子隔开')
  })

  it('上限 3 条全部通过', () => {
    const tools = Array.from({ length: MAX_GENERATED_TOOLS }, (_, i) => ({ title: `建议${i + 1}`, content: `内容${i + 1}` }))
    const result = parsePolishOutput(generatedOutput(tools), [])
    expect(result.errors).toEqual([])
    expect(result.matched.size).toBe(MAX_GENERATED_TOOLS)
  })

  it('title 恰好 30 字（上限边界）通过', () => {
    const title = '课'.repeat(MAX_GENERATED_TITLE_LENGTH)
    const result = parsePolishOutput(generatedOutput([{ title, content: '内容' }]), [])
    expect(result.errors).toEqual([])
    expect(result.matched.has(title)).toBe(true)
  })

  it('输出 0 条报数量错误', () => {
    const result = parsePolishOutput(generatedOutput([]), [])
    expect(result.errors.join('；')).toContain('数量 0，应为 1-3')
    expect(result.matched.size).toBe(0)
  })

  it('数量超过 MAX_GENERATED_TOOLS 时报数量错误', () => {
    const many = Array.from({ length: MAX_GENERATED_TOOLS + 1 }, (_, i) => ({ title: `建议${i + 1}`, content: `内容${i + 1}` }))
    const result = parsePolishOutput(generatedOutput(many), [])
    expect(result.errors.join('；')).toContain(`数量 ${MAX_GENERATED_TOOLS + 1}，应为 1-${MAX_GENERATED_TOOLS}`)
  })

  it('title 为空（仅空白）时报错', () => {
    const result = parsePolishOutput(generatedOutput([{ title: '   ', content: '内容' }]), [])
    expect(result.errors.join('；')).toContain('存在标题为空的工具项')
    expect(result.matched.size).toBe(0)
  })

  it('title 超过 30 字时报错', () => {
    const longTitle = '长'.repeat(MAX_GENERATED_TITLE_LENGTH + 1)
    const result = parsePolishOutput(generatedOutput([{ title: longTitle, content: '内容' }]), [])
    expect(result.errors.join('；')).toContain('过长')
    expect(result.errors.join('；')).toContain(`上限 ${MAX_GENERATED_TITLE_LENGTH}`)
    expect(result.matched.size).toBe(0)
  })

  it('title 重复时报错且只保留首个', () => {
    const result = parsePolishOutput(generatedOutput([
      { title: '建议一', content: '首个版本' },
      { title: '建议一', content: '重复版本' },
    ]), [])
    expect(result.errors.join('；')).toContain('重复输出')
    expect(result.matched.size).toBe(1)
    expect(result.matched.get('建议一')).toBe('首个版本')
  })

  it('content 为空时报错', () => {
    const result = parsePolishOutput(generatedOutput([{ title: '建议一', content: '   ' }]), [])
    expect(result.errors.join('；')).toContain('内容为空')
    expect(result.matched.size).toBe(0)
  })

  it('content 超过 MAX_TOOL_POLISH_CONTENT 时报错', () => {
    const result = parsePolishOutput(
      generatedOutput([{ title: '建议一', content: 'x'.repeat(MAX_TOOL_POLISH_CONTENT + 1) }]),
      [],
    )
    expect(result.errors.join('；')).toContain('内容过长')
    expect(result.matched.size).toBe(0)
  })

  it('混合输出：合法项保留进 matched，各非法项分别报错', () => {
    const result = parsePolishOutput(generatedOutput([
      { title: '建议一', content: '内容一' },
      { title: '长'.repeat(MAX_GENERATED_TITLE_LENGTH + 1), content: '内容二' },
      { title: '建议二', content: '' },
    ]), [])
    expect(result.errors.join('；')).toContain('过长')
    expect(result.errors.join('；')).toContain('内容为空')
    expect(result.matched.size).toBe(1)
    expect(result.matched.get('建议一')).toBe('内容一')
  })
})

describe('runGeneratedPolishRetry', { timeout: 15_000 }, () => {
  it('首次尝试全部通过则直接返回，不重试', async () => {
    let calls = 0
    const { tools, attempts } = await runGeneratedPolishRetry(async () => {
      calls++
      return {
        matched: new Map([['课间冲突化解四步', '内容A'], ['课堂规则共建术', '内容B']]),
        errors: [],
      }
    })
    expect(calls).toBe(1)
    expect(attempts).toBe(1)
    expect(tools).toEqual([
      { title: '课间冲突化解四步', content: '内容A' },
      { title: '课堂规则共建术', content: '内容B' },
    ])
  })

  it('首次部分失败后重试全过；重试时携带上次输出与错误', async () => {
    const { tools, attempts } = await runGeneratedPolishRetry(async (_attempt, previous) => {
      if (!previous) {
        return {
          matched: new Map([['课间冲突化解四步', '第一版']]),
          errors: [`title「xxx」过长（31 字，上限 ${MAX_GENERATED_TITLE_LENGTH}）`],
          raw: '{"tools":[{"title":"xxx","content":"第一版"}]}',
        }
      }
      expect(previous.errors.join('；')).toContain('过长')
      expect(previous.raw).toContain('"tools"')
      return {
        matched: new Map([['课间冲突化解四步', '修正版']]),
        errors: [],
        raw: '{"tools":[{"title":"课间冲突化解四步","content":"修正版"}]}',
      }
    })
    expect(attempts).toBe(2)
    expect(tools).toEqual([{ title: '课间冲突化解四步', content: '修正版' }])
  })

  it('耗尽重试：各尝试通过项累计保留、按上限截断，非法项不出现', async () => {
    const attemptOutputs = [
      // 第 1 次：3 条合法 + 1 条重复 → 数量/重复双错误
      generatedOutput([
        { title: '建议一', content: '内容一' },
        { title: '建议二', content: '内容二' },
        { title: '建议三', content: '内容三' },
        { title: '建议一', content: '重复项' },
      ]),
      // 第 2 次：2 条合法 + 1 条超长 title → 继续失败
      generatedOutput([
        { title: '建议四', content: '内容四' },
        { title: '建议五', content: '内容五' },
        { title: '长'.repeat(MAX_GENERATED_TITLE_LENGTH + 1), content: '内容六' },
      ]),
      // 第 3 次：2 条合法 + 1 条空 content → 仍失败，耗尽
      generatedOutput([
        { title: '建议六', content: '内容六' },
        { title: '建议七', content: '内容七' },
        { title: '建议八', content: '   ' },
      ]),
    ]
    const { tools, attempts } = await runGeneratedPolishRetry(async (attempt) => {
      const parsed = parsePolishOutput(attemptOutputs[attempt - 1], [])
      expect(parsed.errors.length).toBeGreaterThan(0)
      return { ...parsed, raw: attemptOutputs[attempt - 1] }
    })
    expect(attempts).toBe(MAX_TOOL_POLISH_ATTEMPTS)
    // 累计 7 条通过项按先到先得截断为前 3 条；重复/超长/空内容等非法项不出现
    expect(tools).toEqual([
      { title: '建议一', content: '内容一' },
      { title: '建议二', content: '内容二' },
      { title: '建议三', content: '内容三' },
    ])
  })

  it('耗尽且无任何通过项：返回空数组', async () => {
    const { tools, attempts } = await runGeneratedPolishRetry(async () => ({
      matched: new Map(),
      errors: ['模型输出不是合法 JSON'],
      raw: 'not-json',
    }))
    expect(attempts).toBe(MAX_TOOL_POLISH_ATTEMPTS)
    expect(tools).toEqual([])
  })
})

describe('actions 加工（parsePolishOutput 传入 expectedActions）', () => {
  const inputActions = [
    { title: '针对「意义感流失」', detail: '每周五下班前用 10 分钟做一次周复盘，记录最有成就感的 1 件事。', code: 'A-001' },
    { title: '针对「职业倦怠」', detail: '找一位信任的同事聊一聊近期的感受，把压力说出来。', code: 'A-002' },
  ]
  const goodActions = [
    { title: '针对「意义感流失」', content: '每周五下班前用 10 分钟写下本周最有成就感的 1 件事与当时的做法，存入备忘录；连续 4 周后提炼成自己的「能量清单」。' },
    { title: '针对「职业倦怠」', content: '本周内约一位信任的同事喝杯茶，把近期的疲惫与困惑说出来，并约定之后每月互相倾听一次。' },
  ]
  const mixedOkRaw = () => okOutput({ actions: goodActions })

  it('actions 合法输出通过校验并逐条关联回输入（matched 正确）', () => {
    const result = parsePolishOutput(mixedOkRaw(), inputTools, inputActions)
    expect(result.errors).toEqual([])
    expect(result.matched.size).toBe(2)
    expect(result.actionsMatched.size).toBe(2)
    expect(result.actionsMatched.get('针对「意义感流失」')).toContain('每周五下班前用 10 分钟写下')
    expect(result.actionsMatched.get('针对「职业倦怠」')).toContain('约一位信任的同事喝杯茶')
  })

  it('actions 数量与输入不符时报错', () => {
    const raw = okOutput({ actions: [goodActions[0]] })
    const result = parsePolishOutput(raw, inputTools, inputActions)
    expect(result.errors.join('；')).toContain('actions 数量 1，应为 2')
    expect(result.actionsMatched.size).toBe(1)
  })

  it('actions 出现输入中没有的 title 时报错', () => {
    const raw = okOutput({ actions: [{ title: '乱写的动作', content: '内容' }, goodActions[1]] })
    const result = parsePolishOutput(raw, inputTools, inputActions)
    expect(result.errors.join('；')).toContain('出现输入中没有的 action「乱写的动作」')
    expect(result.actionsMatched.size).toBe(1)
    expect(result.actionsMatched.has('针对「职业倦怠」')).toBe(true)
  })

  it('actions content 为空时报错', () => {
    const raw = okOutput({ actions: [{ ...goodActions[0], content: '   ' }, goodActions[1]] })
    const result = parsePolishOutput(raw, inputTools, inputActions)
    expect(result.errors.join('；')).toContain('action「针对「意义感流失」」内容为空')
    expect(result.actionsMatched.has('针对「意义感流失」')).toBe(false)
    expect(result.actionsMatched.has('针对「职业倦怠」')).toBe(true)
  })

  it('actions content 超过 MAX_TOOL_POLISH_CONTENT 时报错', () => {
    const raw = okOutput({ actions: [{ title: '针对「意义感流失」', content: 'x'.repeat(MAX_TOOL_POLISH_CONTENT + 1) }, goodActions[1]] })
    const result = parsePolishOutput(raw, inputTools, inputActions)
    expect(result.errors.join('；')).toContain('action「针对「意义感流失」」内容过长')
    expect(result.errors.join('；')).toContain(`上限 ${MAX_TOOL_POLISH_CONTENT}`)
    expect(result.actionsMatched.has('针对「意义感流失」')).toBe(false)
  })

  it('缺少某个 action 时报错', () => {
    const raw = okOutput({ actions: [goodActions[0]] })
    const result = parsePolishOutput(raw, inputTools, inputActions)
    expect(result.errors.join('；')).toContain('缺少 action「针对「职业倦怠」」')
  })

  it('不传 expectedActions：actionsMatched 为空 Map、输出中的 actions 被忽略，tools 行为不变（向后兼容）', () => {
    // 输出里带了非法 actions，但不传第三参 → 完全不校验 actions
    const raw = okOutput({ actions: [{ title: '乱写的动作', content: '' }] })
    const result = parsePolishOutput(raw, inputTools)
    expect(result.errors).toEqual([])
    expect(result.actionsMatched.size).toBe(0)
    expect(result.matched.size).toBe(2)
    expect(result.matched.get('结构化沟通三步法')).toContain('先让两个孩子分开')
  })
})

describe('actions 加工（runPolishWithRetry）', { timeout: 15_000 }, () => {
  const inputActions = [
    { title: '针对「意义感流失」', detail: '每周五下班前用 10 分钟做一次周复盘，记录最有成就感的 1 件事。', code: 'A-001' },
    { title: '针对「职业倦怠」', detail: '找一位信任的同事聊一聊近期的感受，把压力说出来。', code: 'A-002' },
  ]
  const goodActions = [
    { title: '针对「意义感流失」', content: '每周五下班前用 10 分钟写下本周最有成就感的 1 件事与当时的做法，存入备忘录。' },
    { title: '针对「职业倦怠」', content: '本周内约一位信任的同事喝杯茶，把近期的疲惫与困惑说出来。' },
  ]
  const mixedOkRaw = () => okOutput({ actions: goodActions })

  it('tools 与 actions 混合输出同一条 raw 一次调用全部通过（attempts=1 不重试）', async () => {
    let calls = 0
    const raw = mixedOkRaw()
    const { tools, actions, attempts } = await runPolishWithRetry(inputTools, async () => {
      calls++
      const parsed = parsePolishOutput(raw, inputTools, inputActions)
      expect(parsed.errors).toEqual([])
      return { ...parsed, raw }
    })
    expect(calls).toBe(1)
    expect(attempts).toBe(1)
    expect(tools[0].content).toContain('先让两个孩子分开')
    expect(actions).toEqual(goodActions)
  })

  it('首轮 actions 非法触发重试，第二轮 tools 与 actions 全过（attempts=2，携带上次输出与错误）', async () => {
    const firstRaw = okOutput({ actions: [{ ...goodActions[0], content: '   ' }, goodActions[1]] })
    const raws = [firstRaw, mixedOkRaw()]
    let calls = 0
    const { tools, actions, attempts } = await runPolishWithRetry(inputTools, async (attempt, previous) => {
      calls++
      if (attempt === 2) {
        expect(previous).toBeDefined()
        expect(previous?.errors.join('；')).toContain('action「针对「意义感流失」」内容为空')
        expect(previous?.raw).toContain('"actions"')
      }
      const raw = raws[attempt - 1]
      const parsed = parsePolishOutput(raw, inputTools, inputActions)
      return { ...parsed, raw }
    })
    expect(calls).toBe(2)
    expect(attempts).toBe(2)
    expect(actions).toEqual(goodActions)
    expect(tools[0].content).toContain('先让两个孩子分开')
  })

  it('重试耗尽：actions 累计命中项用 AI content、未命中项保留原文 detail（mergeActionResults 回填）', async () => {
    const raws = [
      // 第 1 次：action 一合法、action 二内容为空 → 仍失败
      okOutput({ actions: [goodActions[0], { title: '针对「职业倦怠」', content: '   ' }] }),
      // 第 2 次：action 一合法新版（覆盖第 1 次的版本）、action 二 title 不匹配 → 仍失败
      okOutput({ actions: [{ title: '针对「意义感流失」', content: '第二版 AI 内容' }, { title: '乱写的动作', content: '内容' }] }),
      // 第 3 次：两条内容都为空 → 失败，耗尽
      okOutput({ actions: [{ title: '针对「意义感流失」', content: '' }, { title: '针对「职业倦怠」', content: ' ' }] }),
    ]
    const { actions: polished, attempts } = await runPolishWithRetry(inputTools, async (attempt) => {
      const raw = raws[attempt - 1]
      const parsed = parsePolishOutput(raw, inputTools, inputActions)
      expect(parsed.errors.length).toBeGreaterThan(0)
      return { ...parsed, raw }
    })
    expect(attempts).toBe(MAX_TOOL_POLISH_ATTEMPTS)
    // 只保留第 2 次通过校验的新版，未命中的「针对「职业倦怠」」不在结果里
    expect(polished).toEqual([{ title: '针对「意义感流失」', content: '第二版 AI 内容' }])
    // 逐项回填：命中项 detail 换成 AI content，未命中项保留原文 detail（与 polishToolSteps 装配一致）
    const merged = mergeActionResults(inputActions, new Map(polished.map(item => [item.title, item.content])))
    expect(merged[0]).toEqual({ ...inputActions[0], detail: '第二版 AI 内容' })
    expect(merged[1]).toEqual(inputActions[1])
  })
})

describe('mergeActionResults', () => {
  const inputActions = [
    { title: '针对「意义感流失」', detail: '每周五做一次周复盘。', code: 'A-001' },
    { title: '针对「职业倦怠」', detail: '与信任的同事聊聊感受。' },
  ]

  it('命中项用 AI 版替换 detail、未命中项保留原文，编码字段不丢', () => {
    const matched = new Map([['针对「意义感流失」', '可执行步骤 A']])
    const merged = mergeActionResults(inputActions, matched)
    expect(merged[0]).toEqual({ ...inputActions[0], detail: '可执行步骤 A' })
    expect(merged[1]).toEqual(inputActions[1])
  })

  it('无任何匹配时原样返回（逐项回退原文）', () => {
    const merged = mergeActionResults(inputActions, new Map())
    expect(merged).toEqual(inputActions)
  })
})
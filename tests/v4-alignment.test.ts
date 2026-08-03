/**
 * v4 模板与业务链路对齐的回归测试。
 *
 * 这里锁死的都是「不报错但会算错」的缺陷——它们不会让任何测试变红，
 * 只会让教师看到空白或错误的结论，所以必须显式钉住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import XLSX from 'xlsx'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { findInvalidAnswers, findInvalidDraftAnswers, allowedAnswerValues } from '../server/domain/assessment-answers'
import { checkExpressionSyntax, extractReferencedInstrumentCodes } from '../server/domain/rules-executor'
import { selectEffectiveCrossRefPayloads } from '../server/domain/module-resource-cross-ref-runner'
import { collectReferencedQuestionIds, collectReferencedDimensionCodes } from '../server/domain/module-resource-validation'
import { executeRules } from '../server/domain/rules-executor'

const TEMPLATE = resolve('business-libraries/templates/三库填写模板_v4.xlsx')

function parseAssessment(buffer: Buffer, diagnostics?: string[]) {
  return parseModuleResourceFile({
    module: 'self_growth',
    libraryType: 'assessment',
    filename: 't.xlsx',
    contentBase64: buffer.toString('base64')
  }, diagnostics) as { instruments: Array<Record<string, any>> }
}

describe('v4 模板结构', () => {
  it('③ 与 ③a~③d 并存时仍然选中 ③ 量表-清单', () => {
    // 裸 /③/ 会先命中「③a 量表编排指南」，把整页散文当成量表清单解析
    const parsed = parseAssessment(readFileSync(TEMPLATE))
    expect(parsed.instruments.map(item => item.code)).toEqual(['SG_FIVE_Q'])
  })

  it('新增的两列不进 payload（不进系统，只是规划留痕）', () => {
    const parsed = parseAssessment(readFileSync(TEMPLATE))
    expect(JSON.stringify(parsed)).not.toContain('做完导向什么')
  })

  it('④c 起的量表角色被解析出来', () => {
    const parsed = parseAssessment(readFileSync(TEMPLATE))
    expect(parsed.instruments[0]!.instrumentRole).toBe('screening')
  })

  it('删掉 ③ 只留说明页时不静默解析，而是给出提示', () => {
    const source = XLSX.readFile(TEMPLATE)
    const workbook = XLSX.utils.book_new()
    for (const name of source.SheetNames) {
      if (name !== '③ 量表-清单') XLSX.utils.book_append_sheet(workbook, source.Sheets[name]!, name)
    }
    const diagnostics: string[] = []
    const parsed = parseAssessment(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), diagnostics)
    // 说明页在读取阶段就被剔除，绝不能出现在解析结果里
    const titles = parsed.instruments.map(item => String(item.title))
    expect(titles.some(title => /编排指南|角色说明|路径示意|编排自检/.test(title))).toBe(false)
    // 走了 legacy 兜底就必须留痕，否则业务只会看到题目莫名其妙却查不到原因
    expect(diagnostics.join('')).toContain('量表-清单')
  })
})

describe('工具库的 ⑦b/⑧ 挂载', () => {
  const parseTool = (buffer: Buffer, diagnostics?: string[]) => parseModuleResourceFile({
    module: 'self_growth', libraryType: 'tool', filename: 't.xlsx', contentBase64: buffer.toString('base64')
  }, diagnostics) as { tools: Array<Record<string, any>> }

  it('模板示例的禁忌规则能挂到工具上', () => {
    // 禁忌是工具匹配里唯一的硬过滤，示例本身必须是可用的
    const { tools } = parseTool(readFileSync(TEMPLATE))
    expect(tools[0]!.contraindicationRules).toHaveLength(1)
    expect(tools[0]!.contraindicationRules[0].type).toBe('block')
  })

  it('工具编码写错时不静默丢弃，而是报出来', () => {
    const source = XLSX.readFile(TEMPLATE)
    const workbook = XLSX.utils.book_new()
    for (const name of source.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<any[]>(source.Sheets[name]!, { header: 1 }).map(row => [...row])
      if (/⑧|禁忌规则/.test(name)) for (let i = 1; i < rows.length; i++) if (rows[i]) rows[i]![0] = 'TYPO_CODE'
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
    }
    const diagnostics: string[] = []
    const { tools } = parseTool(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), diagnostics)
    expect(tools[0]!.contraindicationRules).toBeUndefined()
    expect(diagnostics.join('')).toContain('TYPO_CODE')
    expect(diagnostics.join('')).toContain('硬过滤')
  })
})

describe('0/1 二值量表可作答', () => {
  // v4 ③b 角色说明推荐业务做「红线检查」这类是非清单量表
  const binary = [
    { id: 'q1', options: [{ value: 0 }, { value: 1 }] },
    { id: 'q2', options: [{ value: 0 }, { value: 1 }] }
  ]

  it('全选「否」（0 分）是合法作答，不能被判成未作答', () => {
    expect(findInvalidAnswers(binary, { q1: 0, q2: 0 })).toEqual([])
  })

  it('超出选项集合的取值仍被拦下', () => {
    expect(findInvalidAnswers(binary, { q1: 0, q2: 3 })).toEqual(['q2'])
  })

  it('缺题仍被拦下', () => {
    expect(findInvalidAnswers(binary, { q1: 0 })).toEqual(['q2'])
  })

  it('草稿只校验已填的，不要求填满', () => {
    expect(findInvalidDraftAnswers(binary, { q1: 0 })).toEqual([])
    expect(findInvalidDraftAnswers(binary, { qX: 1 })).toEqual(['qX'])
  })

  it('没定义选项组时退回 1..5', () => {
    expect(allowedAnswerValues({ id: 'q' })).toEqual([1, 2, 3, 4, 5])
    expect(findInvalidAnswers([{ id: 'q' }], { q: 0 })).toEqual(['q'])
  })
})

describe('触发条件的导入期校验', () => {
  it('跨量表引用与中英文连接词都能解析', () => {
    expect(checkExpressionSyntax('量表[A].总分 >= 17').ok).toBe(true)
    expect(checkExpressionSyntax("量表[A].维度[D] >= 4 或 量表[A].等级 == 'orange'").ok).toBe(true)
    expect(checkExpressionSyntax('量表[A].总分 >= 17 AND 总分 >= 3').ok).toBe(true)
  })

  it('写错的表达式被判为不合法', () => {
    expect(checkExpressionSyntax('总分 >= ').ok).toBe(false)
    expect(checkExpressionSyntax('量表[A].总分 >>> 5').ok).toBe(false)
  })

  it('能提取出引用的量表编码，供校验它们是否存在', () => {
    expect(extractReferencedInstrumentCodes('量表[A].总分 >= 1 且 量表[B].维度[D] >= 2').sort())
      .toEqual(['A', 'B'])
  })
})

describe('跨库校验的候选优先级', () => {
  it('待导入/待发布的那一份必须顶掉同一格已发布的那份', () => {
    // 不顶掉的话 find 会取到先入列的已发布版本，
    // 预检就变成校验库里的旧数据，写错的引用一路放行。
    const published = { instruments: [{ code: 'OLD' }] }
    const incoming = { instruments: [{ code: 'NEW' }] }
    const candidates = [
      { libraryType: 'assessment' as const, scope: 'global' as const, schoolId: null, payload: published }
    ]
    // 模拟 upsert：同一格替换而不是追加
    const i = candidates.findIndex(c => c.libraryType === 'assessment' && c.scope === 'global' && c.schoolId === null)
    candidates.splice(i, 1, { libraryType: 'assessment', scope: 'global', schoolId: null, payload: incoming })

    const { payloads } = selectEffectiveCrossRefPayloads(candidates)
    expect(payloads.get('assessment')).toBe(incoming)
  })

  it('本校有校本版本时优先用校本，否则回退平台版本', () => {
    const global = { tools: ['g'] }
    const school = { tools: ['s'] }
    const candidates = [
      { libraryType: 'tool' as const, scope: 'global' as const, schoolId: null, payload: global },
      { libraryType: 'tool' as const, scope: 'school' as const, schoolId: 'S1', payload: school }
    ]
    expect(selectEffectiveCrossRefPayloads(candidates, 'S1').payloads.get('tool')).toBe(school)
    expect(selectEffectiveCrossRefPayloads(candidates, 'S2').payloads.get('tool')).toBe(global)
    expect(selectEffectiveCrossRefPayloads(candidates).payloads.get('tool')).toBe(global)
  })
})

describe('归因表达式的题号/维度引用校验', () => {
  // ⑤a 教业务写的是「题[q1]」「维度[CODE]」，转成 SCORE()/DIM() 是运行期的事。
  // 只认英文形式的话这条守卫对真实数据完全失效。
  const cfg = (condition: string) => ({
    module: 'self_growth' as const, version: '1.0.0', computed: {},
    attributionItems: [], evidences: [{ attributionCode: 'A', assessmentCode: 'S1', evidenceCode: 'E1', condition, weight: 1 }],
    gradingRules: [], redLines: [], actions: [], tools: []
  }) as any

  it('认得中文写法的题号', () => {
    expect(collectReferencedQuestionIds(cfg('题[q1] >= 4 且 原始[q2] <= 2')).sort()).toEqual(['q1', 'q2'])
  })
  it('认得中文写法的维度', () => {
    expect(collectReferencedDimensionCodes(cfg('维度[SG_EMOTION] >= 4'))).toEqual(['SG_EMOTION'])
  })
  it('仍然认英文写法', () => {
    expect(collectReferencedQuestionIds(cfg("SCORE(q1) >= 4 || RAW('q2') <= 2")).sort()).toEqual(['q1', 'q2'])
    expect(collectReferencedDimensionCodes(cfg('DIM(EMO) >= 3'))).toEqual(['EMO'])
  })
  it('跨量表引用不算本量表的题号/维度', () => {
    // 量表[X].题[Y] 里的 Y 属于另一张量表，拿本量表题库去判会误报
    const c = cfg('量表[OTHER].题[zz] >= 4 且 题[q1] >= 3')
    expect(collectReferencedQuestionIds(c)).toEqual(['q1'])
    expect(collectReferencedDimensionCodes(cfg('量表[OTHER].维度[DD] >= 4'))).toEqual([])
  })
})

describe('⑪ 全链路推演算例', () => {
  const walkthrough = () => {
    const wb = XLSX.readFile(TEMPLATE)
    return XLSX.utils.sheet_to_json<any[]>(wb.Sheets['⑪ 全链路推演算例']!, { header: 1 })
  }

  it('是纯讲解页，任何库都不会把它当成数据', () => {
    for (const libraryType of ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template'] as const) {
      const payload = parseModuleResourceFile({
        module: 'self_growth', libraryType, filename: 't.xlsx', contentBase64: readFileSync(TEMPLATE).toString('base64')
      })
      expect(JSON.stringify(payload)).not.toContain('推演算例')
      expect(JSON.stringify(payload)).not.toContain('折算公式')
    }
  })

  it('推演里的数字与引擎现算的一致（引擎改了忘记重出模板就会红）', () => {
    const b64 = readFileSync(TEMPLATE).toString('base64')
    const load = (libraryType: any) => parseModuleResourceFile({
      module: 'self_growth', libraryType, filename: 't.xlsx', contentBase64: b64
    }) as any
    const inst = load('assessment').instruments[0]
    const cfg = load('attribution')
    // 与 build-template-v4.mjs 的主算例同一组作答
    const result = executeRules(cfg, { q1: 4, q2: 4, q3: 4, q4: 4, q5: 3 }, inst, { previousConsecutiveLowMeaning: 0 })

    const rows = walkthrough()
    const text = rows.map(row => (row || []).join(' ')).join('\n')
    // 主算例必须是「不熔断」的，否则第 8~10 步会自相矛盾
    expect(result.blocked).toBe(false)
    expect(text).toContain('未熔断，继续生成方案')
    // 等级与占比要对得上
    expect(text).toContain(result.levelName || result.level)
    for (const attribution of result.attributions) {
      expect(text).toContain(attribution.name)
      expect(text).toContain(`${(attribution.share * 100).toFixed(1)}%`)
    }
  })
})

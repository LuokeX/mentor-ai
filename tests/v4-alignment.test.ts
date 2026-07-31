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

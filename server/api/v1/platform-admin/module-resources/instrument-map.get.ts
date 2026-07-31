/**
 * 量表编排诊断（运营台）。
 *
 * assessment-instruments.ts 里的 triggerError 注释写着「供运营台排查」，但它只经
 * 教师态接口返回，而那个接口是 requireUser(['teacher'])——管理员根本调不到，
 * 教师端也不展示。结果就是：业务把触发条件写错时，那张量表在教师端永远显示
 *「当前不需要做」，不报错、查不出原因，声明的排查入口从来不存在。
 *
 * 这里给管理员一个真正的入口：把该模块的编排关系整张摊开，并静态判出
 * 会让量表永远激活不了的几类问题——表达式写错、引用了不存在的量表、前置链成环。
 */
import { moduleIdSchema, type InstrumentRole } from '../../../../../shared/contracts'
import { listAssessmentInstruments } from '../../../../domain/module-resources'
import { checkExpressionSyntax, extractReferencedInstrumentCodes } from '../../../../domain/rules-executor'
import { requireUser } from '../../../../utils/auth'

type ProblemKind = 'syntax' | 'unknown_reference' | 'prerequisite_cycle' | 'missing_prerequisite'

interface InstrumentNode {
  code: string
  title: string
  role: InstrumentRole | null
  isRequired: boolean
  usageTiming: string | null
  questionCount: number
  prerequisiteCodes: string[]
  exclusiveCodes: string[]
  triggerCondition: string | null
  triggerConditionNote: string | null
  /** 让这张量表永远激活不了的问题。非空即需要业务修改。 */
  problems: Array<{ kind: ProblemKind, message: string }>
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const module = moduleIdSchema.parse(getQuery(event).module)

  const instruments = await listAssessmentInstruments(event, module, null)
  const codes = new Set(instruments.map(instrument => instrument.code))

  const nodes: InstrumentNode[] = instruments.map((instrument) => {
    const problems: InstrumentNode['problems'] = []
    const prerequisiteCodes = instrument.prerequisiteCodes || []
    const condition = instrument.triggerCondition?.trim() || null

    if (condition) {
      const syntax = checkExpressionSyntax(condition)
      if (!syntax.ok) {
        problems.push({ kind: 'syntax', message: `触发条件无法解析：${syntax.error}。该量表会一直停留在「当前不需要做」。` })
      } else {
        for (const ref of extractReferencedInstrumentCodes(condition)) {
          if (!codes.has(ref)) {
            problems.push({ kind: 'unknown_reference', message: `触发条件引用了不存在的量表编码「${ref}」，条件永远不会满足。` })
          }
        }
      }
    }

    for (const code of prerequisiteCodes) {
      if (!codes.has(code)) {
        problems.push({ kind: 'missing_prerequisite', message: `前置量表「${code}」不在本模块已发布的量表里，这张量表会永久置灰。` })
      }
    }

    return {
      code: instrument.code,
      title: instrument.title,
      role: instrument.instrumentRole ?? null,
      isRequired: Boolean(instrument.isRequired),
      usageTiming: instrument.usageTiming ?? null,
      questionCount: instrument.questions?.length ?? 0,
      prerequisiteCodes,
      exclusiveCodes: instrument.exclusiveCodes || [],
      triggerCondition: condition,
      triggerConditionNote: instrument.triggerConditionNote ?? null,
      problems
    }
  })

  // 前置链成环：环上每张量表都在等对方先做完，谁也解锁不了
  const prereqOf = new Map(nodes.map(node => [node.code, node.prerequisiteCodes]))
  for (const node of nodes) {
    const seen = new Set<string>()
    const stack = [...node.prerequisiteCodes]
    while (stack.length) {
      const code = stack.pop()!
      if (code === node.code) {
        node.problems.push({ kind: 'prerequisite_cycle', message: '前置量表构成闭环，这张量表永远无法解锁。' })
        break
      }
      if (seen.has(code)) continue
      seen.add(code)
      stack.push(...(prereqOf.get(code) || []))
    }
  }

  const entry = nodes.filter(node => node.role === 'screening' || (node.isRequired && !node.prerequisiteCodes.length))
  const summary: string[] = []
  if (!nodes.length) {
    summary.push('本模块还没有已发布的量表。')
  } else {
    if (!entry.length) {
      summary.push('没有任何入口量表（角色＝入口筛查，或必做且无前置）。教师进模块后不知道该从哪张开始。')
    } else if (entry.length > 1) {
      summary.push(`有 ${entry.length} 张入口量表（${entry.map(item => item.code).join('、')}）。建议每模块只保留一张，见 v4 模板 ③b 角色说明。`)
    }
    const noRole = nodes.filter(node => !node.role)
    if (noRole.length) {
      summary.push(`${noRole.length} 张量表没有填「量表角色」，教师端无法按角色分区展示。`)
    }
    const noTrigger = nodes.filter(node => node.role && node.role !== 'screening' && !node.triggerCondition)
    if (noTrigger.length) {
      summary.push(`${noTrigger.length} 张非入口量表没有填触发条件（${noTrigger.map(item => item.code).join('、')}），它们对每位教师都恒为「随时可做」，深度量表因此失去意义。`)
    }
  }

  return {
    module,
    instruments: nodes,
    entryInstrumentCodes: entry.map(item => item.code),
    problemCount: nodes.reduce((total, node) => total + node.problems.length, 0),
    summary
  }
})

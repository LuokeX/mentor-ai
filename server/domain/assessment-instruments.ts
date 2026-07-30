/**
 * 量表可选性判定。
 *
 * 一个模块下可以有多张量表（筛查 → 深度 → 专项）。哪张能做由 ③ 量表-清单
 * 里业务填的两列推导：
 *   前置量表编码 —— 未完成时锁定。留空视为放行；绝大多数量表都留空，
 *                    门禁不能默认拦人，否则加上这个特性反而把量表全锁死。
 *   互斥量表编码 —— 已完成互斥量表时锁定。
 *
 * 这里只做「能不能做」的判定，「该做哪张」由 recommendInstrument 负责。
 */
import type { H3Event } from 'h3'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { ModuleId } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { schema, useDb } from '../utils/db'
import { listAssessmentInstruments } from './module-resources'

export type InstrumentStatus = 'available' | 'locked' | 'completed'

export interface InstrumentRef {
  code: string
  title: string
}

export interface InstrumentOption {
  code: string
  title: string
  shortName: string | null
  description: string
  questionCount: number
  estimatedMinutes: number
  isRequired: boolean
  usageTiming: string | null
  prerequisiteCodes: string[]
  exclusiveCodes: string[]
  status: InstrumentStatus
  /** 未完成的前置量表。非空即被锁定。 */
  missingPrerequisites: InstrumentRef[]
  /** 已完成的互斥量表。非空即被锁定。 */
  blockingExclusives: InstrumentRef[]
  lastSubmittedAt: string | null
  lastLevel: string | null
  lastLevelName: string | null
  order: number
}

/** 教师在某模块下每张量表最近一次已提交的结果 */
async function loadLatestAttempts(
  event: H3Event,
  module: ModuleId,
  ownerUserId: string,
  codes: string[]
) {
  const latest = new Map<string, { submittedAt: Date | null, level: string | null, levelName: string | null }>()
  if (!codes.length) return latest

  const rows = await useDb(event)
    .select({
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      submittedAt: schema.assessmentAttempts.submittedAt,
      result: schema.assessmentAttempts.result
    })
    .from(schema.assessmentAttempts)
    .where(and(
      eq(schema.assessmentAttempts.ownerUserId, ownerUserId),
      eq(schema.assessmentAttempts.module, module),
      eq(schema.assessmentAttempts.status, 'submitted'),
      inArray(schema.assessmentAttempts.assessmentCode, codes)
    ))
    .orderBy(desc(schema.assessmentAttempts.submittedAt))

  for (const row of rows) {
    if (latest.has(row.assessmentCode)) continue // 已按时间倒序，首条即最近一次
    const result = (row.result || {}) as { level?: string, levelName?: string }
    latest.set(row.assessmentCode, {
      submittedAt: row.submittedAt,
      level: result.level ?? null,
      levelName: result.levelName ?? null
    })
  }
  return latest
}

/** 把量表定义 + 作答历史算成带状态的可选项，按「必做优先 → 未锁定优先 → 原顺序」排序 */
export function buildInstrumentOptions(
  instruments: AssessmentDefinition[],
  latest: Map<string, { submittedAt: Date | null, level: string | null, levelName: string | null }>
): InstrumentOption[] {
  const titleByCode = new Map(instruments.map(item => [item.code, item.title]))

  const rows = instruments.map((instrument, index) => {
    const prerequisiteCodes = instrument.prerequisiteCodes || []
    const exclusiveCodes = instrument.exclusiveCodes || []
    const done = latest.get(instrument.code) || null

    // 引用了不存在的量表编码时按「已满足」处理——一个编码笔误不该让量表永久不可用，
    // 这类问题由导入时的交叉校验负责报错。
    const missingPrerequisites = prerequisiteCodes
      .filter(code => titleByCode.has(code) && !latest.has(code))
      .map(code => ({ code, title: titleByCode.get(code) || code }))

    const blockingExclusives = exclusiveCodes
      .filter(code => latest.has(code))
      .map(code => ({ code, title: titleByCode.get(code) || code }))

    const locked = missingPrerequisites.length > 0 || blockingExclusives.length > 0

    return {
      code: instrument.code,
      title: instrument.title,
      shortName: instrument.shortName ?? null,
      description: instrument.description,
      questionCount: instrument.questions.length,
      estimatedMinutes: instrument.estimatedMinutes,
      isRequired: instrument.isRequired ?? false,
      usageTiming: instrument.usageTiming ?? null,
      prerequisiteCodes,
      exclusiveCodes,
      status: (locked ? 'locked' : done ? 'completed' : 'available') as InstrumentStatus,
      missingPrerequisites,
      blockingExclusives,
      lastSubmittedAt: done?.submittedAt ? done.submittedAt.toISOString() : null,
      lastLevel: done?.level ?? null,
      lastLevelName: done?.levelName ?? null,
      order: index
    }
  })

  return rows.sort((a, b) =>
    Number(b.isRequired) - Number(a.isRequired)
    || Number(a.status === 'locked') - Number(b.status === 'locked')
    || a.order - b.order
  )
}

/** 列出某模块下所有已发布量表及其可选状态 */
export async function listInstrumentOptions(
  event: H3Event,
  module: ModuleId,
  user: { id: string, schoolId?: string | null }
): Promise<InstrumentOption[]> {
  const instruments = await listAssessmentInstruments(event, module, user.schoolId)
  const latest = await loadLatestAttempts(event, module, user.id, instruments.map(item => item.code))
  return buildInstrumentOptions(instruments, latest)
}

/**
 * 把被前置量表锁住的推荐改指到前置那张。
 *
 * 例：AI 推荐做「六维度深度诊断」，但它要求先完成「双维速查」——
 * 直接告诉教师「先做速查」比让他撞在锁上再自己找路更有用。
 * 前置本身也可能被更前面的前置锁住，所以要顺着链条往上找，并防环。
 */
export function resolveReachableInstrument(
  options: InstrumentOption[],
  targetCode: string
): { instrument: InstrumentOption, redirectedFrom: InstrumentOption | null } | null {
  const byCode = new Map(options.map(option => [option.code, option]))
  const target = byCode.get(targetCode)
  if (!target) return null
  if (target.status !== 'locked') return { instrument: target, redirectedFrom: null }

  const seen = new Set<string>([target.code])
  let current = target
  // 顺着「未完成的前置」往上找第一张能做的
  while (current.missingPrerequisites.length) {
    const next = byCode.get(current.missingPrerequisites[0]!.code)
    if (!next || seen.has(next.code)) break // 前置引用成环或指向不存在的量表
    seen.add(next.code)
    if (next.status !== 'locked') return { instrument: next, redirectedFrom: target }
    current = next
  }
  return null
}

/** 兜底推荐：优先必做且可做的，否则第一张可做的 */
export function fallbackInstrument(options: InstrumentOption[]): InstrumentOption | null {
  return options.find(option => option.isRequired && option.status !== 'locked')
    || options.find(option => option.status !== 'locked')
    || null
}

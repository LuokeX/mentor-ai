/**
 * 量表可选性判定。
 *
 * 一个模块下可以有多张量表（筛查 → 深度 → 专项）。哪张能做由 ③ 量表-清单
 * 里业务填的两列推导：
 *   前置量表编码 —— 未完成时锁定。留空视为放行；绝大多数量表都留空，
 *                    门禁不能默认拦人，否则加上这个特性反而把量表全锁死。
 *   互斥量表编码 —— 已完成互斥量表时锁定。
 *   触发条件     —— 引用前面量表的结果，未达阈值时标为「当前不需要做」。
 *                    注意它不是门禁：不满足只是不推荐，教师仍可手动选择。
 *                    真正禁止的只有前置和互斥。
 *
 * 这里只做「能不能做 / 该不该做」的判定，「具体推哪张」由 recommendInstrument 负责。
 */
import type { H3Event } from 'h3'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { InstrumentRole, ModuleId } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { schema, useDb } from '../utils/db'
import { listAssessmentInstruments } from './module-resources'
import { evaluateTriggerCondition, type PriorAssessmentResult } from './rules-executor'

/**
 * available   可做（无门禁，或触发条件已满足）
 * suggested   触发条件已满足，业务明确认为「现在该做」
 * not_needed  触发条件未满足，当前不需要做（不禁止，教师仍可手动选）
 * locked      前置量表未完成，或已完成互斥量表 —— 真正禁止
 * completed   已做过
 */
export type InstrumentStatus = 'available' | 'suggested' | 'not_needed' | 'locked' | 'completed'

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
  /** ③「量表角色」列。教师端按角色分区；红线检查量表在教师端默认隐藏 */
  role: InstrumentRole | null
  isRequired: boolean
  usageTiming: string | null
  prerequisiteCodes: string[]
  exclusiveCodes: string[]
  status: InstrumentStatus
  /** ③ 的触发条件原文，留空表示随时可做 */
  triggerCondition: string | null
  /** 触发条件说明，教师端展示 */
  triggerConditionNote: string | null
  /** 触发条件求值出错时的原因，供运营台排查；教师端不展示 */
  triggerError: string | null
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
interface LatestAttempt {
  submittedAt: Date | null
  level: string | null
  levelName: string | null
  severity: string | null
  dimensions: Record<string, number>
  answers: Record<string, number>
}

async function loadLatestAttempts(
  event: H3Event,
  module: ModuleId,
  ownerUserId: string,
  codes: string[]
) {
  const latest = new Map<string, LatestAttempt>()
  if (!codes.length) return latest

  const rows = await useDb(event)
    .select({
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      submittedAt: schema.assessmentAttempts.submittedAt,
      answers: schema.assessmentAttempts.answers,
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
    const result = (row.result || {}) as {
      level?: string, levelName?: string, severity?: string, dimensions?: Record<string, number>
    }
    latest.set(row.assessmentCode, {
      submittedAt: row.submittedAt,
      level: result.level ?? null,
      levelName: result.levelName ?? null,
      severity: result.severity ?? null,
      dimensions: result.dimensions || {},
      answers: (row.answers || {}) as Record<string, number>
    })
  }
  return latest
}

/**
 * 把历史作答折算成触发条件可用的形式。
 * result 里存了 level/severity/dimensions，但没有总分，所以用量表定义 + answers 现算，
 * 反向计分规则与引擎保持一致（min + max − 作答值）。
 */
function toPriorResults(
  instruments: AssessmentDefinition[],
  latest: Map<string, LatestAttempt>
): Record<string, PriorAssessmentResult> {
  const priors: Record<string, PriorAssessmentResult> = {}
  for (const instrument of instruments) {
    const done = latest.get(instrument.code)
    if (!done) continue
    const scores: Record<string, number> = {}
    for (const question of instrument.questions) {
      const raw = Number(done.answers[question.id] ?? NaN)
      if (!Number.isFinite(raw)) continue
      const values = (question.options || []).map(option => option.value)
      scores[question.id] = question.reverse && values.length
        ? Math.min(...values) + Math.max(...values) - raw
        : raw
    }
    const list = Object.values(scores)
    const sum = list.reduce((total, value) => total + value, 0)
    priors[instrument.code] = {
      level: done.level,
      severity: done.severity,
      dimensions: done.dimensions,
      scores,
      sum,
      avg: list.length ? Number((sum / list.length).toFixed(4)) : 0
    }
  }
  return priors
}

/** 把量表定义 + 作答历史算成带状态的可选项，按「必做优先 → 未锁定优先 → 原顺序」排序 */
export function buildInstrumentOptions(
  instruments: AssessmentDefinition[],
  latest: Map<string, LatestAttempt>
): InstrumentOption[] {
  const titleByCode = new Map(instruments.map(item => [item.code, item.title]))
  const priors = toPriorResults(instruments, latest)

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

    // 触发条件：只在未被锁定且尚未做过时才判定——已锁定时门禁优先，
    // 已做过时状态就是 completed，再算「需不需要做」没有意义。
    const triggerCondition = instrument.triggerCondition?.trim() || null
    let triggerMet = true
    let triggerError: string | null = null
    if (triggerCondition && !locked && !done) {
      const evaluated = evaluateTriggerCondition(triggerCondition, priors)
      triggerMet = evaluated.met
      triggerError = evaluated.error ?? null
    }

    const status: InstrumentStatus = locked
      ? 'locked'
      : done
        ? 'completed'
        : !triggerCondition
          ? 'available'
          : triggerMet ? 'suggested' : 'not_needed'

    return {
      code: instrument.code,
      title: instrument.title,
      shortName: instrument.shortName ?? null,
      description: instrument.description,
      questionCount: instrument.questions.length,
      estimatedMinutes: instrument.estimatedMinutes,
      role: instrument.instrumentRole ?? null,
      isRequired: instrument.isRequired ?? false,
      usageTiming: instrument.usageTiming ?? null,
      prerequisiteCodes,
      exclusiveCodes,
      status,
      triggerCondition,
      triggerConditionNote: instrument.triggerConditionNote ?? null,
      triggerError,
      missingPrerequisites,
      blockingExclusives,
      lastSubmittedAt: done?.submittedAt ? done.submittedAt.toISOString() : null,
      lastLevel: done?.level ?? null,
      lastLevelName: done?.levelName ?? null,
      order: index
    }
  })

  // 建议做的排最前，其次必做，再次未锁定，最后按原顺序
  return rows.sort((a, b) =>
    Number(b.status === 'suggested') - Number(a.status === 'suggested')
    || Number(b.isRequired) - Number(a.isRequired)
    || Number(a.status === 'locked') - Number(b.status === 'locked')
    || Number(a.status === 'not_needed') - Number(b.status === 'not_needed')
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

/** 兜底推荐：优先「触发条件已满足」的，其次必做且可做的，再次第一张可做的 */
export function fallbackInstrument(options: InstrumentOption[]): InstrumentOption | null {
  return options.find(option => option.status === 'suggested')
    || options.find(option => option.isRequired && option.status !== 'locked')
    || options.find(option => option.status !== 'locked')
    || null
}

/**
 * 教师端可见性。红线检查量表「不该由教师主动选」（③b 角色说明）：
 * 只有高危阈值命中（suggested）时才出现，其余时候对教师和 LLM 都不可见，
 * 避免安全清单被当成常规问卷做掉。
 */
export function filterTeacherVisibleInstruments(options: InstrumentOption[]): InstrumentOption[] {
  return options.filter(option => option.role !== 'red_line' || option.status === 'suggested')
}

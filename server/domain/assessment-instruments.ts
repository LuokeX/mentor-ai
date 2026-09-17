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
import { MODULE_ASSESSMENT_CONTEXT_TYPES } from '../../shared/assessments'
import { viewerSchoolSections } from '../utils/stage-filter'
import { schema, useDb } from '../utils/db'
import { listAssessmentInstruments } from './module-resources'
import { evaluateTriggerCondition, extractReferencedInstrumentCodes, type PriorAssessmentResult } from './rules-executor'

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

/** 咨询对象引用（学生/班级/家长）。对象级量表的触发只看同一对象的提交。 */
export interface AssessmentContextRef {
  type: 'student' | 'class' | 'guardian'
  id: string
}

/** 把评估组里的 `contextType/contextId`（可能是 'none' 或空）收窄成咨询对象引用；未关联对象时返回 null。 */
export function toAssessmentContextRef(type?: string | null, id?: string | null): AssessmentContextRef | null {
  if (!id) return null
  if (type !== 'student' && type !== 'class' && type !== 'guardian') return null
  return { type, id }
}

/**
 * 触发条件的实测依据：条件里引用了哪张量表、那张量表最近一次提交的实测值。
 * 用它替代「触发条件原文」向模型和教师说明「为什么现在该做这张」——
 * 规则原文是条件式描述，被模型转述后容易变成「平台查过你的评估、发现你有风险」这类误读。
 */
export interface InstrumentTriggerEvidence {
  code: string
  title: string
  /** 均分（与触发求值同一口径：按题目反向计分后求平均），无作答为 null */
  average: number | null
  /** 该次提交的结论等级名，无则 null */
  levelName: string | null
  /** 该次提交时间（ISO），无则 null */
  submittedAt: string | null
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
  /** ③「量表使用频率」列：per_case 为对象级（结果属于某个学生/家长/班级） */
  frequency: string | null
  usageTiming: string | null
  prerequisiteCodes: string[]
  exclusiveCodes: string[]
  status: InstrumentStatus
  /** ③ 的触发条件原文，留空表示随时可做 */
  triggerCondition: string | null
  /** 触发条件说明，教师端展示 */
  triggerConditionNote: string | null
  /**
   * 触发条件存在且当前命中（含已完成的量表：命中时允许重做提示）。
   * 无触发条件、未命中，或量表被门禁锁住（未求值）时为 false；suggested 时恒为 true。
   */
  triggerHit: boolean
  /** 触发条件求值出错时的原因，供运营台排查；教师端不展示 */
  triggerError: string | null
  /** 未完成的前置量表。非空即被锁定。 */
  missingPrerequisites: InstrumentRef[]
  /** 已完成的互斥量表。非空即被锁定。 */
  blockingExclusives: InstrumentRef[]
  lastSubmittedAt: string | null
  lastLevel: string | null
  lastLevelName: string | null
  /** 最近一次提交的均分（与触发求值同一口径），未提交为 null */
  lastAverage: number | null
  /** 触发条件命中时引用的量表实测依据；未命中或无法求值为空数组 */
  triggerEvidence: InstrumentTriggerEvidence[]
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

/**
 * 对象级量表：结果描述的是某个学生/家长/班级，而不是教师本人。判定三条：
 *  - `frequency = per_case`（业务在 ③ 里标注的一案一评）；
 *  - 量表角色是红线检查（安全清单本身就对个案）；
 *  - 所在模块的评估对象是班级/学生/家长（`MODULE_ASSESSMENT_CONTEXT_TYPES`，与模块页的对象选择器同源），
 *    例如班级系统的「五系统自评表」虽然频率写的是 weekly，但结果属于某一个班。
 * 这类量表的完成状态与触发条件都只认同一咨询对象的提交。
 */
export function isObjectScopedInstrument(instrument: AssessmentDefinition): boolean {
  if (instrument.frequency === 'per_case' || instrument.instrumentRole === 'red_line') return true
  return (MODULE_ASSESSMENT_CONTEXT_TYPES[instrument.module] || []).length > 0
}

/**
 * 某次提交能不能作为触发条件的依据。
 * 对象级量表必须与当前咨询对象一致（当前对话没有绑定对象时一律不算）；
 * 教师级量表（self_growth 等）按原来的口径，任何一次提交都算。
 */
export function isAttemptEligibleForTrigger(input: {
  code: string
  /** 对象级量表编码集合 */
  scopedCodes: Set<string>
  /** 该次提交绑定的咨询对象（`type:id`），没有绑定为 null */
  attemptBinding: string | null
  /** 当前对话绑定的咨询对象（`type:id`），未绑定为 null */
  contextKey: string | null
}): boolean {
  if (!input.scopedCodes.has(input.code)) return true
  return Boolean(input.contextKey) && input.attemptBinding === input.contextKey
}

function toLatestAttempt(row: {
  submittedAt: Date | null
  answers: Record<string, number | string | boolean> | null
  result: Record<string, unknown> | null
}): LatestAttempt {
  const result = (row.result || {}) as {
    level?: string, levelName?: string, severity?: string, dimensions?: Record<string, number>
  }
  return {
    submittedAt: row.submittedAt,
    level: result.level ?? null,
    levelName: result.levelName ?? null,
    severity: result.severity ?? null,
    dimensions: result.dimensions || {},
    answers: (row.answers || {}) as Record<string, number>
  }
}

function bindingKey(type?: string | null, id?: string | null): string | null {
  if (!type || type === 'none' || !id) return null
  return `${type}:${id}`
}

/**
 * 读取教师在某模块下各量表的最近一次提交，返回两份视图：
 *  - latest：教师级最近一次（用于教师级量表的状态、前置与展示，语义与改造前一致）；
 *  - scoped：对象级量表的判定视图——`per_case`、红线检查，以及所在模块的评估对象是
 *    班级/学生/家长的量表（例如班级系统的五系统自评表），只认当前咨询对象的提交。
 *    当前对话没绑定对象、或该对象没有提交时，这些量表在 scoped 里缺席：完成状态视为未做、
 *    前置不满足、触发条件按「无法判断」处理（求值报错 → not_needed）。
 *
 * 提交与咨询对象的对应关系存在「评估组」上（assessment_sessions.context_type/context_id），
 * 量表提交通过 assessment_session_attempts 关联到评估组。
 */
async function loadPriorAttempts(
  event: H3Event,
  module: ModuleId,
  ownerUserId: string,
  instruments: AssessmentDefinition[],
  context: AssessmentContextRef | null
): Promise<{ latest: Map<string, LatestAttempt>, scoped: Map<string, LatestAttempt> }> {
  const latest = new Map<string, LatestAttempt>()
  const scoped = new Map<string, LatestAttempt>()
  const codes = instruments.map(item => item.code)
  if (!codes.length) return { latest, scoped }

  const scopedCodes = new Set(instruments.filter(isObjectScopedInstrument).map(item => item.code))
  const contextKey = context ? `${context.type}:${context.id}` : null

  const rows = await useDb(event)
    .select({
      assessmentCode: schema.assessmentAttempts.assessmentCode,
      submittedAt: schema.assessmentAttempts.submittedAt,
      answers: schema.assessmentAttempts.answers,
      result: schema.assessmentAttempts.result,
      sessionContextType: schema.assessmentSessions.contextType,
      sessionContextId: schema.assessmentSessions.contextId
    })
    .from(schema.assessmentAttempts)
    .leftJoin(
      schema.assessmentSessionAttempts,
      eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id)
    )
    .leftJoin(schema.assessmentSessions, eq(schema.assessmentSessions.id, schema.assessmentSessionAttempts.assessmentSessionId))
    .where(and(
      eq(schema.assessmentAttempts.ownerUserId, ownerUserId),
      eq(schema.assessmentAttempts.module, module),
      eq(schema.assessmentAttempts.status, 'submitted'),
      inArray(schema.assessmentAttempts.assessmentCode, codes)
    ))
    .orderBy(desc(schema.assessmentAttempts.submittedAt))

  for (const row of rows) {
    // 已按时间倒序：每个集合里首条即最近一次
    if (!latest.has(row.assessmentCode)) latest.set(row.assessmentCode, toLatestAttempt(row))
    const eligible = isAttemptEligibleForTrigger({
      code: row.assessmentCode,
      scopedCodes,
      attemptBinding: bindingKey(row.sessionContextType, row.sessionContextId),
      contextKey
    })
    if (eligible && !scoped.has(row.assessmentCode)) scoped.set(row.assessmentCode, toLatestAttempt(row))
  }
  return { latest, scoped }
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
  latest: Map<string, LatestAttempt>,
  /**
   * 对象级量表的提交视图（只含当前咨询对象的提交）。
   * 传了它，对象级量表的**完成状态、前置/互斥门禁、上次结果展示与触发求值**都按当前对象算；
   * 没传则全部按教师级（与改造前一致，单元测试与无对象场景用这条路）。
   */
  objectScoped?: Map<string, LatestAttempt>
): InstrumentOption[] {
  const titleByCode = new Map(instruments.map(item => [item.code, item.title]))
  const priors = toPriorResults(instruments, latest)
  const triggerPriors = objectScoped ? toPriorResults(instruments, objectScoped) : priors

  const rows = instruments.map((instrument, index) => {
    const prerequisiteCodes = instrument.prerequisiteCodes || []
    const exclusiveCodes = instrument.exclusiveCodes || []
    // 对象级量表以「同一咨询对象」的提交为准；教师级量表始终看教师级最近一次
    const priorSource = objectScoped && isObjectScopedInstrument(instrument) ? objectScoped : latest
    const sourcePriors = priorSource === latest ? priors : triggerPriors
    const done = priorSource.get(instrument.code) || null

    // 引用了不存在的量表编码时按「已满足」处理——一个编码笔误不该让量表永久不可用，
    // 这类问题由导入时的交叉校验负责报错。
    const missingPrerequisites = prerequisiteCodes
      .filter(code => titleByCode.has(code) && !priorSource.has(code))
      .map(code => ({ code, title: titleByCode.get(code) || code }))

    const blockingExclusives = exclusiveCodes
      .filter(code => priorSource.has(code))
      .map(code => ({ code, title: titleByCode.get(code) || code }))

    const locked = missingPrerequisites.length > 0 || blockingExclusives.length > 0

    // 触发条件：未锁定时都求值（包括已完成——命中时允许重做提示，由 triggerHit 区分）。
    // 已做过时状态固定为 completed，不能被降级回 not_needed/suggested；锁定时门禁优先，不求值。
    const triggerCondition = instrument.triggerCondition?.trim() || null
    let triggerMet = true
    let triggerError: string | null = null
    if (triggerCondition && !locked) {
      const evaluated = evaluateTriggerCondition(triggerCondition, triggerPriors)
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
      frequency: instrument.frequency ?? null,
      usageTiming: instrument.usageTiming ?? null,
      prerequisiteCodes,
      exclusiveCodes,
      status,
      triggerCondition,
      triggerConditionNote: instrument.triggerConditionNote ?? null,
      triggerHit: Boolean(triggerCondition) && !locked && triggerMet,
      triggerError,
      missingPrerequisites,
      blockingExclusives,
      lastSubmittedAt: done?.submittedAt ? done.submittedAt.toISOString() : null,
      lastLevel: done?.level ?? null,
      lastLevelName: done?.levelName ?? null,
      lastAverage: sourcePriors[instrument.code]?.avg ?? null,
      triggerEvidence: triggerCondition && triggerMet
        ? buildTriggerEvidence(triggerCondition, triggerPriors, priorSource, titleByCode)
        : [],
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

/** 触发条件实际引用了哪些量表、那几次提交的实测值是多少（与触发求值同一份数据）。 */
function buildTriggerEvidence(
  triggerCondition: string,
  triggerPriors: Record<string, PriorAssessmentResult>,
  source: Map<string, LatestAttempt>,
  titleByCode: Map<string, string>
): InstrumentTriggerEvidence[] {
  return extractReferencedInstrumentCodes(triggerCondition)
    .map((code): InstrumentTriggerEvidence | null => {
      const attempt = source.get(code)
      const prior = triggerPriors[code]
      if (!attempt || !prior) return null
      return {
        code,
        title: titleByCode.get(code) || code,
        average: prior.avg ?? null,
        levelName: attempt.levelName ?? null,
        submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null
      }
    })
    .filter((item): item is InstrumentTriggerEvidence => item !== null)
}

/**
 * 用「实测事实」说明触发条件为什么命中（分数、结论、时间），不复述规则原文。
 * 规则原文是条件式描述（「均分低于 X 时建议做 Y」），模型转述后容易变成
 * 「平台查过你的评估、发现你有风险」这类误读；没有实测依据时返回 null，由调用方给中性说法。
 */
export function describeTriggerEvidence(option: InstrumentOption): string | null {
  const evidence = option.triggerEvidence[0]
  if (!evidence) return null
  const facts = [
    evidence.average === null ? '' : `均分 ${evidence.average.toFixed(1)}`,
    evidence.levelName ? `结论 ${evidence.levelName}` : ''
  ].filter(Boolean)
  const when = evidence.submittedAt ? ` ${evidence.submittedAt.slice(0, 10)} 完成` : '完成'
  return `你${when}的「${evidence.title}」${facts.length ? `（${facts.join('，')}）` : ''}，业务规则据此判定现在适合做这张。`
}

/**
 * 列出某模块下所有已发布量表及其可选状态
 *
 * user.teachingGrades 传入时按学段过滤量表明细（未填的教师不过滤，口径见
 * shared/school-section.ts）；过滤只影响「候选有哪些」，不影响已填写的历史记录。
 */
export async function listInstrumentOptions(
  event: H3Event,
  module: ModuleId,
  user: { id: string, schoolId?: string | null, teachingGrades?: readonly number[] | null },
  /**
   * 提交前预演：把指定量表的本次作答视作其最新提交，仅用于状态与触发条件判定，不落库。
   * 前端在答完最后一题时传入，让「下一张建议」基于本次答案而非历史快照。
   */
  overrideLatest?: { code: string, answers: Record<string, number> },
  /**
   * 当前咨询对象（学生/班级/家长）。对象级量表（模块评估对象为班级/学生/家长的模块、
   * `per_case` 与红线检查）的完成状态与触发条件都只认同一对象的提交；不传或传 null 时
   * 这些量表一律按「未对该对象做过」处理，不把别的班级/家庭、或没有关联对象的提交当依据。
   */
  context?: AssessmentContextRef | null
): Promise<InstrumentOption[]> {
  const instruments = await listAssessmentInstruments(event, module, user.schoolId, {
    sections: viewerSchoolSections(event, user.teachingGrades)
  })
  const { latest, scoped } = await loadPriorAttempts(event, module, user.id, instruments, context ?? null)
  if (overrideLatest) {
    // level/severity/dimensions 未知，置空：触发条件只引用 answers 现算的分数，
    // 引用等级的表达式在预演时会因未知结果不命中（提交后由真实结果接管）。
    const target = instruments.find(item => item.code === overrideLatest.code)
    if (target && Object.keys(overrideLatest.answers).length === target.questions.length) {
      const previewAttempt = {
        submittedAt: new Date(),
        level: null,
        levelName: null,
        severity: null,
        dimensions: {},
        answers: overrideLatest.answers
      }
      latest.set(target.code, previewAttempt)
      // 预演的那张量表属于当前这次作答，按同一咨询对象处理
      scoped.set(target.code, previewAttempt)
    }
  }
  return buildInstrumentOptions(instruments, latest, scoped)
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

/**
 * 深度诊断建议（待办行动项）：找满足业务触发条件（suggested）但尚未完成、
 * 且不属于本次方案来源量表的深度诊断量表。生成方案时作为一条行动项写入，
 * 教师可纳入/拒绝/执行；完成对应量表后由方案详情读取侧自动置为 completed。
 * 求值失败返回 null（建议不阻断方案生成）。
 */
export async function resolveNextInstrumentSuggestion(
  event: H3Event,
  module: ModuleId,
  user: { id: string, schoolId?: string | null, teachingGrades?: readonly number[] | null },
  excludeCodes: Set<string>,
  /** 本次评估的咨询对象：对象级量表的触发条件只认同一对象的提交 */
  context?: AssessmentContextRef | null
): Promise<{ code: string, title: string, note: string | null } | null> {
  try {
    const options = await listInstrumentOptions(event, module, user, undefined, context ?? null)
    const candidate = options.find(option =>
      option.status === 'suggested'
      && !excludeCodes.has(option.code)
      // 红线检查量表由系统在高危阈值命中时触发，不通过方案待办向教师提示
      && option.role !== 'red_line'
    )
    return candidate
      ? {
          code: candidate.code,
          title: candidate.title,
          // 用实测依据说明为什么建议做，不把触发条件原文当成结论转述
          note: describeTriggerEvidence(candidate) || candidate.triggerConditionNote || candidate.description || null
        }
      : null
  } catch {
    return null
  }
}

/**
 * 评估提交后的实体业务状态快照回写。
 *
 * 业务状态层（能量场阶段、个体支持等级、沟通风险等级…）不是手工维护的档案字段，
 * 而是五大模块评估结果的投影——评估提交成功后由这里回写：
 *
 *   self_growth       → users（自我状态等级）
 *   class_system      → classes（能量场阶段）
 *   home_school       → guardians（沟通风险等级）
 *   student_case      → students（个体支持等级 caseLevel）
 *   learning_problem  → students（学习问题等级 learningLevel）
 *
 * 写的是两处：
 *   1. 标量列（如 classes.energy_stage）：列表页直接展示、可排序筛选；
 *   2. jsonb 快照（如 classes.class_snapshot）：维度分、命中归因、评估时间等全量明细。
 *
 * 管理员手动修正（overrides）在评估更新时以新评估为准——评估是事实来源，
 * 修正只用于两次评估之间的人工纠偏，新评估落地即清除对应修正项。
 */
import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import type { RuleExecResult, ModuleId } from '../../shared/contracts'
import { useDb, schema } from '../utils/db'

export interface SnapshotWriteParams {
  module: ModuleId
  schoolId: string
  /** 评估作答人（self_growth 的自我状态就是作答人自己） */
  ownerUserId: string
  studentId?: string
  classId?: string
  guardianId?: string
  result: RuleExecResult
  submittedAt: Date
}

/** 模块 → 目标实体与标量列。评估发生在哪个实体上，快照就写到哪里。 */
const MODULE_TARGET = {
  self_growth: { table: 'users' as const, key: 'selfStatusLevel' as const },
  class_system: { table: 'classes' as const, key: 'energyStage' as const },
  home_school: { table: 'guardians' as const, key: 'commRiskLevel' as const },
  student_case: { table: 'students' as const, key: 'caseLevel' as const },
  learning_problem: { table: 'students' as const, key: 'learningLevel' as const }
}

/** 评估提交后回写业务状态快照。失败不阻断评估主流程（快照是附加投影，评估记录才是事实）。 */
export async function writeEntitySnapshot(event: H3Event, params: SnapshotWriteParams) {
  const target = MODULE_TARGET[params.module]
  if (!target) return

  // 定位目标记录：self_growth 是作答人自己，其余按提交时关联的上下文
  const db = useDb(event)
  let id: string | null = null
  if (params.module === 'self_growth') {
    id = params.ownerUserId
  } else if (params.module === 'class_system') {
    id = params.classId ?? null
  } else if (params.module === 'home_school') {
    id = params.guardianId ?? null
  } else {
    id = params.studentId ?? null
  }
  if (!id) return

  const { result } = params
  const dimensions = Object.entries(result.dimensions)
  // 六维测评明细（家校沟通）：维度中文名 + 得分 + 需关注标记（<3.0 标注，docx 家校沟通字段口径）
  const dimensionScores = dimensions.map(([code, score]) => ({
    code,
    label: result.dimensionLabels[code] || code,
    score,
    attention: score < 3
  }))
  const attentionDimensions = dimensionScores.filter(item => item.attention).map(item => item.label)
  const weakestDimension = dimensionScores.length
    ? dimensionScores.reduce((min, item) => (item.score < min.score ? item : min))
    : undefined
  const snapshot = {
    module: params.module,
    level: result.level,
    levelName: result.levelName,
    severity: result.severity,
    blocked: result.blocked,
    primaryAttribution: result.primaryAttribution,
    /** 次要归因（strength 非 reference 的项），学习问题「次要归因」字段 */
    secondaryAttributions: result.secondaryAttributions,
    dimensions: result.dimensions,
    dimensionLabels: result.dimensionLabels,
    /** 维度明细（含 <3.0 需关注标记），家校沟通「六维测评结果」字段 */
    dimensionScores,
    /** 最薄弱维度：取六维度最低分，用于锁定主攻方向 */
    weakestDimension,
    /** 六维度总分 */
    totalScore: dimensions.reduce((sum, [, score]) => sum + score, 0),
    /** 维度分 < 3.0 的「需关注」维度 */
    attentionDimensions,
    /** 命中的红线明细（条件/说明/处置），家校沟通「红线熔断标记」来源 */
    matchedRedLines: result.matchedRedLines?.map(redLine => ({
      condition: redLine.condition,
      description: redLine.description,
      requiredActions: redLine.requiredActions
    })) ?? [],
    /** 命中规则结论说明（触发条件命中项） */
    reasons: result.reasons,
    /** 升级目标/责任人（如：心理教师/专业评估机构），学习问题「责任人列表」来源 */
    escalationTarget: result.escalationTarget,
    /** 命中归因明细（含编码与排序），学生个体问题「五类十五型编码」来源 */
    attributions: result.attributions.map(a => ({ code: a.code, name: a.name, rank: a.rank })),
    assessedAt: params.submittedAt.toISOString()
  }

  // 评估是事实来源：清除管理员对该标量的修正，让新评估结果生效（jsonb - 操作符删 key）
  try {
    if (target.table === 'users') {
      await db.update(schema.users)
        .set({
          selfStatusLevel: result.levelName || result.level,
          selfSnapshot: snapshot,
          overrides: sql`${schema.users.overrides} - ${target.key}`,
          updatedAt: new Date()
        })
        .where(and(eq(schema.users.id, id), eq(schema.users.schoolId, params.schoolId)))
    } else if (target.table === 'classes') {
      await db.update(schema.classes)
        .set({
          energyStage: result.levelName || result.level,
          classSnapshot: snapshot,
          overrides: sql`${schema.classes.overrides} - ${target.key}`,
          updatedAt: new Date()
        })
        .where(and(eq(schema.classes.id, id), eq(schema.classes.schoolId, params.schoolId)))
    } else if (target.table === 'guardians') {
      await db.update(schema.guardians)
        .set({
          commRiskLevel: result.levelName || result.level,
          guardianSnapshot: snapshot,
          overrides: sql`${schema.guardians.overrides} - ${target.key}`,
          updatedAt: new Date()
        })
        .where(and(eq(schema.guardians.id, id), eq(schema.guardians.schoolId, params.schoolId)))
    } else {
      await db.update(schema.students)
        .set({
          [target.key]: result.levelName || result.level,
          studentSnapshot: snapshot,
          overrides: sql`${schema.students.overrides} - ${target.key}`,
          updatedAt: new Date()
        })
        .where(and(eq(schema.students.id, id), eq(schema.students.schoolId, params.schoolId)))
    }
  } catch (error) {
    // 快照回写失败不影响评估提交结果；管理员仍可在管理页看到评估记录
    console.error(`[entity-snapshot] 回写失败 module=${params.module} id=${id}`, error)
  }
}
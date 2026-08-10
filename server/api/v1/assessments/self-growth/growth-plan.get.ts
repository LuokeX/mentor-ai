/**
 * 班主任「我的成长」规划书（方案 V2.0 子系统 A 的成长层：能力体检 → 个性化成长路径）。
 *
 * 数据全部来自运行期已产生的内容，不新造规则：
 *   - 当前状态：users.self_snapshot（自我成长评估提交时的快照回写）
 *   - 历史趋势：assessment_attempts 中 self_growth 模块已提交的评估（维度分 + 等级）
 *   - 推荐工具：按快照命中的归因名称匹配工具库（工具的「对应归因名称」列）
 */
import { and, desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)

  const [self] = await db
    .select({
      snapshot: schema.users.selfSnapshot,
      name: schema.users.name,
      teachingGrades: schema.users.teachingGrades,
      classTeacherYears: schema.users.classTeacherYears,
      subject: schema.users.subject,
      gender: schema.users.gender,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1)
  const snapshot = (self?.snapshot ?? {}) as Record<string, any>

  const attempts = await db
    .select({
      result: schema.assessmentAttempts.result,
      submittedAt: schema.assessmentAttempts.submittedAt
    })
    .from(schema.assessmentAttempts)
    .where(and(
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.module, 'self_growth'),
      eq(schema.assessmentAttempts.status, 'submitted')
    ))
    .orderBy(desc(schema.assessmentAttempts.submittedAt))
    .limit(12)

  // 历史趋势：最近 12 次评估的维度分与等级（从旧到新）
  const rawTrend = attempts
    .filter(a => a.result && typeof a.result === 'object')
    .reverse()
    .map(a => {
      const r = a.result as Record<string, any>
      return {
        assessedAt: a.submittedAt?.toISOString() ?? null,
        levelName: r.levelName || r.level || null,
        primaryAttribution: r.primaryAttribution || null,
        dimensions: (r.dimensions ?? {}) as Record<string, number>
      }
    })
  const latest = rawTrend[rawTrend.length - 1] ?? null
  // 只保留当前量表版本的维度：最新一次评估用的就是当前版本，其维度集合即展示口径。
  // 旧版本量表的历史评估（如编码 A/B）会被过滤，避免业务用户看到无法解释的编码。
  const currentDims = latest ? Object.keys(latest.dimensions ?? {}) : []
  const trend = rawTrend.map(item => {
    const filtered: Record<string, number> = {}
    for (const code of currentDims) {
      if (item.dimensions[code] !== undefined) filtered[code] = item.dimensions[code]
    }
    return { ...item, dimensions: filtered }
  })
  const dimensionLabels = (attempts[0]?.result as Record<string, any>)?.dimensionLabels ?? {}

  // 薄弱维度：最新一次评估里得分最高的 2 个（本模块得分越高状况越差）
  const weakDimensions = latest
    ? Object.entries(latest.dimensions as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([code, score]) => ({
          code,
          name: dimensionLabels[code] || code,
          score
        }))
    : []

  // 推荐工具：按快照命中的归因名称匹配工具库（payload 在版本表）
  const attributionNames = (snapshot.attributions ?? []) as string[]
  let recommendedTools: Array<{ name: string, whenToUse: string, steps: string[] }> = []
  if (attributionNames.length) {
    const tools = await db
      .select({ payload: schema.moduleResourceVersions.payload })
      .from(schema.moduleResourceVersions)
      .innerJoin(
        schema.moduleResourceLibraries,
        eq(schema.moduleResourceLibraries.id, schema.moduleResourceVersions.libraryId)
      )
      .where(and(
        eq(schema.moduleResourceLibraries.module, 'self_growth'),
        eq(schema.moduleResourceLibraries.libraryType, 'tool'),
        eq(schema.moduleResourceVersions.status, 'published')
      ))
      .limit(1)
    const toolPayload = tools[0]?.payload as { tools?: Array<Record<string, any>> } | undefined
    const matched = (toolPayload?.tools ?? []).filter(t => {
      const label = String(t.attributionLabel ?? t.attributions ?? '')
      return attributionNames.some(name => label.includes(name))
    })
    recommendedTools = matched.slice(0, 3).map(t => ({
      name: t.name ?? '',
      whenToUse: t.whenToUse ?? '',
      steps: Array.isArray(t.steps) ? t.steps : []
    }))
  }

  // 建议文案：人话，不暴露编码
  const suggestions: string[] = []
  if (latest?.levelName) {
    suggestions.push(`最近一次自我状态评估判为「${latest.levelName}」。`)
  }
  for (const w of weakDimensions) {
    suggestions.push(`「${w.name}」当前得分 ${w.score}/5，是状态里最需要关注的方向。`)
  }
  if (recommendedTools.length) {
    suggestions.push(`建议本周从推荐工具中选择一项落地，两周后复评观察变化。`)
  } else if (!latest) {
    suggestions.push('还没有自我成长评估记录——先在工作台做一次「班主任状态五问」，这里就会生成你的成长规划。')
  }

  // ---- 身份画像（教师档案字段，学校管理员维护，教师只读展示）----
  const profile = {
    name: self?.name ?? null,
    teachingGrades: self?.teachingGrades ?? [],
    classTeacherYears: self?.classTeacherYears ?? null,
    subject: self?.subject ?? null,
    gender: self?.gender ?? null,
  }

  // ---- 成长轨迹 ----
  // 打卡次数：自我成长模块方案下所有动作里已完成/进行中的执行记录数
  const checkinRows = await db
    .select({ id: schema.planActions.id })
    .from(schema.planActions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.planActions.planId))
    .where(and(
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.module, 'self_growth'),
      eq(schema.planActions.schoolId, user.schoolId),
    ))
  const checkinCount = checkinRows.length
  // 求助记录：自我成长模块的 AI 咨询会话数
  const helpRows = await db
    .select({ id: schema.chatSessions.id })
    .from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId),
      eq(schema.chatSessions.contextType, 'none'),
    ))
  const helpCount = helpRows.length
  // 当前执行方案：自我成长模块最近进行中的方案（含工具）
  const activePlans = await db
    .select({
      id: schema.plans.id,
      title: schema.plans.title,
      status: schema.plans.status,
      tools: schema.plans.tools,
      updatedAt: schema.plans.updatedAt,
    })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.module, 'self_growth'),
      eq(schema.plans.schoolId, user.schoolId),
    ))
    .orderBy(desc(schema.plans.updatedAt))
    .limit(10)
  const currentPlan = activePlans.find(p => ['pending_acceptance', 'accepted', 'in_progress', 'active'].includes(p.status)) || activePlans[0] || null

  return {
    profile,
    current: snapshot.levelName
      ? {
          levelName: snapshot.levelName,
          severity: snapshot.severity ?? null,
          assessedAt: snapshot.assessedAt ?? null,
          attributions: attributionNames
        }
      : null,
    /** 建议下次深度评估时间：按每月一次频次，从最近评估时间推算 */
    nextAssessmentAt: snapshot.assessedAt
      ? new Date(new Date(snapshot.assessedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    trend,
    dimensionLabels,
    weakDimensions,
    recommendedTools,
    suggestions,
    growth: {
      checkinCount,
      helpCount,
      currentPlan: currentPlan
        ? {
            id: currentPlan.id,
            title: currentPlan.title,
            status: currentPlan.status,
            tools: Array.isArray(currentPlan.tools) ? currentPlan.tools : [],
            updatedAt: currentPlan.updatedAt?.toISOString() ?? null,
          }
        : null,
    },
  }
})
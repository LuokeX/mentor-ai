import { sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'
import { decryptSensitive } from '../../../utils/crypto'

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  crisis: '危机',
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)
  const config = useRuntimeConfig(event)

  const [
    assessmentResult,
    planActionResult,
    communicationResult,
    alertResult,
    overdueResult,
  ] = await Promise.all([
    // 1. 最近6个月评估趋势
    db.execute(sql`
      SELECT to_char(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
             COUNT(*)::int as count
      FROM assessment_attempts
      WHERE owner_user_id = ${user.id}
        AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `),
    // 2. 方案完成率：统计所有 plans 的 actions JSONB 中 completed 占比
    db.execute(sql`
      SELECT COALESCE(COUNT(*)::int, 0) as total,
             COALESCE(COUNT(*) FILTER (WHERE action->>'status' = 'completed')::int, 0) as completed
      FROM plans,
           jsonb_array_elements(actions) as action
      WHERE owner_user_id = ${user.id}
    `),
    // 3. 最近6个月沟通趋势
    db.execute(sql`
      SELECT to_char(DATE_TRUNC('month', occurred_at), 'YYYY-MM') as month,
             COUNT(*)::int as count
      FROM communications
      WHERE owner_user_id = ${user.id}
        AND occurred_at >= DATE_TRUNC('month', NOW()) - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', occurred_at)
      ORDER BY month
    `),
    // 4. 预警分布：统计 plans.report.risk.level
    db.execute(sql`
      SELECT report->'risk'->>'level' as level,
             COUNT(*)::int as count
      FROM plans
      WHERE owner_user_id = ${user.id}
        AND report->'risk'->>'level' IS NOT NULL
      GROUP BY report->'risk'->>'level'
    `),
    // 5. 超期方案（>7天未更新的 in_progress 方案），JOIN students 获取姓名
    db.execute(sql`
      SELECT p.id, p.title, s.name_enc as "studentNameEnc", p.updated_at as "updatedAt"
      FROM plans p
      LEFT JOIN students s ON s.id = p.student_id
      WHERE p.owner_user_id = ${user.id}
        AND p.status = 'in_progress'
        AND p.updated_at < NOW() - INTERVAL '7 days'
      ORDER BY p.updated_at
    `),
  ])

  // --- planCompletion ---
  const actionStats = (planActionResult.rows as Array<{ total: number; completed: number }>)[0]
  const totalActions = actionStats?.total ?? 0
  const completedActions = actionStats?.completed ?? 0
  const planCompletion = {
    total: totalActions,
    completed: completedActions,
    rate: totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0,
  }

  // --- alertDistribution ---
  const alertDistribution = (alertResult.rows as Array<{ level: string; count: number }>).map((row) => ({
    level: row.level,
    label: RISK_LABELS[row.level] ?? row.level,
    count: row.count,
  }))

  // --- overduePlans --- 解密学生姓名，计算超期天数
  const now = Date.now()
  const overduePlans = (overdueResult.rows as Array<{
    id: string
    title: string
    studentNameEnc: string | null
    updatedAt: string
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    studentName: row.studentNameEnc
      ? (() => {
          try { return decryptSensitive(row.studentNameEnc, config.encryptionKey) }
          catch { return null }
        })()
      : null,
    daysSinceUpdate: Math.floor((now - new Date(row.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
  }))

  return {
    monthlyAssessments: assessmentResult.rows as Array<{ month: string; count: number }>,
    planCompletion,
    monthlyCommunications: communicationResult.rows as Array<{ month: string; count: number }>,
    alertDistribution,
    overduePlans,
  }
})
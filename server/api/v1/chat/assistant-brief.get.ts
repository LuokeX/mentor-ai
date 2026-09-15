import { requireUser } from '../../../utils/auth'
import { readTeacherBriefForAssistant } from '../../../domain/assistant-readers'
import { moduleMeta } from '../../../../shared/assessments'
import type { ModuleId } from '../../../../shared/contracts'

/**
 * 首页助手的「今日建议」简报。
 *
 * 定位：空态下的确定性提示，不调用任何模型——内容全部来自教师自己的数据，
 * 因此 local 数据模式也可以正常展示。前端只负责渲染与「点一条即发起提问」，
 * 真正的分析仍由 Agent 在回答里结合 teacher_brief 工具完成。
 *
 * 只返回最多 3 条，按「逾期行动项 → 待复盘方案 → 未完成量表 → 需关注沟通 → 未读通知」优先级取。
 * 返回的 prompt 是可以直接发给 AI 的中文问句；targetPath 是站内相对路径。
 */
type BriefItemKind = 'plan_review_due' | 'action_overdue' | 'draft_assessment' | 'notifications' | 'risk_communication'

interface BriefItem {
  kind: BriefItemKind
  title: string
  detail: string
  prompt: string
  targetPath?: string
}

/** ISO 时间 → YYYY-MM-DD（简报只需要日期粒度，不引入时区展示差异）。 */
function toDateText(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })

  const brief = await readTeacherBriefForAssistant(event, {
    schoolId: user.schoolId,
    userId: user.id
  })

  const items: BriefItem[] = []

  const overdue = brief.overdueActions[0]
  if (overdue) {
    items.push({
      kind: 'action_overdue',
      title: `行动项已到期：${overdue.title}`,
      detail: `来自方案「${overdue.planTitle}」${overdue.dueAt ? `，计划完成时间 ${toDateText(overdue.dueAt)}` : ''}`,
      prompt: `方案「${overdue.planTitle}」里的行动项「${overdue.title}」已经到期还没推进，帮我想想这周怎么落实。`,
      targetPath: '/plans'
    })
  }

  const review = brief.upcomingReviews[0]
  if (review) {
    items.push({
      kind: 'plan_review_due',
      title: `待复盘：${review.planTitle}`,
      detail: review.nextReviewAt ? `计划的复盘时间 ${toDateText(review.nextReviewAt)}` : '该方案还没有安排复盘时间',
      prompt: `方案「${review.planTitle}」该复盘了，帮我梳理一下复盘要问什么、怎么记录。`,
      targetPath: '/plans'
    })
  }

  const draft = brief.draftAssessments[0]
  if (draft) {
    items.push({
      kind: 'draft_assessment',
      title: '有未完成的量表',
      detail: `${moduleMeta[draft.module as ModuleId]?.title || '模块'}的量表已答 ${draft.answeredCount} 题，尚未提交`,
      prompt: '我有一张量表做了一半没提交，帮我确认接下来该怎么做完它并拿到结论。',
      targetPath: `/module/${draft.module}`
    })
  }

  const risk = brief.riskCommunications[0]
  if (risk) {
    items.push({
      kind: 'risk_communication',
      title: `需关注的家校沟通${risk.studentLabel ? `：${risk.studentLabel}` : ''}`,
      detail: risk.summary || '最近有一条高关注的沟通记录',
      prompt: '最近有一条比较棘手的家校沟通记录，帮我梳理下一步该怎么跟进。',
      targetPath: '/information'
    })
  }

  if (brief.unreadNotifications > 0) {
    items.push({
      kind: 'notifications',
      title: `有 ${brief.unreadNotifications} 条未读通知`,
      detail: '包含方案到期、转介与安全提醒等',
      prompt: '帮我看看有哪些未读通知需要我尽快处理。',
      targetPath: '/notifications'
    })
  }

  return {
    items: items.slice(0, 3),
    generatedAt: new Date().toISOString()
  }
})

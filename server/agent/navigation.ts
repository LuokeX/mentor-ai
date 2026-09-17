import { assistantNavigationSchema, type AssistantNavigationCard } from '../../shared/assistant'
import type { AssistantPlanRow, AssistantAssessmentHistory } from '../domain/assistant-readers'

export function planNavigation(plans: AssistantPlanRow[], question: string): AssistantNavigationCard[] {
  return plans.slice(0, 2).flatMap(plan => {
    const review = /复盘|回顾/.test(question) && plan.status === 'review_due'
    const parsed = assistantNavigationSchema.safeParse({ kind: 'navigate', title: plan.title,
      content: review ? '结合执行结果，在已有方案中填写复盘。' : '查看已有方案及行动进度。',
      ctaLabel: !plan.object && plan.module !== 'self_growth' ? '进入模块' : review ? '进入复盘' : '查看方案', to: !plan.object && plan.module !== 'self_growth' ? `/module/${plan.module}` : `/plans/${plan.id}${review ? '#review' : ''}` })
    return parsed.success ? [parsed.data] : []
  })
}

export function assessmentNavigation(history: AssistantAssessmentHistory, question: string): AssistantNavigationCard[] {
  const drafts = history.drafts.map(row => ({ kind: 'navigate', title: '继续未完成的评估', content: '继续已有草稿，作答门禁以模块页面为准。', ctaLabel: '继续量表',
    to: `/module/${row.module}?instrumentCode=${encodeURIComponent(row.assessmentCode)}${row.object ? `&contextType=${row.object.type}&contextId=${row.object.id}` : ''}` }))
  const submitted = history.submitted.filter(row => row.sessionId && (row.object || row.module === 'self_growth')).map(row => ({ kind: 'navigate', title: '查看已有评估', content: '查看已提交的评估记录。', ctaLabel: '查看评估记录', to: `/assessments/${row.sessionId}` }))
  return (/没做完|继续|草稿/.test(question) ? [...drafts, ...submitted] : [...submitted, ...drafts])
    .flatMap(card => { const parsed = assistantNavigationSchema.safeParse(card); return parsed.success ? [parsed.data] : [] }).slice(0, 2)
}

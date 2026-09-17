import { z } from 'zod'

export const assistantNavigationSchema = z.object({
  kind: z.literal('navigate'),
  title: z.string().min(1).max(160),
  content: z.string().max(500),
  ctaLabel: z.string().min(1).max(60),
  to: z.string().regex(/^\/(?:plans\/[0-9a-f-]{36}(?:#review)?|assessments\/[0-9a-f-]{36}|module\/(?:self_growth|class_system|home_school|student_case|learning_problem)(?:\?[A-Za-z0-9_%=&.-]+)?)$/)
})
export type AssistantNavigationCard = z.infer<typeof assistantNavigationSchema>
export const assistantFeedbackReasons = [
  { value: 'not_relevant', label: '不贴合' }, { value: 'not_actionable', label: '不可执行' },
  { value: 'source_insufficient', label: '依据不足' }, { value: 'too_generic', label: '太空泛' }
] as const
export type AssistantFeedbackReason = typeof assistantFeedbackReasons[number]['value']

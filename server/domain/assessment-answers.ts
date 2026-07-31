/**
 * 作答合法性判定。
 *
 * 唯一的判据是题目自己的选项集合（④b 选项组），不能写死 1..5：
 * 业务用 0/1 二值选项组做「红线检查」类量表（否=0 / 是=1）是 v4 ③b 角色说明
 * 明确推荐的用法，写死 1..5 会让这类量表整张不可用——教师全选「否」会被判成没作答。
 *
 * 这份判定同时被 API 层（submit / draft）和规则引擎使用，必须只有一份实现：
 * 两处走不同规则时，教师会遇到「前端能提交、后端算不出」或反过来的错位。
 */

export interface AnswerableQuestion {
  id: string
  options?: Array<{ value: number }>
}

/** 该题允许的取值集合；没定义选项组时退回 1..5 */
export function allowedAnswerValues(question: AnswerableQuestion): number[] {
  const values = (question.options || []).map(option => option.value).filter(Number.isFinite)
  return values.length ? values : [1, 2, 3, 4, 5]
}

/** 单题作答是否合法。undefined / NaN / 不在选项集合内都算不合法。 */
export function isAnswerValid(question: AnswerableQuestion, raw: unknown): boolean {
  const value = Number(raw ?? NaN)
  if (!Number.isFinite(value)) return false
  return allowedAnswerValues(question).includes(value)
}

/**
 * 返回未作答或超出选项范围的题号。空数组表示全部合法。
 * 注意不能用 `!answers[id]` 判断——0 是合法分值，会被判成未作答。
 */
export function findInvalidAnswers(
  questions: AnswerableQuestion[],
  answers: Record<string, unknown>
): string[] {
  return questions.filter(question => !isAnswerValid(question, answers[question.id])).map(question => question.id)
}

/** 草稿是部分作答，只校验「已填的那些」合法，不要求填满 */
export function findInvalidDraftAnswers(
  questions: AnswerableQuestion[],
  answers: Record<string, unknown>
): string[] {
  const byId = new Map(questions.map(question => [question.id, question]))
  return Object.entries(answers)
    .filter(([id, value]) => {
      const question = byId.get(id)
      return !question || !isAnswerValid(question, value)
    })
    .map(([id]) => id)
}

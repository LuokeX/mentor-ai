import { inspectAgentAnswer } from './answer-guard'
import { needsEvidenceReview } from './evidence'

/**
 * 逐句释放模型输出：普通句子按完整句子即时下发；
 * 命中复核条件（制度/量表/等级/诊断类表述、疑似密钥）的句子单独扣住，留到整轮校验时再决定去留，
 * 其余句子不受影响、继续流式输出——避免一句话命中就把后面整段压到最后一次性发出。
 * onWithhold：有句子被扣住时回调（可多次），供上层提示教师「正在核对回答依据」。
 */
export class AnswerDelivery {
  private pending = ''
  private reviewNeeded: boolean
  constructor(
    userText: string,
    private readonly emit: (text: string) => void,
    private readonly onWithhold?: () => void
  ) {
    // 教师提问本身命中复核词：本轮需要整轮校验，但不因此扣住回答内容
    this.reviewNeeded = needsEvidenceReview(userText)
  }
  push(text: string) {
    this.pending += text
    const pieces = this.pending.match(/[^。！？\n]*[。！？\n]+/g) ?? []
    for (const sentence of pieces) {
      this.pending = this.pending.slice(sentence.length)
      const inspected = inspectAgentAnswer({ answer: sentence })
      if (needsEvidenceReview(sentence) || inspected.violations.some(v => ['diagnostic_claim', 'secret_like_token'].includes(v))) {
        this.reviewNeeded = true
        this.notifyWithhold()
        continue
      }
      this.emit(inspected.cleaned)
    }
  }
  get requiresReview() { return this.reviewNeeded }
  /** 提示回调异常不得影响本轮流式与落库。 */
  private notifyWithhold() {
    try { this.onWithhold?.() } catch { /* 提示失败不影响回答 */ }
  }
}

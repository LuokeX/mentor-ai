import { z } from 'zod'
import { readGovernedContextSnapshot } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const studentSnapshotSchema = z.object({
  studentId: z.string().uuid().describe('学生 id，必须来自 student_search 的返回结果或当前会话绑定的咨询对象')
})

/**
 * 指定学生的档案快照（只读）。
 *
 * 与 record_snapshot 的分工：record_snapshot 不带参数、只读当前会话绑定的对象；
 * 本工具按 id 读取，用于「教师提到的是另一个学生」这类场景，id 必须先由 student_search 解析得到。
 * 权限与脱敏复用 readGovernedContextSnapshot（schoolId + ownerUserId 校验，违规一律 404 语义）。
 */
export const studentSnapshotTool: AgentTool = {
  name: 'student_snapshot',
  description: '按学生 id 读取该学生的档案快照：基本信息、家长关系、最近沟通、在跟方案与复盘。studentId 必须来自 student_search 的返回结果；教师未指名具体学生时，改用 record_snapshot 读当前咨询对象。',
  schema: studentSnapshotSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = studentSnapshotSchema.safeParse(args)
    if (!parsed.success) {
      return { message: 'studentId 必须是 student_search 返回的学生 id，请先检索再读取。' }
    }
    return readGovernedContextSnapshot(ctx, 'student', parsed.data.studentId)
  }
}

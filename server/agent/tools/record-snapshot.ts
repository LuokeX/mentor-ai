import { z } from 'zod'
import { effectiveObjects, readGovernedContextSnapshot } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const recordSnapshotSchema = z.object({})

/** 多对象时最多返回几份档案摘要（@ 多名学生时不把 5 份完整档案一次性塞进上下文）。 */
const RECORD_SNAPSHOT_MAX_OBJECTS = 3

/**
 * 咨询对象档案快照（只读）：读取当前会话绑定 / 本轮识别的学生、班级、家长档案，
 * 包含基本信息、家长关系、最近沟通与在跟方案/复盘摘要（多对象时逐个返回，最多 3 个）。
 *
 * 设计说明（P1）：档案细节从 system prompt 移出、改由本工具按需查询，
 * 这样 system 前缀在会话内保持稳定，DeepSeek 前缀缓存才能持续命中。
 * 权限、脱敏与异常处理统一在 readGovernedContextSnapshot，与 student_snapshot 共用。
 */
export const recordSnapshotTool: AgentTool = {
  name: 'record_snapshot',
  description: '读取当前咨询对象（学生/班级/家长）的档案快照：基本信息、家长关系、最近沟通、在跟方案与复盘。回答涉及该对象的具体事实前先调用一次；对象可以是会话绑定的，也可以是教师本轮消息里提到的（服务端已解析归属，可能同时有多个）；都没有时返回提示。',
  schema: recordSnapshotSchema,
  async execute(_args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const targets = effectiveObjects(ctx.user)
    if (!targets.length) {
      return { message: '当前会话未绑定咨询对象，请基于教师描述回答，不要假设档案内容。' }
    }
    const picked = targets.slice(0, RECORD_SNAPSHOT_MAX_OBJECTS)
    const snapshots = []
    for (const target of picked) {
      snapshots.push({
        object: { type: target.type, id: target.id, label: target.label ?? null },
        ...await readGovernedContextSnapshot(ctx, target.type, target.id)
      })
    }
    if (targets.length <= picked.length) return picked.length === 1 ? snapshots[0] : { snapshots }
    return {
      snapshots,
      message: `本次共涉及 ${targets.length} 个咨询对象，这里只返回前 ${picked.length} 个的档案；如需其余对象的档案，请在下一轮单独指定。`
    }
  }
}

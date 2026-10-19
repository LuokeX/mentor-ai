/**
 * 业务记录「关联多名学生 / 多名家长」的公共校验与归一化。
 *
 * 背景（2026-10-16）：学生事件记录支持关联多名学生，家校沟通（家长事件记录）支持多选学生与多选家长。
 * 两个入口的规则必须一致：首个选中项是主对象（写主列，看板聚合与既有读取链路按它读），
 * 其余写各自的关联表（只存增量，避免双写漂移）；越权 id 必须在写入前整体拒绝。
 *
 * 归属校验口径沿用各入口原有语义：一律要求 schoolId + ownerUserId 命中，
 * 记录业务档案（学生事件）额外要求学生在册（status='active'）——由调用方用 requireActive 指定。
 */
import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { RECORD_RELATED_TARGET_MAX } from '../../shared/contracts'
import type { AuthUser } from '../../app/composables/useAuth'
import { schema, useDb } from '../utils/db'

export { RECORD_RELATED_TARGET_MAX } from '../../shared/contracts'

export interface ResolvedRecordTargets {
  /** 主对象 id；未选择时为 null */
  primary: string | null
  /** 其余关联对象 id（已去重、不含主对象） */
  related: string[]
}

/**
 * 校验并归一化多选 id 列表：去重、限流、逐个校验归属。
 * 任一 id 不属于当前教师（或不在册）时抛 422，消息不回显具体 id，避免用来探测他人数据。
 */
export async function resolveOwnedRecordTargets(
  event: H3Event,
  user: AuthUser,
  input: {
    kind: 'student' | 'guardian'
    ids: string[]
    /** 是否要求对象在册（学生事件按在册学生登记；沟通记录沿用不校验在册的既有口径） */
    requireActive?: boolean
    /** 上限（默认 RECORD_RELATED_TARGET_MAX） */
    max?: number
  }
): Promise<ResolvedRecordTargets> {
  const max = input.max ?? RECORD_RELATED_TARGET_MAX
  const ids = [...new Set(input.ids.filter(Boolean))].slice(0, max)
  if (!ids.length) return { primary: null, related: [] }
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const table = input.kind === 'student' ? schema.students : schema.guardians
  const conditions = [
    eq(table.schoolId, user.schoolId),
    eq(table.ownerUserId, user.id),
    inArray(table.id, ids)
  ]
  if (input.requireActive) conditions.push(eq(table.status, 'active'))
  const found = await db.select({ id: table.id }).from(table).where(and(...conditions))
  const owned = new Set(found.map(row => row.id))
  if (ids.some(id => !owned.has(id))) {
    throw createError({
      statusCode: 422,
      message: input.kind === 'student' ? '所选学生不存在或不属于当前教师' : '所选家长不存在或不属于当前教师'
    })
  }
  return { primary: ids[0]!, related: ids.slice(1) }
}

/**
 * 统一生命周期服务
 *
 * 提供归档、恢复、移交的标准实现。
 * 每个领域仍保留自己的校验和事务逻辑，此文件仅提供公共工具函数。
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb, schema } from '../utils/db'
import { writeAudit } from '../utils/audit'

type LifecycleTable = typeof schema.classes | typeof schema.students | typeof schema.guardians | typeof schema.departments

function lifecycleTargetType(table: LifecycleTable) {
  if (table === schema.classes) return 'class'
  if (table === schema.students) return 'student'
  if (table === schema.guardians) return 'guardian'
  return 'department'
}

/**
 * 通用归档操作：
 * - 验证记录存在且在学校+负责人范围内
 * - 检查 expectedUpdatedAt 并发控制
 * - 设置 archivedAt 和 archivedBy
 */
export async function archiveRecord(
  event: H3Event,
  table: LifecycleTable,
  id: string,
  schoolId: string,
  ownerUserId: string | undefined,
  actorId: string,
  expectedUpdatedAt?: string,
  reason?: string,
) {
  const db = useDb(event)
  return await db.transaction(async (tx) => {
    const conditions = [eq(table.id, id), eq(table.schoolId, schoolId)]
    if (ownerUserId && 'ownerUserId' in (table as any)) {
      conditions.push(eq((table as any).ownerUserId, ownerUserId))
    }
    const [record] = await tx.select().from(table).where(and(...conditions)).limit(1)
    if (!record) throw createError({ statusCode: 404, message: '记录不存在' })

    if (expectedUpdatedAt && record.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }

    if (record.status === 'archived') {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '记录已归档' })
    }

    const finalConditions = [...conditions]
    if (expectedUpdatedAt) finalConditions.push(eq(table.updatedAt, new Date(expectedUpdatedAt)))
    const [updated] = await tx.update(table).set({
      status: 'archived',
      archivedAt: new Date(),
      archivedBy: actorId,
      updatedAt: new Date(),
    } as any).where(and(...finalConditions)).returning({ id: table.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }

    await writeAudit(event, {
      schoolId, actorId, action: `lifecycle.archive`,
      targetType: lifecycleTargetType(table), targetId: id,
      metadata: { previousStatus: record.status, reason },
    }, tx)
    return updated
  })
}

/**
 * 通用恢复操作：将归档记录恢复为 active
 */
export async function restoreRecord(
  event: H3Event,
  table: LifecycleTable,
  id: string,
  schoolId: string,
  actorId: string,
  expectedUpdatedAt?: string,
  reason?: string,
) {
  const db = useDb(event)
  return await db.transaction(async (tx) => {
    const [record] = await tx.select().from(table).where(and(
      eq(table.id, id), eq(table.schoolId, schoolId),
    )).limit(1)
    if (!record) throw createError({ statusCode: 404, message: '记录不存在' })

    if (record.status !== 'archived') {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '只能恢复已归档的记录' })
    }

    if (expectedUpdatedAt && record.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }

    const conditions = [
      eq(table.id, id),
      eq(table.schoolId, schoolId),
      eq(table.status, 'archived'),
    ]
    if (expectedUpdatedAt) conditions.push(eq(table.updatedAt, new Date(expectedUpdatedAt)))
    const [updated] = await tx.update(table).set({
      status: 'active',
      archivedAt: null,
      archivedBy: null,
      updatedAt: new Date(),
    } as any).where(and(...conditions)).returning({ id: table.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }

    await writeAudit(event, {
      schoolId, actorId, action: `lifecycle.restore`,
      targetType: lifecycleTargetType(table), targetId: id,
      metadata: { reason },
    }, tx)
    return updated
  })
}

/**
 * 校验生命周期操作是否合法
 */
export function validateLifecycleAction(
  currentStatus: string,
  action: string,
  allowedTransitions: Record<string, string[]>,
): void {
  const allowed = allowedTransitions[currentStatus]
  if (!allowed || !allowed.includes(action)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'INVALID_TRANSITION',
      message: `当前状态 "${currentStatus}" 不允许执行 "${action}" 操作`,
    })
  }
}

/**
 * 通用状态流转：
 *   active → archived, graduated
 *   archived → active (restore)
 *   disabled → (不可逆)
 */
export const DEFAULT_LIFECYCLE: Record<string, string[]> = {
  'active': ['archive', 'transfer', 'graduate'],
  'archived': ['restore'],
  'graduated': [],
  'disabled': [],
  'draft': ['submit', 'archive'],
  'submitted': ['archive'],
  'open': ['resolve', 'close'],
  'resolved': ['close', 'reopen'],
  'closed': ['reopen'],
  'in_progress': ['complete', 'close'],
  'completed': ['close'],
}

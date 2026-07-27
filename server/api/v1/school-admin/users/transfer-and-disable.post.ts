/**
 * 业务移交并停用账号
 *
 * 在单个事务中完成：
 * 1. 验证接收人同校、有效且角色合适
 * 2. 移交班级、学生、家长、沟通、方案、案例、行动和通知责任
 * 3. 写入 recordAssignments
 * 4. 检查心理转介（未完成转介需指定新专员）
 * 5. 撤销原账号会话和恢复码
 * 6. 将账号设为 disabled
 * 7. 写入审计
 */
import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { requireSchoolManagement } from '../../../../domain/school-management'

const transferAndDisableSchema = z.object({
  toUserId: z.string().uuid(),
  newPsychologistId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).max(500),
})

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = transferAndDisableSchema.parse(await readBody(event))
  const db = useDb(event)

  // 1. 验证目标用户存在且属于同校
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id),
    eq(schema.users.schoolId, schoolId),
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })
  if (target.status === 'disabled') throw createError({ statusCode: 409, message: '该账号已停用' })

  // 验证接收人
  if (body.toUserId === id) throw createError({ statusCode: 422, message: '不能将业务移交给自己' })
  const [receiver] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, body.toUserId),
    eq(schema.users.schoolId, schoolId),
    eq(schema.users.status, 'active'),
  )).limit(1)
  if (!receiver) throw createError({ statusCode: 422, message: '接收用户不存在或不可用' })

  // 2-7. 事务执行
  await db.transaction(async (tx) => {
    const oldOwnerId = id
    const newOwnerId = body.toUserId

    // 移交班级
    await tx.update(schema.classes).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.classes.schoolId, schoolId),
      eq(schema.classes.ownerUserId, oldOwnerId),
      eq(schema.classes.status, 'active'),
    ))

    // 移交学生（未归档的）
    await tx.update(schema.students).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.students.schoolId, schoolId),
      eq(schema.students.ownerUserId, oldOwnerId),
      eq(schema.students.status, 'active'),
    ))

    // 移交家长（未归档的）
    await tx.update(schema.guardians).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.guardians.schoolId, schoolId),
      eq(schema.guardians.ownerUserId, oldOwnerId),
      eq(schema.guardians.status, 'active'),
    ))

    // 移交沟通记录
    await tx.update(schema.communications).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.communications.schoolId, schoolId),
      eq(schema.communications.ownerUserId, oldOwnerId),
    ))

    // 移交方案（进行中的）
    await tx.update(schema.plans).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.plans.schoolId, schoolId),
      eq(schema.plans.ownerUserId, oldOwnerId),
      eq(schema.plans.status, 'in_progress'),
    ))

    // 移交案例（未关闭的）
    await tx.update(schema.moduleCases).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.moduleCases.schoolId, schoolId),
      eq(schema.moduleCases.ownerUserId, oldOwnerId),
      eq(schema.moduleCases.status, 'active'),
    ))

    // 移交方案行动
    await tx.update(schema.planActions).set({
      ownerUserId: newOwnerId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.planActions.schoolId, schoolId),
      eq(schema.planActions.ownerUserId, oldOwnerId),
      inArray(schema.planActions.status, ['pending', 'in_progress']),
    ))

    // 移交通知
    await tx.update(schema.notifications).set({
      userId: newOwnerId,
    }).where(and(
      eq(schema.notifications.schoolId, schoolId),
      eq(schema.notifications.userId, oldOwnerId),
      eq(schema.notifications.readAt, sql`NULL`),
    ))

    // 记录移交分配
    for (const targetType of ['class', 'student', 'guardian', 'communication', 'plan', 'case']) {
      await tx.insert(schema.recordAssignments).values({
        schoolId,
        targetType,
        targetId: id, // 标记为"从该用户的所有记录"
        fromUserId: oldOwnerId,
        toUserId: newOwnerId,
        assignedBy: actor.id,
        reason: body.reason,
        metadata: { bulk: true },
      })
    }

    // 检查心理转介
    if (target.role === 'psychologist') {
      const [openReferral] = await tx.select({ id: schema.referrals.id }).from(schema.referrals).where(and(
        eq(schema.referrals.psychologistId, oldOwnerId),
        inArray(schema.referrals.status, ['created', 'acknowledged', 'in_progress']),
      )).limit(1)
      if (openReferral) {
        if (!body.newPsychologistId) {
          throw createError({ statusCode: 422, message: '该心理专员仍有未完成转介，必须指定新的心理专员接收' })
        }
        await tx.update(schema.referrals).set({
          psychologistId: body.newPsychologistId,
          updatedAt: new Date(),
        }).where(and(
          eq(schema.referrals.psychologistId, oldOwnerId),
          inArray(schema.referrals.status, ['created', 'acknowledged', 'in_progress']),
        ))
      }
    }

    // 撤销原账号会话
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, oldOwnerId))
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, oldOwnerId))

    // 停用账号
    await tx.update(schema.users).set({
      status: 'disabled',
      disabledAt: new Date(),
      disabledBy: actor.id,
      disabledReason: body.reason,
      updatedAt: new Date(),
    }).where(eq(schema.users.id, oldOwnerId))
  })

  await writeAudit(event, {
    schoolId, actorId: actor.id,
    action: 'school_admin.user.transfer_and_disable',
    targetType: 'user', targetId: id,
    metadata: {
      toUserId: body.toUserId,
      reason: body.reason,
      targetRole: target.role,
      delegatedGrantId,
    },
  })

  return { ok: true }
})
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'
import { requireSchoolManagement, assertActiveTeacher, writeAssignment } from '../../../../../domain/school-management'

const transferAndDisableSchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  // 如果存在未完成心理转介，必须指定新的心理专员
  newPsychologistId: z.string().uuid().optional()
})

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = transferAndDisableSchema.parse(await readBody(event))
  const db = useDb(event)

  // 1. 验证目标用户存在且可停用
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '目标用户不存在' })
  if (target.status === 'disabled') throw createError({ statusCode: 409, message: '该账号已被停用' })

  // 2. 验证接收人
  if (body.toUserId === id) throw createError({ statusCode: 422, message: '不能将业务移交给同一个账号' })
  await assertActiveTeacher(event, schoolId, body.toUserId)

  // 3. 检查心理转介：如果是心理专员且存在未完成转介
  if (target.role === 'psychologist') {
    const [openReferral] = await db.select({ id: schema.referrals.id }).from(schema.referrals).where(and(
      eq(schema.referrals.psychologistId, id),
      eq(schema.referrals.schoolId, schoolId),
      inArray(schema.referrals.status, ['created', 'acknowledged', 'in_progress'])
    )).limit(1)
    if (openReferral && !body.newPsychologistId) {
      throw createError({ statusCode: 422, message: '该心理专员存在未完成的转介工单，请指定新的心理专员' })
    }
  }

  await db.transaction(async (tx) => {
    // 4. 移交班级
    const userClasses = await tx.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.schoolId, schoolId), eq(schema.classes.ownerUserId, id)
    ))
    if (userClasses.length > 0) {
      await tx.update(schema.classes).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
        .where(and(eq(schema.classes.schoolId, schoolId), eq(schema.classes.ownerUserId, id)))
      for (const c of userClasses) {
        await writeAssignment(tx, { schoolId, targetType: 'class', targetId: c.id, fromUserId: id, toUserId: body.toUserId, assignedBy: actor.id, reason: body.reason })
      }
    }

    // 5. 移交学生
    const userStudents = await tx.select({ id: schema.students.id }).from(schema.students).where(and(
      eq(schema.students.schoolId, schoolId), eq(schema.students.ownerUserId, id)
    ))
    if (userStudents.length > 0) {
      await tx.update(schema.students).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
        .where(and(eq(schema.students.schoolId, schoolId), eq(schema.students.ownerUserId, id)))
      for (const s of userStudents) {
        await writeAssignment(tx, { schoolId, targetType: 'student', targetId: s.id, fromUserId: id, toUserId: body.toUserId, assignedBy: actor.id, reason: body.reason })
      }
    }

    // 6. 移交家长
    const userGuardians = await tx.select({ id: schema.guardians.id }).from(schema.guardians).where(and(
      eq(schema.guardians.schoolId, schoolId), eq(schema.guardians.ownerUserId, id)
    ))
    if (userGuardians.length > 0) {
      await tx.update(schema.guardians).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
        .where(and(eq(schema.guardians.schoolId, schoolId), eq(schema.guardians.ownerUserId, id)))
      for (const g of userGuardians) {
        await writeAssignment(tx, { schoolId, targetType: 'guardian', targetId: g.id, fromUserId: id, toUserId: body.toUserId, assignedBy: actor.id, reason: body.reason })
      }
    }

    // 7. 移交沟通记录
    const userComms = await tx.select({ id: schema.communications.id }).from(schema.communications).where(and(
      eq(schema.communications.schoolId, schoolId), eq(schema.communications.ownerUserId, id)
    ))
    if (userComms.length > 0) {
      await tx.update(schema.communications).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
        .where(and(eq(schema.communications.schoolId, schoolId), eq(schema.communications.ownerUserId, id)))
      for (const com of userComms) {
        await writeAssignment(tx, { schoolId, targetType: 'communication', targetId: com.id, fromUserId: id, toUserId: body.toUserId, assignedBy: actor.id, reason: body.reason })
      }
    }

    // 8. 移交方案
    const userPlans = await tx.select({ id: schema.plans.id }).from(schema.plans).where(and(
      eq(schema.plans.schoolId, schoolId), eq(schema.plans.ownerUserId, id)
    ))
    if (userPlans.length > 0) {
      await tx.update(schema.plans).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
        .where(and(eq(schema.plans.schoolId, schoolId), eq(schema.plans.ownerUserId, id)))
      for (const p of userPlans) {
        await writeAssignment(tx, { schoolId, targetType: 'plan', targetId: p.id, fromUserId: id, toUserId: body.toUserId, assignedBy: actor.id, reason: body.reason })
      }
    }

    // 9. 移交案例
    await tx.update(schema.moduleCases).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
      .where(and(eq(schema.moduleCases.schoolId, schoolId), eq(schema.moduleCases.ownerUserId, id)))

    // 10. 移交方案行动（planActions 有独立的 ownerUserId）
    await tx.update(schema.planActions).set({ ownerUserId: body.toUserId, updatedAt: new Date() })
      .where(and(eq(schema.planActions.schoolId, schoolId), eq(schema.planActions.ownerUserId, id)))

    // 11. 移交心理转介（如果指定了新专员）
    if (body.newPsychologistId) {
      await tx.update(schema.referrals).set({ psychologistId: body.newPsychologistId, updatedAt: new Date() })
        .where(and(eq(schema.referrals.psychologistId, id), eq(schema.referrals.schoolId, schoolId), inArray(schema.referrals.status, ['created', 'acknowledged', 'in_progress'])))
    }

    // 12. 撤销会话和恢复码
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id))
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, id))

    // 13. 将账号设为 disabled
    await tx.update(schema.users).set({
      status: 'disabled',
      disabledAt: new Date(),
      disabledBy: actor.id,
      disabledReason: body.reason,
      updatedAt: new Date()
    }).where(eq(schema.users.id, id))
  })

  await writeAudit(event, {
    schoolId, actorId: actor.id,
    action: 'school_admin.user.transfer_and_disable',
    targetType: 'user', targetId: id,
    metadata: {
      toUserId: body.toUserId, reason: body.reason,
      newPsychologistId: body.newPsychologistId, delegatedGrantId
    }
  })

  return { ok: true }
})
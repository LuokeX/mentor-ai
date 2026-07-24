import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { requireSchoolManagement } from '../../../../domain/school-management'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  // 仅拒绝 active（正在使用中）的账号。invited 和 disabled 均可删除。
  if (target.status === 'active') {
    throw createError({ statusCode: 409, message: '请先停用该账号后再删除。' })
  }

  const NULL = sql`NULL`
  // 用于 referrals 间接依赖 safetyEvents 的子查询
  const userSafetyEventIds = db.select({ id: schema.safetyEvents.id }).from(schema.safetyEvents).where(eq(schema.safetyEvents.ownerUserId, id))

  await db.transaction(async (tx) => {
    // === 1. 级联删除 NOT NULL FK 的业务数据（按 FK 依赖顺序，自底向上） ===

    // ---- 直接引 users 的叶子表 ----
    await tx.delete(schema.assistantFeedback).where(eq(schema.assistantFeedback.userId, id))
    await tx.delete(schema.routingDecisions).where(eq(schema.routingDecisions.ownerUserId, id))
    await tx.delete(schema.chatMessages).where(eq(schema.chatMessages.ownerUserId, id))
    await tx.delete(schema.communications).where(eq(schema.communications.ownerUserId, id))

    // ---- 安全事件链: referrals → safetyEvents ----
    await tx.delete(schema.referrals).where(inArray(schema.referrals.safetyEventId, userSafetyEventIds))
    // referralEvents 有 ON DELETE CASCADE from referrals

    // ---- 方案链: planActions/planReviews 有独立 ownerUserId FK，先按用户直接清 ----
    await tx.delete(schema.planActions).where(eq(schema.planActions.ownerUserId, id))
    await tx.delete(schema.planReviews).where(eq(schema.planReviews.ownerUserId, id))
    // 再删 plans，planActions/planReviews 的 planId CASCADE 兜底
    await tx.delete(schema.plans).where(eq(schema.plans.ownerUserId, id))

    // ---- 测评/个案 ----
    await tx.delete(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, id))
    await tx.delete(schema.moduleCases).where(eq(schema.moduleCases.ownerUserId, id))

    // ---- 学生/家长/班级: 先删子表再删父表 ----
    await tx.delete(schema.students).where(eq(schema.students.ownerUserId, id))
    // studentGuardians 有 ON DELETE CASCADE from students
    await tx.delete(schema.guardians).where(eq(schema.guardians.ownerUserId, id))
    // studentGuardians 有 ON DELETE CASCADE from guardians
    await tx.delete(schema.classes).where(eq(schema.classes.ownerUserId, id))
    // students.classId 有 ON DELETE SET NULL

    // ---- 聊天会话 (chatMessages 已先清) ----
    await tx.delete(schema.chatSessions).where(eq(schema.chatSessions.ownerUserId, id))
    // chatMessages.sessionId 有 ON DELETE CASCADE

    // ---- 模块资源库链 ----
    await tx.delete(schema.moduleResourceLibraries).where(eq(schema.moduleResourceLibraries.createdBy, id))
    // moduleResourceVersions 有 CASCADE → moduleResourceDocuments CASCADE → moduleResourceChunks CASCADE
    // 兜底清理
    await tx.delete(schema.moduleResourceVersions).where(eq(schema.moduleResourceVersions.createdBy, id))
    await tx.delete(schema.moduleResourceDocuments).where(eq(schema.moduleResourceDocuments.createdBy, id))

    // ---- 导入记录 ----
    await tx.delete(schema.schoolImports).where(eq(schema.schoolImports.createdBy, id))

    // ---- 安全事件 (referrals 已先清) ----
    await tx.delete(schema.safetyEvents).where(eq(schema.safetyEvents.ownerUserId, id))

    // ---- 管理员审计/授权链 ----
    await tx.delete(schema.adminAccessEvents).where(eq(schema.adminAccessEvents.actorId, id))
    await tx.delete(schema.adminAccessGrants).where(eq(schema.adminAccessGrants.userId, id))
    // adminAccessEvents.grantId 有 ON DELETE CASCADE (nullable)
    await tx.delete(schema.adminAccessRequests).where(eq(schema.adminAccessRequests.requesterId, id))
    // adminAccessGrants.requestId 有 ON DELETE CASCADE
    await tx.delete(schema.delegatedManagementGrants).where(eq(schema.delegatedManagementGrants.requesterId, id))

    // ---- 移交记录 ----
    await tx.delete(schema.recordAssignments).where(eq(schema.recordAssignments.toUserId, id))

    // ---- 邀请记录 (invitedBy) ----
    await tx.delete(schema.invitations).where(eq(schema.invitations.invitedBy, id))

    // === 2. 清除所有可空 FK 引用（SET NULL） ===
    await tx.update(schema.departments).set({ leaderUserId: NULL }).where(eq(schema.departments.leaderUserId, id))
    await tx.update(schema.schoolSettings).set({ referralPsychologistId: NULL }).where(eq(schema.schoolSettings.referralPsychologistId, id))
    await tx.update(schema.schoolSettings).set({ aiApprovedBy: NULL }).where(eq(schema.schoolSettings.aiApprovedBy, id))
    await tx.update(schema.adminAccessRequests).set({ reviewerId: NULL }).where(eq(schema.adminAccessRequests.reviewerId, id))
    await tx.update(schema.delegatedManagementGrants).set({ reviewerId: NULL }).where(eq(schema.delegatedManagementGrants.reviewerId, id))
    await tx.update(schema.recordAssignments).set({ fromUserId: NULL }).where(eq(schema.recordAssignments.fromUserId, id))
    await tx.update(schema.recordAssignments).set({ assignedBy: NULL }).where(eq(schema.recordAssignments.assignedBy, id))
    await tx.update(schema.productEvents).set({ userId: NULL }).where(eq(schema.productEvents.userId, id))
    await tx.update(schema.auditLogs).set({ actorId: NULL }).where(eq(schema.auditLogs.actorId, id))
    await tx.update(schema.referrals).set({ psychologistId: NULL }).where(eq(schema.referrals.psychologistId, id))
    await tx.update(schema.referralEvents).set({ actorId: NULL }).where(eq(schema.referralEvents.actorId, id))
    await tx.update(schema.contentPackages).set({ createdBy: NULL }).where(eq(schema.contentPackages.createdBy, id))
    await tx.update(schema.contentPackages).set({ publishedBy: NULL }).where(eq(schema.contentPackages.publishedBy, id))
    await tx.update(schema.moduleResourceVersions).set({ publishedBy: NULL }).where(eq(schema.moduleResourceVersions.publishedBy, id))
    await tx.update(schema.aiModelCalls).set({ ownerUserId: NULL }).where(eq(schema.aiModelCalls.ownerUserId, id))

    // === 3. 级联删除 CASCADE 从表 ===
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id))
    await tx.delete(schema.invitations).where(eq(schema.invitations.userId, id))
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, id))
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, id))
    await tx.delete(schema.userConsents).where(eq(schema.userConsents.userId, id))
    await tx.delete(schema.departmentMembers).where(eq(schema.departmentMembers.userId, id))

    // === 4. 删除用户 ===
    await tx.delete(schema.users).where(eq(schema.users.id, id))
  })

  await writeAudit(event, {
    schoolId, actorId: actor.id, action: 'school_admin.user.delete',
    targetType: 'user', targetId: id,
    metadata: { name: target.name, email: target.email, role: target.role, status: target.status, delegatedGrantId }
  })
  return { ok: true }
})

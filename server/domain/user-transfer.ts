/**
 * 账号业务责任链的移交（教师 / 心理专员账号「换角色」或「停用」共用同一份逻辑）。
 *
 * 背景：班级、学生、家长、沟通、方案、量表作答、学生事件、AI 会话等业务记录都靠
 * `owner_user_id` 挂在具体教师名下，而「谁能看、谁能改」由「激活角色 + 负责人是不是我」
 * 共同决定。账号一旦不再持有教师/心理专员角色，这些记录就会失去可维护的负责人
 * （看板角色按设计不读写业务正文），因此换角色或停用前必须先把责任链移交给接收教师。
 *
 * 约定：
 * - 移交必须在调用方的事务里执行（调用方负责审计与状态变更，本模块只搬归属与写移交留痕）；
 * - 归属搬移后写 `record_assignments`（from/to/assignedBy/reason），保证可追溯；
 * - 会话与安全事件同步移交，但审计操作者（audit_logs.actor_id）保持不变。
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'
import { writeRecordAssignment } from './record-assignments'

type Db = ReturnType<typeof useDb>

export interface TransferBusinessDataInput {
  schoolId: string
  fromUserId: string
  toUserId: string
  /** 操作者（学校管理员 / 平台管理员），写入 record_assignments.assigned_by 与审计 */
  actorId: string
  /** 移交事由，写入移交留痕 */
  reason: string
  /** 存在未完成心理转介时，指定新的心理专员 */
  newPsychologistId?: string | null
}

export interface TransferBusinessDataResult {
  classes: number
  students: number
  guardians: number
  communications: number
  plans: number
}

/**
 * 该账号是否仍持有业务数据归属（班级/学生/家长/沟通/方案/量表作答/学生事件/AI 会话/安全事件）。
 * 用于判断「换角色或停用前是否必须移交」，一次查询用 EXISTS 短路。
 */
export async function userOwnsBusinessData(db: Db, schoolId: string, userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    select (
      exists(select 1 from classes where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from students where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from guardians where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from communications where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from plans where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from assessment_attempts where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from student_events where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from chat_sessions where school_id = ${schoolId} and owner_user_id = ${userId})
      or exists(select 1 from safety_events where school_id = ${schoolId} and owner_user_id = ${userId})
    ) as owns
  `)
  const [row] = result.rows as Array<{ owns: boolean }>
  return Boolean(row?.owns)
}

/** 未完成的心理转介（created / acknowledged / offline_handling / escalated）。 */
export const OPEN_REFERRAL_STATUSES = ['created', 'acknowledged', 'offline_handling', 'escalated'] as const

export async function userHasOpenReferrals(db: Db, schoolId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.referrals.id }).from(schema.referrals).where(and(
    eq(schema.referrals.psychologistId, userId),
    eq(schema.referrals.schoolId, schoolId),
    inArray(schema.referrals.status, [...OPEN_REFERRAL_STATUSES])
  )).limit(1)
  return Boolean(row)
}

/**
 * 把 fromUserId 的业务责任链整体移交给 toUserId（必须在调用方的事务里执行）。
 * 只搬归属与写移交留痕，不改账号状态、不写审计——那些由调用方负责。
 */
export async function transferUserBusinessData(tx: Db, input: TransferBusinessDataInput): Promise<TransferBusinessDataResult> {
  const { schoolId, fromUserId, toUserId, actorId, reason } = input
  const now = new Date()
  const result: TransferBusinessDataResult = { classes: 0, students: 0, guardians: 0, communications: 0, plans: 0 }

  // 1. 班级
  const userClasses = await tx.select({ id: schema.classes.id }).from(schema.classes)
    .where(and(eq(schema.classes.schoolId, schoolId), eq(schema.classes.ownerUserId, fromUserId)))
  if (userClasses.length > 0) {
    await tx.update(schema.classes).set({ ownerUserId: toUserId, updatedAt: now })
      .where(and(eq(schema.classes.schoolId, schoolId), eq(schema.classes.ownerUserId, fromUserId)))
    for (const row of userClasses) {
      await writeRecordAssignment(tx, { schoolId, targetType: 'class', targetId: row.id, fromUserId, toUserId, assignedBy: actorId, reason })
    }
    result.classes = userClasses.length
  }

  // 2. 学生
  const userStudents = await tx.select({ id: schema.students.id }).from(schema.students)
    .where(and(eq(schema.students.schoolId, schoolId), eq(schema.students.ownerUserId, fromUserId)))
  if (userStudents.length > 0) {
    await tx.update(schema.students).set({ ownerUserId: toUserId, updatedAt: now })
      .where(and(eq(schema.students.schoolId, schoolId), eq(schema.students.ownerUserId, fromUserId)))
    for (const row of userStudents) {
      await writeRecordAssignment(tx, { schoolId, targetType: 'student', targetId: row.id, fromUserId, toUserId, assignedBy: actorId, reason })
    }
    result.students = userStudents.length
  }

  // 3. 家长
  const userGuardians = await tx.select({ id: schema.guardians.id }).from(schema.guardians)
    .where(and(eq(schema.guardians.schoolId, schoolId), eq(schema.guardians.ownerUserId, fromUserId)))
  if (userGuardians.length > 0) {
    await tx.update(schema.guardians).set({ ownerUserId: toUserId, updatedAt: now })
      .where(and(eq(schema.guardians.schoolId, schoolId), eq(schema.guardians.ownerUserId, fromUserId)))
    for (const row of userGuardians) {
      await writeRecordAssignment(tx, { schoolId, targetType: 'guardian', targetId: row.id, fromUserId, toUserId, assignedBy: actorId, reason })
    }
    result.guardians = userGuardians.length
  }

  // 4. 沟通记录
  const userCommunications = await tx.select({ id: schema.communications.id }).from(schema.communications)
    .where(and(eq(schema.communications.schoolId, schoolId), eq(schema.communications.ownerUserId, fromUserId)))
  if (userCommunications.length > 0) {
    await tx.update(schema.communications).set({ ownerUserId: toUserId, updatedAt: now })
      .where(and(eq(schema.communications.schoolId, schoolId), eq(schema.communications.ownerUserId, fromUserId)))
    for (const row of userCommunications) {
      await writeRecordAssignment(tx, { schoolId, targetType: 'communication', targetId: row.id, fromUserId, toUserId, assignedBy: actorId, reason })
    }
    result.communications = userCommunications.length
  }

  // 5. 方案
  const userPlans = await tx.select({ id: schema.plans.id }).from(schema.plans)
    .where(and(eq(schema.plans.schoolId, schoolId), eq(schema.plans.ownerUserId, fromUserId)))
  if (userPlans.length > 0) {
    await tx.update(schema.plans).set({ ownerUserId: toUserId, updatedAt: now })
      .where(and(eq(schema.plans.schoolId, schoolId), eq(schema.plans.ownerUserId, fromUserId)))
    for (const row of userPlans) {
      await writeRecordAssignment(tx, { schoolId, targetType: 'plan', targetId: row.id, fromUserId, toUserId, assignedBy: actorId, reason })
    }
    result.plans = userPlans.length
  }

  // 6. 量表作答、学生事件与方案完整责任链（不逐条写移交留痕，避免批量写放大）
  await tx.update(schema.assessmentAttempts).set({ ownerUserId: toUserId, updatedAt: now })
    .where(and(eq(schema.assessmentAttempts.schoolId, schoolId), eq(schema.assessmentAttempts.ownerUserId, fromUserId)))
  await tx.update(schema.studentEvents).set({ ownerUserId: toUserId, updatedAt: now })
    .where(and(eq(schema.studentEvents.schoolId, schoolId), eq(schema.studentEvents.ownerUserId, fromUserId)))
  await tx.update(schema.planActions).set({ ownerUserId: toUserId, updatedAt: now })
    .where(and(eq(schema.planActions.schoolId, schoolId), eq(schema.planActions.ownerUserId, fromUserId)))
  await tx.update(schema.planReviews).set({ ownerUserId: toUserId })
    .where(and(eq(schema.planReviews.schoolId, schoolId), eq(schema.planReviews.ownerUserId, fromUserId)))
  await tx.update(schema.planFeedback).set({ ownerUserId: toUserId })
    .where(and(eq(schema.planFeedback.schoolId, schoolId), eq(schema.planFeedback.ownerUserId, fromUserId)))
  await tx.update(schema.planOperationEvents).set({ ownerUserId: toUserId })
    .where(and(eq(schema.planOperationEvents.schoolId, schoolId), eq(schema.planOperationEvents.ownerUserId, fromUserId)))

  // 7. AI 会话与危机责任（审计操作者保持不变）
  await tx.update(schema.chatSessions).set({ ownerUserId: toUserId, updatedAt: now })
    .where(and(eq(schema.chatSessions.schoolId, schoolId), eq(schema.chatSessions.ownerUserId, fromUserId)))
  await tx.update(schema.chatMessages).set({ ownerUserId: toUserId })
    .where(and(eq(schema.chatMessages.schoolId, schoolId), eq(schema.chatMessages.ownerUserId, fromUserId)))
  await tx.update(schema.routingDecisions).set({ ownerUserId: toUserId })
    .where(and(eq(schema.routingDecisions.schoolId, schoolId), eq(schema.routingDecisions.ownerUserId, fromUserId)))
  await tx.update(schema.safetyEvents).set({ ownerUserId: toUserId, updatedAt: now })
    .where(and(eq(schema.safetyEvents.schoolId, schoolId), eq(schema.safetyEvents.ownerUserId, fromUserId)))
  // 未读通知跟着人走，避免原账号停用后通知变成死信
  await tx.update(schema.notifications).set({ userId: toUserId })
    .where(and(
      eq(schema.notifications.schoolId, schoolId),
      eq(schema.notifications.userId, fromUserId),
      isNull(schema.notifications.readAt)
    ))

  // 8. 未完成心理转介（指定了新专员时）
  if (input.newPsychologistId) {
    await tx.update(schema.referrals).set({ psychologistId: input.newPsychologistId, updatedAt: now })
      .where(and(
        eq(schema.referrals.psychologistId, fromUserId),
        eq(schema.referrals.schoolId, schoolId),
        inArray(schema.referrals.status, [...OPEN_REFERRAL_STATUSES])
      ))
  }

  return result
}

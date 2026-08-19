import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { requireSchoolManagement } from '../../../../domain/school-management'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'], { allowPlatformAdmin: true })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  // 只允许删除从未激活且没有业务关联的邀请账号
  if (target.status !== 'invited' || target.activatedAt || target.lastLoginAt) {
    throw createError({ statusCode: 409, message: '该账号已激活，无法直接删除。请先停用该账号或执行业务移交。' })
  }

  // 检查是否有任何业务数据引用
  type Database = ReturnType<typeof useDb>
  const checks: Array<{ table: string; fn: (database: Database) => Promise<number> }> = [
    { table: 'classes', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.classes).where(eq(schema.classes.ownerUserId, id)))[0]!.c },
    { table: 'students', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.students).where(eq(schema.students.ownerUserId, id)))[0]!.c },
    { table: 'guardians', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.guardians).where(eq(schema.guardians.ownerUserId, id)))[0]!.c },
    { table: 'communications', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.communications).where(eq(schema.communications.ownerUserId, id)))[0]!.c },
    { table: 'plans', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.plans).where(eq(schema.plans.ownerUserId, id)))[0]!.c },
    { table: 'assessments', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, id)))[0]!.c },
    { table: 'studentEvents', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.studentEvents).where(eq(schema.studentEvents.ownerUserId, id)))[0]!.c },
    { table: 'safetyEvents', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.safetyEvents).where(eq(schema.safetyEvents.ownerUserId, id)))[0]!.c },
    { table: 'auditLogs', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.auditLogs).where(eq(schema.auditLogs.actorId, id)))[0]!.c },
    { table: 'adminAccessRequests', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.adminAccessRequests).where(eq(schema.adminAccessRequests.requesterId, id)))[0]!.c },
    { table: 'adminAccessEvents', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.adminAccessEvents).where(eq(schema.adminAccessEvents.actorId, id)))[0]!.c },
    { table: 'recordAssignments', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.recordAssignments).where(eq(schema.recordAssignments.toUserId, id)))[0]!.c },
    { table: 'invitations', fn: async database => (await database.select({ c: sql<number>`count(*)::int` }).from(schema.invitations).where(eq(schema.invitations.invitedBy, id)))[0]!.c },
  ]

  for (const check of checks) {
    const count = await check.fn(db)
    if (count > 0) {
      throw createError({
        statusCode: 409,
        message: `该账号存在 ${check.table} 关联数据（${count} 条），无法直接删除。请执行业务移交并停用账号。`
      })
    }
  }

  // 在事务内再次检查引用后删除
  await db.transaction(async (tx) => {
    // 二次确认：再次检查所有引用
    for (const check of checks) {
      const count = await check.fn(tx as Database)
      if (count > 0) {
        throw new Error(`二次检查失败：${check.table} 存在 ${count} 条引用`)
      }
    }
    // 清除关联数据（仅限无业务引用的邀请账号）
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id))
    await tx.delete(schema.invitations).where(eq(schema.invitations.userId, id))
    await tx.delete(schema.departmentMembers).where(eq(schema.departmentMembers.userId, id))
    // 删除用户
    const [deleted] = await tx.delete(schema.users).where(and(
      eq(schema.users.id, id),
      eq(schema.users.schoolId, schoolId),
      eq(schema.users.status, 'invited'),
    )).returning({ id: schema.users.id })
    if (!deleted) throw createError({ statusCode: 409, message: '邀请账号状态已变化，请刷新后重试' })
    await writeAudit(event, {
      schoolId, actorId: actor.id, action: 'school_admin.user.delete_invitation',
      targetType: 'user', targetId: id,
      metadata: { name: target.name, phone: target.phone, role: target.role, delegatedGrantId }
    }, tx)
  })
  return { ok: true }
})

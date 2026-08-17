import type { H3Event } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../utils/auth'
import { schema, useDb } from '../utils/db'

export async function requireSchoolManagement(event: H3Event, _scopes: string[], opts?: { allowPlatformAdmin?: boolean }) {
  const user = await requireUser(event, ['school_admin', 'platform_admin'])
  if (user.role === 'school_admin') {
    if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
    return { actor: user, schoolId: user.schoolId, delegatedGrantId: null as string | null }
  }
  if (!opts?.allowPlatformAdmin) {
    throw createError({ statusCode: 403, message: '仅学校管理员可管理该数据' })
  }
  const parsed = z.string().uuid().safeParse(getQuery(event).schoolId)
  if (!parsed.success) throw createError({ statusCode: 400, message: '平台管理员必须通过 schoolId 指定目标学校' })
  const [school] = await useDb(event).select({ id: schema.schools.id }).from(schema.schools)
    .where(eq(schema.schools.id, parsed.data)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  return { actor: user, schoolId: parsed.data, delegatedGrantId: null as string | null }
}

export async function assertActiveTeacher(event: H3Event, schoolId: string, teacherId: string) {
  const [teacher] = await useDb(event).select({ id: schema.users.id }).from(schema.users).where(and(
    eq(schema.users.id, teacherId),
    eq(schema.users.schoolId, schoolId),
    eq(schema.users.role, 'teacher'),
    eq(schema.users.status, 'active')
  )).limit(1)
  if (!teacher) throw createError({ statusCode: 422, message: '目标教师不存在或不可用' })
  return teacher
}

export async function assertActiveDepartment(event: H3Event, schoolId: string, departmentId?: string | null) {
  if (!departmentId) return null
  const [department] = await useDb(event).select({ id: schema.departments.id }).from(schema.departments).where(and(
    eq(schema.departments.id, departmentId),
    eq(schema.departments.schoolId, schoolId),
    eq(schema.departments.status, 'active')
  )).limit(1)
  if (!department) throw createError({ statusCode: 422, message: '目标部门不存在或不可用' })
  return department
}

export async function resolveClassOwner(event: H3Event, schoolId: string, classId?: string | null, fallbackOwnerUserId?: string) {
  if (!classId) {
    if (!fallbackOwnerUserId) throw createError({ statusCode: 422, message: '未分班学生必须选择负责教师' })
    await assertActiveTeacher(event, schoolId, fallbackOwnerUserId)
    return { classId: null, ownerUserId: fallbackOwnerUserId }
  }
  const [klass] = await useDb(event).select({ id: schema.classes.id, ownerUserId: schema.classes.ownerUserId, status: schema.classes.status })
    .from(schema.classes).where(and(eq(schema.classes.id, classId), eq(schema.classes.schoolId, schoolId))).limit(1)
  if (!klass || klass.status !== 'active') throw createError({ statusCode: 422, message: '目标班级不存在或不可用' })
  if (fallbackOwnerUserId) await assertActiveTeacher(event, schoolId, fallbackOwnerUserId)
  return { classId: klass.id, ownerUserId: fallbackOwnerUserId || klass.ownerUserId }
}

export function offsetFrom(page: number, pageSize: number) {
  return (page - 1) * pageSize
}

export async function writeAssignment(
  db: ReturnType<typeof useDb>,
  input: {
    schoolId: string
    targetType: 'class' | 'student' | 'guardian' | 'communication' | 'plan'
    targetId: string
    fromUserId?: string | null
    toUserId: string
    assignedBy: string
    reason?: string
    metadata?: Record<string, unknown>
  }
) {
  await db.insert(schema.recordAssignments).values({
    schoolId: input.schoolId,
    targetType: input.targetType,
    targetId: input.targetId,
    fromUserId: input.fromUserId || null,
    toUserId: input.toUserId,
    assignedBy: input.assignedBy,
    reason: input.reason,
    metadata: input.metadata || {}
  })
}

export async function transferPlans(db: ReturnType<typeof useDb>, schoolId: string, toUserId: string, where: ReturnType<typeof eq>) {
  const plans = await db.update(schema.plans).set({ ownerUserId: toUserId, updatedAt: new Date() })
    .where(and(eq(schema.plans.schoolId, schoolId), where)).returning({ id: schema.plans.id })
  const planIds = plans.map(item => item.id)
  if (!planIds.length) return 0
  const actions = await db.update(schema.planActions).set({ ownerUserId: toUserId, updatedAt: new Date() })
    .where(inArray(schema.planActions.planId, planIds)).returning({ id: schema.planActions.id })
  await db.update(schema.notifications).set({ userId: toUserId }).where(and(
    eq(schema.notifications.targetType, 'plan'), inArray(schema.notifications.targetId, planIds)
  ))
  const actionIds = actions.map(item => item.id)
  if (actionIds.length) {
    await db.update(schema.notifications).set({ userId: toUserId }).where(and(
      eq(schema.notifications.targetType, 'plan_action'), inArray(schema.notifications.targetId, actionIds)
    ))
  }
  return planIds.length
}

export async function transferClassOwner(
  db: ReturnType<typeof useDb>,
  input: { schoolId: string, classId: string, fromUserId: string, toUserId: string, assignedBy: string, reason?: string }
) {
  await db.update(schema.classes).set({ ownerUserId: input.toUserId, updatedAt: new Date() }).where(and(
    eq(schema.classes.id, input.classId),
    eq(schema.classes.schoolId, input.schoolId),
    eq(schema.classes.ownerUserId, input.fromUserId),
  ))
  const students = await db.update(schema.students).set({ ownerUserId: input.toUserId, updatedAt: new Date() }).where(and(
    eq(schema.students.classId, input.classId),
    eq(schema.students.schoolId, input.schoolId)
  )).returning({ id: schema.students.id })
  await transferPlans(db, input.schoolId, input.toUserId, eq(schema.plans.classId, input.classId))
  const studentIds = students.map(student => student.id)
  let guardianIds: string[] = []
  if (studentIds.length) {
    await db.update(schema.communications).set({ ownerUserId: input.toUserId, updatedAt: new Date() }).where(and(
      inArray(schema.communications.studentId, studentIds),
      eq(schema.communications.schoolId, input.schoolId)
    ))
    const relations = await db.select().from(schema.studentGuardians).where(inArray(schema.studentGuardians.studentId, studentIds))
    guardianIds = [...new Set(relations.map(relation => relation.guardianId))]
    if (guardianIds.length) {
      await db.update(schema.guardians).set({ ownerUserId: input.toUserId, updatedAt: new Date() }).where(and(
        inArray(schema.guardians.id, guardianIds),
        eq(schema.guardians.schoolId, input.schoolId)
      ))
      await db.update(schema.communications).set({ ownerUserId: input.toUserId, updatedAt: new Date() }).where(and(
        inArray(schema.communications.guardianId, guardianIds),
        eq(schema.communications.schoolId, input.schoolId)
      ))
    }
  }
  await writeAssignment(db, {
    schoolId: input.schoolId,
    targetType: 'class',
    targetId: input.classId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    assignedBy: input.assignedBy,
    reason: input.reason,
    metadata: { cascadedStudents: studentIds.length, cascadedGuardians: guardianIds.length }
  })
}

export const countSql = sql<number>`count(*)::int`

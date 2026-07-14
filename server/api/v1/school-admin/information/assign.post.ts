import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({
  targetType: z.enum(['class', 'student', 'guardian', 'communication', 'plan']),
  targetId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  reason: z.string().trim().max(500).optional()
})

async function writeAssignment(
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

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const schoolId = admin.schoolId!
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [teacher] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
    eq(schema.users.id, body.ownerUserId),
    eq(schema.users.schoolId, schoolId),
    eq(schema.users.role, 'teacher'),
    eq(schema.users.status, 'active')
  )).limit(1)
  if (!teacher) throw createError({ statusCode: 422, message: '目标教师不存在或不可用' })

  if (body.targetType === 'class') {
    const [before] = await db.select({ id: schema.classes.id, ownerUserId: schema.classes.ownerUserId }).from(schema.classes).where(and(
      eq(schema.classes.id, body.targetId),
      eq(schema.classes.schoolId, schoolId)
    )).limit(1)
    if (!before) throw createError({ statusCode: 404, message: '班级不存在' })
    await db.update(schema.classes).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(eq(schema.classes.id, body.targetId))
    const students = await db.update(schema.students).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(
      eq(schema.students.classId, body.targetId),
      eq(schema.students.schoolId, schoolId)
    )).returning({ id: schema.students.id })
    const studentIds = students.map(student => student.id)
    if (studentIds.length) {
      await db.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(
        inArray(schema.communications.studentId, studentIds),
        eq(schema.communications.schoolId, schoolId)
      ))
      const relations = await db.select().from(schema.studentGuardians).where(inArray(schema.studentGuardians.studentId, studentIds))
      const guardianIds = [...new Set(relations.map(relation => relation.guardianId))]
      if (guardianIds.length) {
        await db.update(schema.guardians).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(
          inArray(schema.guardians.id, guardianIds),
          eq(schema.guardians.schoolId, schoolId)
        ))
        await db.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(
          inArray(schema.communications.guardianId, guardianIds),
          eq(schema.communications.schoolId, schoolId)
        ))
      }
      await writeAssignment(db, {
        schoolId,
        targetType: 'class',
        targetId: body.targetId,
        fromUserId: before.ownerUserId,
        toUserId: body.ownerUserId,
        assignedBy: admin.id,
        reason: body.reason,
        metadata: { cascadedStudents: studentIds.length, cascadedGuardians: guardianIds.length }
      })
    } else {
      await writeAssignment(db, {
        schoolId,
        targetType: 'class',
        targetId: body.targetId,
        fromUserId: before.ownerUserId,
        toUserId: body.ownerUserId,
        assignedBy: admin.id,
        reason: body.reason,
        metadata: { cascadedStudents: 0, cascadedGuardians: 0 }
      })
    }
  } else if (body.targetType === 'student') {
    const [student] = await db.select({ id: schema.students.id, ownerUserId: schema.students.ownerUserId }).from(schema.students).where(and(
      eq(schema.students.id, body.targetId),
      eq(schema.students.schoolId, schoolId)
    )).limit(1)
    if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
    await db.update(schema.students).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(eq(schema.students.id, body.targetId))
    await db.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.studentId, body.targetId), eq(schema.communications.schoolId, schoolId)))
    await writeAssignment(db, {
      schoolId,
      targetType: 'student',
      targetId: body.targetId,
      fromUserId: student.ownerUserId,
      toUserId: body.ownerUserId,
      assignedBy: admin.id,
      reason: body.reason,
      metadata: { cascadedCommunications: true }
    })
  } else if (body.targetType === 'guardian') {
    const [guardian] = await db.select({ id: schema.guardians.id, ownerUserId: schema.guardians.ownerUserId }).from(schema.guardians).where(and(
      eq(schema.guardians.id, body.targetId),
      eq(schema.guardians.schoolId, schoolId)
    )).limit(1)
    if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
    await db.update(schema.guardians).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(eq(schema.guardians.id, body.targetId))
    await db.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.guardianId, body.targetId), eq(schema.communications.schoolId, schoolId)))
    await writeAssignment(db, {
      schoolId,
      targetType: 'guardian',
      targetId: body.targetId,
      fromUserId: guardian.ownerUserId,
      toUserId: body.ownerUserId,
      assignedBy: admin.id,
      reason: body.reason,
      metadata: { cascadedCommunications: true }
    })
  } else if (body.targetType === 'communication') {
    const [communication] = await db.select({ id: schema.communications.id, ownerUserId: schema.communications.ownerUserId }).from(schema.communications).where(and(
      eq(schema.communications.id, body.targetId),
      eq(schema.communications.schoolId, schoolId)
    )).limit(1)
    if (!communication) throw createError({ statusCode: 404, message: '沟通记录不存在' })
    await db.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(eq(schema.communications.id, body.targetId))
    await writeAssignment(db, {
      schoolId,
      targetType: 'communication',
      targetId: body.targetId,
      fromUserId: communication.ownerUserId,
      toUserId: body.ownerUserId,
      assignedBy: admin.id,
      reason: body.reason
    })
  } else {
    const [plan] = await db.select({ id: schema.plans.id, ownerUserId: schema.plans.ownerUserId }).from(schema.plans).where(and(
      eq(schema.plans.id, body.targetId),
      eq(schema.plans.schoolId, schoolId)
    )).limit(1)
    if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
    await db.update(schema.plans).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(eq(schema.plans.id, body.targetId))
    await writeAssignment(db, {
      schoolId,
      targetType: 'plan',
      targetId: body.targetId,
      fromUserId: plan.ownerUserId,
      toUserId: body.ownerUserId,
      assignedBy: admin.id,
      reason: body.reason
    })
  }

  await writeAudit(event, {
    schoolId,
    actorId: admin.id,
    action: 'school_admin.information.assign',
    targetType: body.targetType,
    targetId: body.targetId,
    metadata: { currentResponsibleUserId: body.ownerUserId, reason: body.reason }
  })
  return { ok: true }
})

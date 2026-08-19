import type { H3Event } from 'h3'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { AuthUser } from '../../app/composables/useAuth'
import { decryptSensitive } from '../utils/crypto'
import { schema, useDb } from '../utils/db'

export type AssistantContextType = 'student' | 'class' | 'guardian'

export interface AssistantBusinessContext {
  type: AssistantContextType
  id: string
  label: string
  snapshot: Record<string, unknown>
  prompt: string
}

function maskPhone(value: string) {
  if (!value) return ''
  return value.length >= 4 ? `****${value.slice(-4)}` : '已填写'
}

function safeJsonParse(value: string) {
  if (!value) return {}
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

function compact(value: unknown) {
  return JSON.stringify(value, null, 2).slice(0, 6000)
}

// 导出供测试使用
export { maskPhone, safeJsonParse, compact }

async function appendPlanReviews(event: H3Event, plans: Array<typeof schema.plans.$inferSelect>) {
  const db = useDb(event)
  const planIds = plans.map(plan => plan.id)
  if (!planIds.length) return new Map<string, Array<typeof schema.planReviews.$inferSelect>>()
  const reviews = await db.select().from(schema.planReviews)
    .where(inArray(schema.planReviews.planId, planIds))
    .orderBy(desc(schema.planReviews.reviewAt))
    .limit(30)
  const byPlan = new Map<string, Array<typeof schema.planReviews.$inferSelect>>()
  for (const review of reviews) byPlan.set(review.planId, [...(byPlan.get(review.planId) || []), review])
  return byPlan
}

export async function buildAssistantBusinessContext(event: H3Event, user: AuthUser, contextType?: string, contextId?: string): Promise<AssistantBusinessContext | null> {
  if (!contextType || !contextId) return null
  if (contextType !== 'student' && contextType !== 'class' && contextType !== 'guardian') {
    throw createError({ statusCode: 422, message: '不支持的咨询对象类型' })
  }
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  if (contextType === 'student') {
    const [student] = await db.select().from(schema.students).where(and(
      eq(schema.students.id, contextId),
      eq(schema.students.ownerUserId, user.id),
      eq(schema.students.schoolId, user.schoolId)
    )).limit(1)
    if (!student) throw createError({ statusCode: 404, message: '学生不存在或不属于当前负责范围' })
    const [klass, relations, communications, plans] = await Promise.all([
      student.classId ? db.select().from(schema.classes).where(and(eq(schema.classes.id, student.classId), eq(schema.classes.schoolId, user.schoolId))).limit(1) : Promise.resolve([]),
      db.select().from(schema.studentGuardians).where(eq(schema.studentGuardians.studentId, student.id)),
      db.select().from(schema.communications).where(and(eq(schema.communications.studentId, student.id), eq(schema.communications.schoolId, user.schoolId))).orderBy(desc(schema.communications.occurredAt)).limit(10),
      db.select().from(schema.plans).where(and(eq(schema.plans.studentId, student.id), eq(schema.plans.schoolId, user.schoolId), eq(schema.plans.ownerUserId, user.id))).orderBy(desc(schema.plans.updatedAt)).limit(10)
    ])
    const guardianIds = relations.map(row => row.guardianId)
    const guardians = guardianIds.length ? await db.select().from(schema.guardians).where(and(inArray(schema.guardians.id, guardianIds), eq(schema.guardians.schoolId, user.schoolId))) : []
    const guardianById = new Map(guardians.map(row => [row.id, row]))
    const reviewsByPlan = await appendPlanReviews(event, plans)
    const snapshot = {
      object: 'student',
      student: {
        id: student.id,
        name: decryptSensitive(student.nameEnc, secret),
        gender: student.gender,
        profile: safeJsonParse(decryptSensitive(student.profileEnc, secret)),
        notes: decryptSensitive(student.notesEnc, secret),
        className: klass[0]?.name || null
      },
      class: klass[0] ? { id: klass[0].id, name: klass[0].name, grade: klass[0].grade, studentCount: klass[0].studentCount } : null,
      guardians: guardians.map(row => ({
        id: row.id,
        name: decryptSensitive(row.nameEnc, secret),
        relation: row.relation,
        phoneMasked: maskPhone(decryptSensitive(row.phoneEnc, secret))
      })),
      recentCommunications: communications.map(row => {
        const guardian = row.guardianId ? guardianById.get(row.guardianId) : null
        return {
          occurredAt: row.occurredAt,
          guardianRelation: guardian?.relation || null,
          guardianName: guardian ? decryptSensitive(guardian.nameEnc, secret) : null,
          parentType: row.parentType,
          attitudeType: row.attitudeType,
          riskLevel: row.riskLevel,
          summary: decryptSensitive(row.summaryEnc, secret)
        }
      }),
      recentPlans: plans.map(row => ({
        id: row.id,
        module: row.module,
        title: row.title,
        summary: decryptSensitive(row.summaryEnc, secret),
        status: row.status,
        updatedAt: row.updatedAt,
        actions: (row.actions as Array<{ title: string; detail: string; status: string }> || []).map(a => ({
          title: a.title,
          status: a.status
        })),
        reviews: (reviewsByPlan.get(row.id) || []).slice(0, 3).map(review => ({
          reviewAt: review.reviewAt,
          effectScore: review.effectScore,
          progressNote: review.progressNote,
          nextAction: review.nextAction
        }))
      }))
    }
    const label = String((snapshot.student as any).name || '学生')
    return { type: 'student', id: student.id, label, snapshot, prompt: compact(snapshot) }
  }

  if (contextType === 'class') {
    const [klass] = await db.select().from(schema.classes).where(and(
      eq(schema.classes.id, contextId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.schoolId, user.schoolId)
    )).limit(1)
    if (!klass) throw createError({ statusCode: 404, message: '班级不存在或不属于当前负责范围' })
    const students = await db.select().from(schema.students).where(and(eq(schema.students.classId, klass.id), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId))).orderBy(desc(schema.students.updatedAt)).limit(50)
    const studentIds = students.map(row => row.id)
    const [relations, communications, plans] = await Promise.all([
      studentIds.length ? db.select().from(schema.studentGuardians).where(inArray(schema.studentGuardians.studentId, studentIds)) : Promise.resolve([]),
      studentIds.length ? db.select().from(schema.communications).where(and(inArray(schema.communications.studentId, studentIds), eq(schema.communications.schoolId, user.schoolId))).orderBy(desc(schema.communications.occurredAt)).limit(10) : Promise.resolve([]),
      db.select().from(schema.plans).where(and(eq(schema.plans.classId, klass.id), eq(schema.plans.schoolId, user.schoolId), eq(schema.plans.ownerUserId, user.id))).orderBy(desc(schema.plans.updatedAt)).limit(10)
    ])
    const guardianIds = [...new Set(relations.map(row => row.guardianId))]
    const guardians = guardianIds.length ? await db.select().from(schema.guardians).where(and(inArray(schema.guardians.id, guardianIds), eq(schema.guardians.schoolId, user.schoolId))) : []
    const guardianById = new Map(guardians.map(row => [row.id, row]))
    const studentById = new Map(students.map(row => [row.id, row]))
    const snapshot = {
      object: 'class',
      class: { id: klass.id, name: klass.name, grade: klass.grade, studentCount: klass.studentCount },
      students: students.slice(0, 30).map(row => ({
        id: row.id,
        name: decryptSensitive(row.nameEnc, secret),
        gender: row.gender,
        notes: decryptSensitive(row.notesEnc, secret)
      })),
      guardians: guardians.slice(0, 30).map(row => ({ id: row.id, name: decryptSensitive(row.nameEnc, secret), relation: row.relation })),
      recentCommunications: communications.map(row => {
        const student = row.studentId ? studentById.get(row.studentId) : null
        const guardian = row.guardianId ? guardianById.get(row.guardianId) : null
        return {
          occurredAt: row.occurredAt,
          studentName: student ? decryptSensitive(student.nameEnc, secret) : null,
          guardianRelation: guardian?.relation || null,
          riskLevel: row.riskLevel,
          summary: decryptSensitive(row.summaryEnc, secret)
        }
      }),
      recentPlans: plans.map(row => ({ id: row.id, module: row.module, title: row.title, summary: decryptSensitive(row.summaryEnc, secret), updatedAt: row.updatedAt, status: row.status, actions: (row.actions as Array<{ title: string; detail: string; status: string }> || []).map(a => ({ title: a.title, status: a.status })) }))
    }
    return { type: 'class', id: klass.id, label: klass.name, snapshot, prompt: compact(snapshot) }
  }

  const [guardian] = await db.select().from(schema.guardians).where(and(
    eq(schema.guardians.id, contextId),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId)
  )).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在或不属于当前负责范围' })
  const [relations, communications, plans] = await Promise.all([
    db.select().from(schema.studentGuardians).where(eq(schema.studentGuardians.guardianId, guardian.id)),
    db.select().from(schema.communications).where(and(eq(schema.communications.guardianId, guardian.id), eq(schema.communications.schoolId, user.schoolId))).orderBy(desc(schema.communications.occurredAt)).limit(10),
    db.select().from(schema.plans).where(and(eq(schema.plans.guardianId, guardian.id), eq(schema.plans.schoolId, user.schoolId), eq(schema.plans.ownerUserId, user.id))).orderBy(desc(schema.plans.updatedAt)).limit(10)
  ])
  const studentIds = relations.map(row => row.studentId)
  const students = studentIds.length ? await db.select().from(schema.students).where(and(inArray(schema.students.id, studentIds), eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId))) : []
  const classIds = [...new Set(students.map(row => row.classId).filter(Boolean))] as string[]
  const classes = classIds.length ? await db.select().from(schema.classes).where(inArray(schema.classes.id, classIds)) : []
  const classById = new Map(classes.map(row => [row.id, row]))
  const studentById = new Map(students.map(row => [row.id, row]))
  const snapshot = {
    object: 'guardian',
    guardian: {
      id: guardian.id,
      name: decryptSensitive(guardian.nameEnc, secret),
      relation: guardian.relation,
      phoneMasked: maskPhone(decryptSensitive(guardian.phoneEnc, secret))
    },
    students: students.map(row => ({
      id: row.id,
      name: decryptSensitive(row.nameEnc, secret),
      gender: row.gender,
      className: row.classId ? classById.get(row.classId)?.name : null,
      notes: decryptSensitive(row.notesEnc, secret)
    })),
    recentCommunications: communications.map(row => {
      const student = row.studentId ? studentById.get(row.studentId) : null
      return {
        occurredAt: row.occurredAt,
        studentName: student ? decryptSensitive(student.nameEnc, secret) : null,
        parentType: row.parentType,
        attitudeType: row.attitudeType,
        riskLevel: row.riskLevel,
        summary: decryptSensitive(row.summaryEnc, secret)
      }
    }),
    recentPlans: plans.map(row => ({ id: row.id, module: row.module, title: row.title, summary: decryptSensitive(row.summaryEnc, secret), updatedAt: row.updatedAt }))
  }
  const label = `${decryptSensitive(guardian.nameEnc, secret)}${guardian.relation ? ` · ${guardian.relation}` : ''}`
  return { type: 'guardian', id: guardian.id, label, snapshot, prompt: compact(snapshot) }
}

export async function assertAssistantContext(event: H3Event, user: AuthUser, contextType?: string, contextId?: string) {
  return buildAssistantBusinessContext(event, user, contextType, contextId)
}

export async function listAssistantContextOptions(event: H3Event, user: AuthUser) {
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [classes, students, guardians, relations, communications] = await Promise.all([
    db.select().from(schema.classes).where(and(eq(schema.classes.ownerUserId, user.id), eq(schema.classes.schoolId, user.schoolId))).orderBy(desc(schema.classes.updatedAt)),
    db.select().from(schema.students).where(and(eq(schema.students.ownerUserId, user.id), eq(schema.students.schoolId, user.schoolId))).orderBy(desc(schema.students.updatedAt)),
    db.select().from(schema.guardians).where(and(eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId))).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.studentGuardians),
    db.select().from(schema.communications).where(and(eq(schema.communications.ownerUserId, user.id), eq(schema.communications.schoolId, user.schoolId))).orderBy(desc(schema.communications.occurredAt)).limit(200)
  ])
  const classById = new Map(classes.map(row => [row.id, row]))
  const communicationsByStudent = new Map<string, number>()
  const communicationsByGuardian = new Map<string, number>()
  const communicationsByClass = new Map<string, number>()
  const studentById = new Map(students.map(row => [row.id, row]))
  for (const item of communications) {
    if (item.studentId) communicationsByStudent.set(item.studentId, (communicationsByStudent.get(item.studentId) || 0) + 1)
    if (item.guardianId) communicationsByGuardian.set(item.guardianId, (communicationsByGuardian.get(item.guardianId) || 0) + 1)
    const student = item.studentId ? studentById.get(item.studentId) : null
    if (student?.classId) communicationsByClass.set(student.classId, (communicationsByClass.get(student.classId) || 0) + 1)
  }
  const guardianByStudent = new Map<string, number>()
  for (const relation of relations) guardianByStudent.set(relation.studentId, (guardianByStudent.get(relation.studentId) || 0) + 1)
  return {
    students: students.map(row => ({
      type: 'student' as const,
      id: row.id,
      label: decryptSensitive(row.nameEnc, secret),
      description: `${row.classId ? classById.get(row.classId)?.name || '未分班' : '未分班'} · 家长 ${guardianByStudent.get(row.id) || 0} · 沟通 ${communicationsByStudent.get(row.id) || 0}`,
      classId: row.classId,
      className: row.classId ? classById.get(row.classId)?.name : null,
      communicationCount: communicationsByStudent.get(row.id) || 0
    })),
    classes: classes.map(row => ({
      type: 'class' as const,
      id: row.id,
      label: row.name,
      description: `${row.grade} 年级 · ${students.filter(student => student.classId === row.id).length} 名当前负责学生 · 沟通 ${communicationsByClass.get(row.id) || 0}`,
      communicationCount: communicationsByClass.get(row.id) || 0
    })),
    guardians: guardians.map(row => ({
      type: 'guardian' as const,
      id: row.id,
      label: decryptSensitive(row.nameEnc, secret),
      description: `${row.relation || '关系未填'} · 沟通 ${communicationsByGuardian.get(row.id) || 0}`,
      relation: row.relation,
      communicationCount: communicationsByGuardian.get(row.id) || 0
    }))
  }
}

export async function fetchEntityMemory(
  event: H3Event,
  user: AuthUser,
  contextType: string,
  contextId: string,
  excludeSessionId?: string,
  limit = 15
): Promise<Array<{ role: 'user' | 'assistant'; content: string; createdAt: Date }>> {
  if (!user.schoolId) return []
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  // 1. 找到所有绑定到同一实体的会话
  const sessions = await db.select({ id: schema.chatSessions.id })
    .from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.contextType, contextType),
      eq(schema.chatSessions.contextId, contextId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId)
    ))
    .orderBy(desc(schema.chatSessions.updatedAt))
    .limit(20)

  const sessionIds = sessions
    .map(s => s.id)
    .filter(id => id !== excludeSessionId)

  if (!sessionIds.length) return []

  // 2. 从这些会话中拉取最近的 user/assistant 消息
  const messages = await db.select({
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    createdAt: schema.chatMessages.createdAt
  })
    .from(schema.chatMessages)
    .where(and(
      inArray(schema.chatMessages.sessionId, sessionIds),
      eq(schema.chatMessages.ownerUserId, user.id),
      // 管理员软删的消息不进入实体记忆
      isNull(schema.chatMessages.deletedAt)
    ))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit)

  // 3. 解密并按时间正序排列
  return messages.reverse().map(item => ({
    role: item.role as 'user' | 'assistant',
    content: decryptSensitive(item.contentEnc, secret),
    createdAt: item.createdAt
  }))
}

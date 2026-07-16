import { assessmentBadge } from '#shared/assessments'
import { desc, eq, inArray } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive } from '../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  const [classRows, studentRows, guardianRows, relationRows, communicationRows, planRows, attempts] = await Promise.all([
    db.select().from(schema.classes).where(eq(schema.classes.ownerUserId, user.id)).orderBy(desc(schema.classes.updatedAt)),
    db.select().from(schema.students).where(eq(schema.students.ownerUserId, user.id)).orderBy(desc(schema.students.updatedAt)),
    db.select().from(schema.guardians).where(eq(schema.guardians.ownerUserId, user.id)).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.studentGuardians),
    db.select().from(schema.communications).where(eq(schema.communications.ownerUserId, user.id)).orderBy(desc(schema.communications.occurredAt)).limit(50),
    db.select().from(schema.plans).where(eq(schema.plans.ownerUserId, user.id)).orderBy(desc(schema.plans.updatedAt)).limit(50),
    db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, user.id)).orderBy(desc(schema.assessmentAttempts.updatedAt)).limit(50)
  ])
  const planIds = planRows.map(plan => plan.id)
  const reviewRows = planIds.length
    ? await db.select().from(schema.planReviews).where(inArray(schema.planReviews.planId, planIds)).orderBy(desc(schema.planReviews.reviewAt)).limit(500)
    : []
  const reviewStats = new Map<string, { count: number, latestReviewAt: Date | null }>()
  for (const review of reviewRows) {
    const current = reviewStats.get(review.planId) || { count: 0, latestReviewAt: null }
    current.count++
    if (!current.latestReviewAt || review.reviewAt > current.latestReviewAt) current.latestReviewAt = review.reviewAt
    reviewStats.set(review.planId, current)
  }
  const classes = classRows
  const classById = new Map(classes.map(row => [row.id, row]))
  const baseStudents = studentRows.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, config.encryptionKey),
    notes: decryptSensitive(row.notesEnc, config.encryptionKey),
    className: row.classId ? classById.get(row.classId)?.name : null,
    nameEnc: undefined,
    notesEnc: undefined
  }))
  const baseStudentById = new Map(baseStudents.map(row => [row.id, row]))
  const baseGuardians = guardianRows.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, config.encryptionKey),
    phone: decryptSensitive(row.phoneEnc, config.encryptionKey),
    nameEnc: undefined,
    phoneEnc: undefined
  }))
  const baseGuardianById = new Map(baseGuardians.map(row => [row.id, row]))
  const communications = communicationRows.map(row => {
    const student = row.studentId ? baseStudentById.get(row.studentId) : null
    const guardian = row.guardianId ? baseGuardianById.get(row.guardianId) : null
    return {
      ...row,
      summary: decryptSensitive(row.summaryEnc, config.encryptionKey),
      classId: student?.classId || null,
      className: student?.className || null,
      studentName: student?.name || null,
      guardianName: guardian?.name || null,
      relation: guardian?.relation || null,
      summaryEnc: undefined
    }
  })
  const communicationsByStudentId = new Map<string, typeof communications>()
  const communicationsByGuardianId = new Map<string, typeof communications>()
  for (const item of communications) {
    if (item.studentId) communicationsByStudentId.set(item.studentId, [...(communicationsByStudentId.get(item.studentId) || []), item])
    if (item.guardianId) communicationsByGuardianId.set(item.guardianId, [...(communicationsByGuardianId.get(item.guardianId) || []), item])
  }
  const guardians = baseGuardians.map(row => {
    const linkedStudents = relationRows
      .filter(relation => relation.guardianId === row.id)
      .map(relation => baseStudentById.get(relation.studentId))
      .filter(Boolean)
      .map(student => ({ id: student!.id, name: student!.name, classId: student!.classId, className: student!.className }))
    const relatedCommunications = communicationsByGuardianId.get(row.id) || []
    return {
      ...row,
      linkedStudents,
      communicationCount: relatedCommunications.length,
      latestCommunication: relatedCommunications[0] || null
    }
  })
  const guardianById = new Map(guardians.map(row => [row.id, row]))
  const students = baseStudents.map(row => {
    const linkedGuardians = relationRows
      .filter(relation => relation.studentId === row.id)
      .map(relation => guardianById.get(relation.guardianId))
      .filter(Boolean)
      .map(guardian => ({ id: guardian!.id, name: guardian!.name, relation: guardian!.relation, phone: guardian!.phone }))
    const relatedCommunications = communicationsByStudentId.get(row.id) || []
    return {
      ...row,
      linkedGuardians,
      communicationCount: relatedCommunications.length,
      latestCommunication: relatedCommunications[0] || null
    }
  })
  const studentById = new Map(students.map(row => [row.id, row]))
  const classTree = classes.map(classRow => {
    const classStudents = students.filter(student => student.classId === classRow.id)
    const studentIds = new Set(classStudents.map(student => student.id))
    const guardianIds = new Set(relationRows.filter(relation => studentIds.has(relation.studentId)).map(relation => relation.guardianId))
    const classCommunications = communications.filter(item => item.studentId ? studentIds.has(item.studentId) : item.guardianId ? guardianIds.has(item.guardianId) : false)
    return {
      ...classRow,
      students: classStudents,
      guardians: guardians.filter(guardian => guardianIds.has(guardian.id)),
      communications: classCommunications,
      latestCommunication: classCommunications[0] || null
    }
  })
  const overviewCards = [
    { label: '负责班级', value: classes.length, hint: `${students.length} 名学生` },
    { label: '关联家长', value: guardians.length, hint: `${relationRows.length} 条学生-家长关系` },
    { label: '家校沟通', value: communications.length, hint: communications[0] ? `最近：${communications[0].studentName || communications[0].guardianName || '未关联对象'}` : '暂无沟通' },
    { label: '方案记录', value: planRows.length, hint: `${reviewRows.length} 条复盘` }
  ]
  return {
    ownershipNote: '班级、学生、家长、沟通和方案是学校业务档案；当前页面展示当前由你负责的记录。',
    overviewCards,
    classes: classRows,
    classTree,
    students,
    guardians,
    communications,
    plans: planRows.map(row => {
      const stats = reviewStats.get(row.id) || { count: 0, latestReviewAt: null }
      const report = row.report as any
      const student = row.studentId ? studentById.get(row.studentId) : null
      const guardian = row.guardianId ? guardianById.get(row.guardianId) : null
      const klass = row.classId ? classById.get(row.classId) : null
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, config.encryptionKey),
        summaryEnc: undefined,
        level: report?.risk?.level,
        riskLabel: report?.risk?.label,
        objectLabel: student?.name || guardian?.name || klass?.name || null,
        objectType: student ? 'student' : guardian ? 'guardian' : klass ? 'class' : null,
        reviewCount: stats.count,
        latestReviewAt: stats.latestReviewAt
      }
    }),
    assessments: attempts.map(attempt => {
      const plan = planRows.find(p => p.sourceAssessmentAttemptId === attempt.id)
      const result = attempt.result as any
      const badge = assessmentBadge(result?.level)
      return { ...attempt, planId: plan?.id || null, levelLabel: badge?.label || null, levelColor: badge?.color || null }
    }),
    // 支持案例：合并 plan + assessment + action进度 + review统计
    cases: (() => {
      const planIdToAssessment = new Map<string, (typeof attempts)[number]>()
      for (const attempt of attempts) {
        const linkedPlan = planRows.find(p => p.sourceAssessmentAttemptId === attempt.id)
        if (linkedPlan) planIdToAssessment.set(linkedPlan.id, attempt)
      }
      const casesFromPlans = planRows.map(plan => {
        const stats = reviewStats.get(plan.id) || { count: 0, latestReviewAt: null }
        const report = plan.report as any
        const student = plan.studentId ? studentById.get(plan.studentId) : null
        const guardian = plan.guardianId ? guardianById.get(plan.guardianId) : null
        const klass = plan.classId ? classById.get(plan.classId) : null
        const linkedAttempt = planIdToAssessment.get(plan.id)
        const actions = (plan.actions as Array<{ status: string }>) || []
        const completedCount = actions.filter(a => a.status === 'completed').length
        return {
          type: 'plan' as const,
          planId: plan.id,
          planTitle: plan.title,
          planStatus: plan.status,
          module: plan.module,
          summary: decryptSensitive(plan.summaryEnc, config.encryptionKey),
          updatedAt: plan.updatedAt,
          objectLabel: student?.name || guardian?.name || klass?.name || null,
          objectType: student ? 'student' : guardian ? 'guardian' : klass ? 'class' : null,
          objectGender: student?.gender || null,
          riskLabel: report?.risk?.label || null,
          riskLevel: report?.risk?.level || null,
          assessment: linkedAttempt ? {
            id: linkedAttempt.id,
            module: linkedAttempt.module,
            levelLabel: assessmentBadge((linkedAttempt.result as any)?.level)?.label || null,
            levelColor: assessmentBadge((linkedAttempt.result as any)?.level)?.color || null,
            submittedAt: linkedAttempt.submittedAt,
          } : null,
          totalActions: actions.length,
          completedActions: completedCount,
          reviewCount: stats.count,
          latestReviewAt: stats.latestReviewAt,
        }
      })
      const planIdsWithPlan = new Set(casesFromPlans.map(c => c.planId))
      const orphanAssessments = attempts
        .filter(a => !planRows.some(p => p.sourceAssessmentAttemptId === a.id))
        .map(attempt => ({
          type: 'assessment' as const,
          planId: null as string | null,
          planTitle: null as string | null,
          planStatus: null as string | null,
          module: attempt.module,
          summary: null as string | null,
          updatedAt: attempt.updatedAt,
          objectLabel: null as string | null,
          objectType: null as string | null,
          objectGender: null as string | null,
          riskLabel: (attempt.result as any)?.risk?.label || null,
          riskLevel: (attempt.result as any)?.risk?.level || null,
          assessment: {
            id: attempt.id,
            module: attempt.module,
            levelLabel: assessmentBadge((attempt.result as any)?.level)?.label || null,
            levelColor: assessmentBadge((attempt.result as any)?.level)?.color || null,
            submittedAt: attempt.submittedAt,
          },
          totalActions: 0,
          completedActions: 0,
          reviewCount: 0,
          latestReviewAt: null as Date | null,
        }))
      return [...casesFromPlans, ...orphanAssessments]
    })()
  }
})

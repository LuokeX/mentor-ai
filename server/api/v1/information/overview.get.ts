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
  const students = studentRows.map(row => ({
    ...row,
    name: decryptSensitive(row.nameEnc, config.encryptionKey),
    notes: decryptSensitive(row.notesEnc, config.encryptionKey),
    className: row.classId ? classById.get(row.classId)?.name : null,
    nameEnc: undefined,
    notesEnc: undefined
  }))
  const studentById = new Map(students.map(row => [row.id, row]))
  const guardians = guardianRows.map(row => {
    const linkedStudents = relationRows
      .filter(relation => relation.guardianId === row.id)
      .map(relation => studentById.get(relation.studentId))
      .filter(Boolean)
      .map(student => ({ id: student!.id, name: student!.name, classId: student!.classId, className: student!.className }))
    return {
      ...row,
      name: decryptSensitive(row.nameEnc, config.encryptionKey),
      phone: decryptSensitive(row.phoneEnc, config.encryptionKey),
      linkedStudents,
      nameEnc: undefined,
      phoneEnc: undefined
    }
  })
  const guardianById = new Map(guardians.map(row => [row.id, row]))
  const communications = communicationRows.map(row => ({
    ...row,
    summary: decryptSensitive(row.summaryEnc, config.encryptionKey),
    studentName: row.studentId ? studentById.get(row.studentId)?.name : null,
    guardianName: row.guardianId ? guardianById.get(row.guardianId)?.name : null,
    summaryEnc: undefined
  }))
  const classTree = classes.map(classRow => {
    const classStudents = students.filter(student => student.classId === classRow.id)
    const studentIds = new Set(classStudents.map(student => student.id))
    const guardianIds = new Set(relationRows.filter(relation => studentIds.has(relation.studentId)).map(relation => relation.guardianId))
    return {
      ...classRow,
      students: classStudents,
      guardians: guardians.filter(guardian => guardianIds.has(guardian.id)),
      communications: communications.filter(item => item.studentId ? studentIds.has(item.studentId) : item.guardianId ? guardianIds.has(item.guardianId) : false)
    }
  })
  return {
    ownershipNote: '班级、学生、家长、沟通和方案是学校业务档案；当前页面展示当前由你负责的记录。',
    classes: classRows,
    classTree,
    students,
    guardians,
    communications,
    plans: planRows.map(row => {
      const stats = reviewStats.get(row.id) || { count: 0, latestReviewAt: null }
      const report = row.report as any
      return {
        ...row,
        summary: decryptSensitive(row.summaryEnc, config.encryptionKey),
        summaryEnc: undefined,
        level: report?.risk?.level,
        riskLabel: report?.risk?.label,
        reviewCount: stats.count,
        latestReviewAt: stats.latestReviewAt
      }
    }),
    assessments: attempts
  }
})

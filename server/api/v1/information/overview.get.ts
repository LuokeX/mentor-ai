import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive } from '../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  const [classRows, studentRows, guardianRows, communicationRows, planRows, attempts] = await Promise.all([
    db.select().from(schema.classes).where(eq(schema.classes.ownerUserId, user.id)).orderBy(desc(schema.classes.updatedAt)),
    db.select().from(schema.students).where(eq(schema.students.ownerUserId, user.id)).orderBy(desc(schema.students.updatedAt)),
    db.select().from(schema.guardians).where(eq(schema.guardians.ownerUserId, user.id)).orderBy(desc(schema.guardians.updatedAt)),
    db.select().from(schema.communications).where(eq(schema.communications.ownerUserId, user.id)).orderBy(desc(schema.communications.occurredAt)).limit(50),
    db.select().from(schema.plans).where(eq(schema.plans.ownerUserId, user.id)).orderBy(desc(schema.plans.updatedAt)).limit(50),
    db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.ownerUserId, user.id)).orderBy(desc(schema.assessmentAttempts.updatedAt)).limit(50)
  ])
  return {
    classes: classRows,
    students: studentRows.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, config.encryptionKey), notes: decryptSensitive(row.notesEnc, config.encryptionKey), nameEnc: undefined, notesEnc: undefined })),
    guardians: guardianRows.map(row => ({ ...row, name: decryptSensitive(row.nameEnc, config.encryptionKey), phone: decryptSensitive(row.phoneEnc, config.encryptionKey), nameEnc: undefined, phoneEnc: undefined })),
    communications: communicationRows.map(row => ({ ...row, summary: decryptSensitive(row.summaryEnc, config.encryptionKey), summaryEnc: undefined })),
    plans: planRows.map(row => ({ ...row, summary: decryptSensitive(row.summaryEnc, config.encryptionKey), summaryEnc: undefined })),
    assessments: attempts
  }
})

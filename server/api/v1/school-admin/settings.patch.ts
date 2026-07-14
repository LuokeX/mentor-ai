import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  helpPhone: z.string().max(40).nullable().optional(),
  smsRecipients: z.array(z.string().max(40)).max(10).optional(),
  referralPsychologistId: z.string().uuid().nullable().optional(),
  crisisGuide: z.string().min(20).max(1000).optional()
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  if (body.referralPsychologistId) {
    const [psych] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.id, body.referralPsychologistId), eq(schema.users.schoolId, admin.schoolId!), eq(schema.users.role, 'psychologist')
    )).limit(1)
    if (!psych) throw createError({ statusCode: 422, message: '心理专员不属于本校' })
  }
  const [updated] = await db.update(schema.schoolSettings).set({ ...body, updatedAt: new Date() }).where(eq(schema.schoolSettings.schoolId, admin.schoolId!)).returning()
  await writeAudit(event, { schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.settings.update', targetType: 'school', targetId: admin.schoolId!, metadata: { changedFields: Object.keys(body) } })
  return updated
})

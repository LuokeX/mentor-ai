import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { grantTaskRewardTx } from '../../../domain/cend-points'
import { requireCendContext } from '../../../domain/cend-school'
import { writeAudit } from '../../../utils/audit'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const bodySchema = z.object({
  nickname: z.string().trim().min(1).max(120).optional(),
  subjects: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  grades: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
  textbookVersion: z.string().trim().max(160).nullable().optional(),
  region: z.string().trim().max(20).nullable().optional(),
  teachingYears: z.string().trim().max(20).nullable().optional(),
  roles: z.array(z.string().trim().min(1).max(40)).max(20).optional()
}).refine(value => Object.keys(value).length > 0, { message: '没有需要保存的资料' })

/** 完善/修改 C 端资料；首次提交额外发放 200 积分（仅一次）。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const cend = await requireCendContext(event, user)
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.cendProfiles)
      .where(eq(schema.cendProfiles.userId, user.id)).limit(1)
    const firstCompletion = !existing?.completedAt
    const values = {
      nickname: body.nickname ?? existing?.nickname ?? user.name,
      subjects: body.subjects ?? existing?.subjects ?? [],
      grades: body.grades ?? existing?.grades ?? [],
      textbookVersion: body.textbookVersion === undefined ? existing?.textbookVersion ?? null : body.textbookVersion,
      region: body.region === undefined ? existing?.region ?? null : body.region,
      teachingYears: body.teachingYears === undefined ? existing?.teachingYears ?? null : body.teachingYears,
      roles: body.roles ?? existing?.roles ?? [],
      completedAt: existing?.completedAt ?? new Date(),
      updatedAt: new Date()
    }
    if (existing) {
      await tx.update(schema.cendProfiles).set(values).where(eq(schema.cendProfiles.userId, user.id))
    } else {
      await tx.insert(schema.cendProfiles).values({ userId: user.id, ...values })
    }
    // 默认「我的班级」跟随用户选择的第一个年级；用户可多选年级，但个人班级只取第一个。
    if (body.grades?.length) {
      await tx.update(schema.classes)
        .set({ grade: body.grades[0]!, updatedAt: new Date() })
        .where(and(
          eq(schema.classes.schoolId, cend.id),
          eq(schema.classes.ownerUserId, user.id),
          eq(schema.classes.name, '我的班级')
        ))
    }
    let reward = 0
    if (firstCompletion) {
      const task = await grantTaskRewardTx(tx, user.id, 'complete_profile')
      reward = task.awarded ? task.reward : 0
    }
    await writeAudit(event, {
      schoolId: cend.id,
      actorId: user.id,
      action: 'cend.profile.update',
      targetType: 'user',
      targetId: user.id,
      metadata: { firstCompletion, reward }
    }, tx)
    return { reward }
  })

  const [profile] = await db.select().from(schema.cendProfiles)
    .where(eq(schema.cendProfiles.userId, user.id)).limit(1)
  return { ok: true, profile: profile ?? null, reward: result.reward }
})

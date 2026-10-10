import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'
import { requireSchoolManagement, assertActiveTeacher } from '../../../../../domain/school-management'
import { listUserRoles, userHasAnyRole, userHasRole, hasBusinessRole, SCHOOL_MANAGED_ROLES } from '../../../../../domain/user-roles'
import { transferUserBusinessData, userHasOpenReferrals } from '../../../../../domain/user-transfer'

const transferAndDisableSchema = z.object({
  /** 业务接收教师：教师/心理专员账号必填；只读看板角色（德育主任/年级主任）没有业务数据，可不填 */
  toUserId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).max(500),
  // 如果存在未完成心理转介，必须指定新的心理专员
  newPsychologistId: z.string().uuid().optional()
})

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'], { allowPlatformAdmin: true })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = transferAndDisableSchema.parse(await readBody(event))
  const db = useDb(event)

  // 1. 验证目标用户存在且可停用（以 user_roles 判定，含兼任教师/心理专员的账号以及两个只读看板角色）
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), userHasAnyRole(db, SCHOOL_MANAGED_ROLES)
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '目标用户不存在' })
  if (target.status === 'disabled') throw createError({ statusCode: 409, message: '该账号已被停用' })

  // 2. 教师/心理专员账号有业务数据归属，停用必须指定接收教师；只读看板角色不需要移交
  const targetRoles = (await listUserRoles(db, id)).map(entry => entry.roleCode)
  const requiresTransfer = hasBusinessRole(targetRoles)
  if (requiresTransfer && !body.toUserId) {
    throw createError({ statusCode: 422, message: '教师或心理专员账号停用必须指定业务接收教师' })
  }

  // 3. 验证接收人
  if (body.toUserId) {
    if (body.toUserId === id) throw createError({ statusCode: 422, message: '不能将业务移交给同一个账号' })
    await assertActiveTeacher(event, schoolId, body.toUserId)
  }
  if (body.newPsychologistId) {
    const [psychologist] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.id, body.newPsychologistId),
      eq(schema.users.schoolId, schoolId),
      // 以 user_roles 判定心理专员身份：兼任账号也能承接转介
      userHasRole(db, 'psychologist'),
      eq(schema.users.status, 'active'),
    )).limit(1)
    if (!psychologist) throw createError({ statusCode: 422, message: '新的心理专员不存在或不可用' })
  }

  // 3. 检查心理转介：目标账号持有心理专员角色（含兼任）且存在未完成转介
  const targetIsPsychologist = (await listUserRoles(db, id)).some(entry => entry.roleCode === 'psychologist')
  if (targetIsPsychologist) {
    const hasOpenReferral = await userHasOpenReferrals(db, schoolId, id)
    if (hasOpenReferral && !body.newPsychologistId) {
      throw createError({ statusCode: 422, message: '该心理专员存在未完成的转介工单，请指定新的心理专员' })
    }
  }

  await db.transaction(async (tx) => {
    // 4-12. 业务移交：把业务责任链交给接收教师。只读看板角色（德育主任/年级主任）
    // 没有业务数据，前端不传接收教师，这里整段跳过，只做停用与审计。
    // 移交逻辑与「换角色时移交」共用 server/domain/user-transfer.ts，避免两处口径漂移。
    if (body.toUserId) {
      await transferUserBusinessData(tx, {
        schoolId,
        fromUserId: id,
        toUserId: body.toUserId,
        actorId: actor.id,
        reason: body.reason,
        newPsychologistId: body.newPsychologistId
      })
    }

    // 13. 撤销登录会话
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id))

    // 14. 将账号设为 disabled
    const [disabled] = await tx.update(schema.users).set({
      status: 'disabled',
      disabledAt: new Date(),
      disabledBy: actor.id,
      disabledReason: body.reason,
      updatedAt: new Date()
    }).where(and(
      eq(schema.users.id, id),
      eq(schema.users.schoolId, schoolId),
      userHasAnyRole(tx, SCHOOL_MANAGED_ROLES),
    )).returning({ id: schema.users.id })
    if (!disabled) throw createError({ statusCode: 409, message: '账号状态已变化，请刷新后重试' })

    await writeAudit(event, {
      schoolId, actorId: actor.id,
      action: 'school_admin.user.transfer_and_disable',
      targetType: 'user', targetId: id,
      metadata: {
        toUserId: body.toUserId ?? null,
        transferred: requiresTransfer,
        reason: body.reason,
        newPsychologistId: body.newPsychologistId, delegatedGrantId
      }
    }, tx)
  })

  return { ok: true }
})

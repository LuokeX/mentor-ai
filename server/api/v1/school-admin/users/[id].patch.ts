import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { schoolAdminUserUpdateSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement } from '../../../../domain/school-management'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminUserUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = getQuery(event).expectedUpdatedAt
    ? z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
    : undefined
  const db = useDb(event)
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  // 并发冲突检查
  if (expectedUpdatedAt && target.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '该记录已被其他用户修改，请刷新后重试' })
  }

  // 邮箱变更时检查同校唯一性
  if (body.email && body.email !== target.email) {
    const [conflict] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.schoolId, schoolId), eq(schema.users.email, body.email)
    )).limit(1)
    if (conflict) throw createError({ statusCode: 409, message: '该邮箱已被本校其他账号使用' })
  }

  const changedFields: string[] = []
  if (body.name) changedFields.push('name')
  if (body.email && body.email !== target.email) changedFields.push('email')
  if (body.role && body.role !== target.role) changedFields.push('role')
  if (body.status) changedFields.push('status')

  await db.transaction(async (tx) => {
    const setValues: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name) setValues.name = body.name
    if (body.email) setValues.email = body.email
    if (body.role) setValues.role = body.role
    if (body.status) setValues.status = body.status
    // 如果停用，记录停用信息
    if (body.status === 'disabled') {
      setValues.disabledAt = new Date()
      setValues.disabledBy = actor.id
      setValues.disabledReason = '管理员直接停用'
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, target.id))
      await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, target.id))
    }
    // 如果重新启用，清除停用标记
    if (body.status === 'active' && target.status === 'disabled') {
      setValues.disabledAt = null
      setValues.disabledBy = null
      setValues.disabledReason = null
    }
    await tx.update(schema.users).set(setValues).where(eq(schema.users.id, target.id))
  })

  await writeAudit(event, {
    schoolId, actorId: actor.id,
    action: 'school_admin.user.update',
    targetType: 'user', targetId: id,
    metadata: { changedFields, status: body.status, delegatedGrantId }
  })
  return { ok: true }
})
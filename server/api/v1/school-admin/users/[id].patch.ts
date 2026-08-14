import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { schoolAdminUserUpdateSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { encryptSensitive } from '../../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminUserUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = getQuery(event).expectedUpdatedAt
    ? z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
    : undefined
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })
  if (body.status === 'disabled') {
    throw createError({ statusCode: 409, message: '停用账号必须通过“移交并停用”操作完成' })
  }
  if (body.role && body.role !== target.role && target.status !== 'invited') {
    throw createError({ statusCode: 409, message: '仅未激活邀请可调整角色；已激活账号请先完成业务移交' })
  }

  // 并发冲突检查
  if (expectedUpdatedAt && target.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '该记录已被其他用户修改，请刷新后重试' })
  }

  // 手机号变更时检查全局唯一性（登录凭证）
  if (body.phone && body.phone !== target.phone) {
    const [conflict] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.phone, body.phone), ne(schema.users.id, id)
    )).limit(1)
    if (conflict) throw createError({ statusCode: 409, message: '该手机号已被其他账号使用' })
  }

  const changedFields: string[] = []
  if (body.name) changedFields.push('name')
  if (body.phone && body.phone !== target.phone) changedFields.push('phone')
  if (body.role && body.role !== target.role) changedFields.push('role')
  if (body.status) changedFields.push('status')

  await db.transaction(async (tx) => {
    const setValues: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name) setValues.name = body.name
    if (body.phone) setValues.phone = body.phone
    if (body.role) setValues.role = body.role
    if (body.status) setValues.status = body.status
    if (body.employeeNo !== undefined) setValues.employeeNo = body.employeeNo || null
    if (body.gender !== undefined) setValues.gender = body.gender || null
    if (body.teachingGrades !== undefined) setValues.teachingGrades = body.teachingGrades
    if (body.subject !== undefined) setValues.subject = body.subject || null
    if (body.isClassTeacher !== undefined) setValues.isClassTeacher = body.isClassTeacher
    if (body.classTeacherYears !== undefined) setValues.classTeacherYears = body.classTeacherYears
    if (body.hiredAt !== undefined) setValues.hiredAt = body.hiredAt ? new Date(body.hiredAt) : null
    if (body.title !== undefined) setValues.title = body.title || null
    if (body.certNote !== undefined) setValues.certNote = body.certNote || null
    if (body.notes !== undefined) setValues.notesEnc = body.notes ? encryptSensitive(body.notes, secret) : null
    if (body.overrides !== undefined) {
      const merged = { ...(target.overrides || {}), ...body.overrides }
      for (const [k, v] of Object.entries(merged)) if (!v) delete merged[k]
      setValues.overrides = merged
    }
    // 如果重新启用，清除停用标记
    if (body.status === 'active' && target.status === 'disabled') {
      setValues.disabledAt = null
      setValues.disabledBy = null
      setValues.disabledReason = null
    }
    const finalConditions = [
      eq(schema.users.id, target.id),
      eq(schema.users.schoolId, schoolId),
      inArray(schema.users.role, ['teacher', 'psychologist']),
    ]
    if (expectedUpdatedAt) finalConditions.push(eq(schema.users.updatedAt, new Date(expectedUpdatedAt)))
    const [updated] = await tx.update(schema.users).set(setValues).where(and(...finalConditions)).returning({ id: schema.users.id })
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '账号已被其他管理员修改，请刷新后重试' })
    await writeAudit(event, {
      schoolId, actorId: actor.id,
      action: 'school_admin.user.update',
      targetType: 'user', targetId: id,
      metadata: { changedFields, status: body.status, delegatedGrantId }
    }, tx)
  })
  return { ok: true }
})

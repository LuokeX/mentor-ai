import argon2 from 'argon2'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { platformAdminSchoolAdminUpdateSchema } from '../../../../../shared/contracts'
import { applyUserRoles, listUserRoles, userHasRole } from '../../../../domain/user-roles'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = platformAdminSchoolAdminUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = getQuery(event).expectedUpdatedAt
    ? z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
    : undefined
  const db = useDb(event)

  // 平台管理员只能管理持有 school_admin 角色的账号：按角色集合判定，多角色账号（如
  // school_admin + teacher）不会被误判为不存在；其余账号仍视为不存在，避免泄露存在性
  const [target] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, id),
    userHasRole(db, 'school_admin'),
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })
  // school_admin 必须归属某所学校
  if (!target.schoolId) throw createError({ statusCode: 409, message: '账号缺少学校归属，无法操作' })

  // 并发冲突检查
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(target.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '该记录已被其他用户修改，请刷新后重试' })
  }

  // 手机号变更时检查全局唯一性
  if (body.phone && body.phone !== target.phone) {
    const [conflict] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.phone, body.phone), ne(schema.users.id, id)
    )).limit(1)
    if (conflict) throw createError({ statusCode: 409, message: '该手机号已被其他账号使用' })
  }
  // 工号变更时检查校内唯一性
  if (body.employeeNo && body.employeeNo !== target.employeeNo) {
    const [dup] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.schoolId, target.schoolId),
      eq(schema.users.employeeNo, body.employeeNo),
      ne(schema.users.id, id),
    )).limit(1)
    if (dup) throw createError({ statusCode: 409, message: '该学校已存在相同工号' })
  }

  // 角色集合维护前置校验（roles 未传时不动角色行；只改主角色时按现有集合校验）
  const currentRoleCodes = (await listUserRoles(db, id, target.schoolId)).map(entry => entry.roleCode)
  if (body.roles && !body.primaryRole && !body.roles.some(role => role === target.role)) {
    throw createError({ statusCode: 400, message: '新的角色集合不包含账号当前主角色，请同时指定新的主角色' })
  }
  if (body.primaryRole && !body.roles && !currentRoleCodes.includes(body.primaryRole)) {
    throw createError({ statusCode: 400, message: '主角色必须属于账号当前的角色集合' })
  }

  const changedFields: string[] = []
  if (body.name) changedFields.push('name')
  if (body.phone && body.phone !== target.phone) changedFields.push('phone')
  if (body.status) changedFields.push('status')
  if (body.employeeNo !== undefined && body.employeeNo !== target.employeeNo) changedFields.push('employeeNo')
  if (body.password) changedFields.push('password')
  const rolesChanged = Boolean(
    (body.roles && (
      body.roles.length !== currentRoleCodes.length
      || body.roles.some(role => !currentRoleCodes.includes(role))
    ))
    || (body.primaryRole && body.primaryRole !== target.role)
  )
  if (rolesChanged) changedFields.push('roles')

  let resultingRoles = currentRoleCodes
  let resultingPrimaryRole: string = target.role

  await db.transaction(async (tx) => {
    const setValues: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name) setValues.name = body.name
    if (body.phone !== undefined) setValues.phone = body.phone
    if (body.status) setValues.status = body.status
    if (body.employeeNo !== undefined) setValues.employeeNo = body.employeeNo || null
    // 重置密码：哈希新密码，并撤销该账号现有会话（新密码生效时旧会话必须失效）
    if (body.password) {
      setValues.passwordHash = await argon2.hash(body.password, { type: argon2.argon2id })
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, target.id))
    }
    // 停用：school_admin 无业务移交问题，直接停用并留痕
    if (body.status === 'disabled' && target.status !== 'disabled') {
      setValues.disabledAt = new Date()
      setValues.disabledBy = actor.id
      setValues.disabledReason = body.reason || '平台管理员停用'
    }
    // 重新启用：清除停用标记
    if (body.status === 'active' && target.status === 'disabled') {
      setValues.disabledAt = null
      setValues.disabledBy = null
      setValues.disabledReason = null
    }
    const finalConditions = [
      eq(schema.users.id, target.id),
      // 归属条件在最终 UPDATE 重新校验：按角色集合判定，多角色账号不会被漏判
      userHasRole(tx, 'school_admin'),
    ]
    if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.users.updatedAt, expectedUpdatedAt))
    const [updated] = await tx.update(schema.users).set(setValues).where(and(...finalConditions))
      .returning({ id: schema.users.id })
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '账号已被其他管理员修改，请刷新后重试' })

    // 角色集合维护（可选）：覆盖式写入 user_roles 并同步主角色 users.role
    if (body.roles || body.primaryRole) {
      const applied = await applyUserRoles(tx, {
        userId: target.id,
        roleCodes: body.roles ?? currentRoleCodes,
        primaryRole: body.primaryRole,
        schoolId: target.schoolId,
      })
      resultingRoles = applied.roles
      resultingPrimaryRole = applied.primaryRole
    }

    await writeAudit(event, {
      schoolId: target.schoolId,
      actorId: actor.id,
      action: 'platform_admin.user.update',
      targetType: 'user',
      targetId: id,
      metadata: { changedFields, status: body.status, reason: body.reason },
    }, tx)

    // 角色集合或主角色变化单独留痕，便于按动作名审计授权变化
    if (rolesChanged) {
      await writeAudit(event, {
        schoolId: target.schoolId,
        actorId: actor.id,
        action: 'platform_admin.user.roles.update',
        targetType: 'user',
        targetId: id,
        metadata: {
          rolesBefore: currentRoleCodes,
          rolesAfter: resultingRoles,
          primaryRoleBefore: target.role,
          primaryRoleAfter: resultingPrimaryRole,
        },
      }, tx)
    }
  })
  return { ok: true, roles: resultingRoles, primaryRole: resultingPrimaryRole }
})

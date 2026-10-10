import { and, eq, ne } from 'drizzle-orm'
import argon2 from 'argon2'
import { z } from 'zod'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { schoolAdminUserUpdateSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, assertActiveTeacher } from '../../../../domain/school-management'
import { encryptSensitive } from '../../../../utils/crypto'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import type { AppRole } from '../../../../../app/composables/useAuth'
import { userHasAnyRole, applyUserRoles, listUserRoles, hasBusinessRole, SCHOOL_MANAGED_ROLES } from '../../../../domain/user-roles'
import { transferUserBusinessData, userOwnsBusinessData } from '../../../../domain/user-transfer'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'], { allowPlatformAdmin: true })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminUserUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = getQuery(event).expectedUpdatedAt
    ? z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
    : undefined
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [target] = await db.select().from(schema.users).where(and(
    // 该接口管理的对象是教师、心理专员与两个只读看板角色（以 user_roles 判定，含兼任）
    eq(schema.users.id, id), eq(schema.users.schoolId, schoolId), userHasAnyRole(db, SCHOOL_MANAGED_ROLES)
  )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })
  if (body.status === 'disabled') {
    throw createError({ statusCode: 409, message: '停用账号必须通过“移交并停用”操作完成' })
  }

  const targetRoles = await listUserRoles(db, id)
  const currentRoleCodes = targetRoles.map(entry => entry.roleCode)
  const roleChanging = Boolean(body.role && body.role !== target.role)
  let needsTransfer = false
  if (roleChanging) {
    if (currentRoleCodes.length > 1) {
      throw createError({ statusCode: 409, message: '该账号持有多个角色，请到平台后台「学校管理 → 账号 → 角色维护」调整' })
    }
    if (body.role === 'grade_director' && body.scopeGrade === undefined) {
      throw createError({ statusCode: 422, message: '请填写年级主任所辖年级' })
    }
    // 教师/心理专员账号有业务数据归属：换到非业务角色（德育主任/年级主任等）时必须先移交，
    // 移交与换角色在同一次操作里完成（同事务），不再要求「先去停用」——停用并不能让账号变成未激活。
    // 未激活邀请没有业务数据；教师 ↔ 心理专员互转仍保留业务角色，都不需要移交。
    needsTransfer = !hasBusinessRole([body.role as AppRole]) && await userOwnsBusinessData(db, schoolId, id)
    if (needsTransfer && !body.transferToUserId) {
      throw createError({ statusCode: 422, message: '该账号名下有业务数据，换角色前请选择业务接收教师（本次操作会一并完成移交）' })
    }
  }
  if (body.transferToUserId) {
    if (body.transferToUserId === id) throw createError({ statusCode: 422, message: '不能将业务移交给同一个账号' })
    await assertActiveTeacher(event, schoolId, body.transferToUserId)
    // 未触发移交的请求（例如只是改资料）不允许静默携带接收教师，避免误解为已移交
    if (!needsTransfer) throw createError({ statusCode: 422, message: '当前账号无需移交业务，请勿指定业务接收教师' })
  }
  /** 最终角色集合：换角色时整体替换（本接口语义是「换一个角色」），否则保持现状 */
  const finalRoleCodes = roleChanging ? [body.role!] : currentRoleCodes
  const writesScopeGrade = body.scopeGrade !== undefined && finalRoleCodes.includes('grade_director')
  const currentGradeScope = targetRoles.find(entry => entry.roleCode === 'grade_director')?.scope.grade ?? null

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

  const changedFields: string[] = []
  if (body.name) changedFields.push('name')
  if (body.phone && body.phone !== target.phone) changedFields.push('phone')
  if (roleChanging) changedFields.push('role')
  if (needsTransfer) changedFields.push('transfer')
  if (body.status) changedFields.push('status')
  if (body.password) changedFields.push('password')
  if (writesScopeGrade && body.scopeGrade !== currentGradeScope) changedFields.push('scopeGrade')

  await db.transaction(async (tx) => {
    // 先移交业务责任链（换角色时）：同事务内保证「数据有人接」与「角色已换」一起生效
    if (needsTransfer && body.transferToUserId) {
      await transferUserBusinessData(tx, {
        schoolId,
        fromUserId: id,
        toUserId: body.transferToUserId,
        actorId: actor.id,
        reason: body.transferReason || `换角色移交：${target.name}（${currentRoleCodes.join('、')} → ${body.role}）`
      })
    }

    const setValues: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name) setValues.name = body.name
    if (body.phone !== undefined) {
      setValues.phone = body.phone
      setValues.phoneEnc = encryptSensitive(body.phone, secret)
    }
    if (body.role) setValues.role = body.role
    if (body.status) setValues.status = body.status
    if (body.password) setValues.passwordHash = await argon2.hash(body.password, { type: argon2.argon2id })
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
      userHasAnyRole(tx, SCHOOL_MANAGED_ROLES),
    ]
    if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.users.updatedAt, expectedUpdatedAt))
    const [updated] = await tx.update(schema.users).set(setValues).where(and(...finalConditions)).returning({ id: schema.users.id })
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '账号已被其他管理员修改，请刷新后重试' })
    // 角色调整同步 user_roles：本接口只服务未激活邀请账号与只读看板角色账号，
    // 语义是「换一个角色」，因此整体替换角色集合并保持主角色一致（否则 userHasRole 会查不到新角色）。
    // 所辖年级（角色级 scope）在最终仍持有年级主任角色时写入，供看板范围解析使用。
    if (roleChanging || writesScopeGrade) {
      await applyUserRoles(tx, {
        userId: id,
        roleCodes: finalRoleCodes,
        primaryRole: (roleChanging ? body.role! : target.role) as AppRole,
        scopes: writesScopeGrade ? { grade_director: { grade: body.scopeGrade! } } : undefined,
      })
    }
    await writeAudit(event, {
      schoolId, actorId: actor.id,
      action: 'school_admin.user.update',
      targetType: 'user', targetId: id,
      metadata: {
        changedFields,
        status: body.status,
        roles: roleChanging ? finalRoleCodes : undefined,
        scopeGrade: writesScopeGrade ? body.scopeGrade : undefined,
        transferToUserId: needsTransfer ? body.transferToUserId : undefined,
        delegatedGrantId
      }
    }, tx)
  })
  return { ok: true }
})

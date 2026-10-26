/**
 * 平台后台 · 账号角色维护（PRD 7.1.1「学校与权限管理」的补位入口）。
 *
 * 背景：学校级账号管理（`/api/v1/school-admin/users/{id}`）只服务教师、心理专员与两个只读看板角色，
 * 且语义是「换一个角色」；学校管理员、学部校长与兼任（多角色）账号此前没有任何可维护入口，
 * 出问题只能改库。本接口把这项能力收口到平台管理员，用于：
 * - 给学部校长等账号加「兼任」角色（例如加 teacher 后可在顶栏切换身份使用 AI 助手）；
 * - 修复角色配置错误（含多角色账号的角色集合与主角色）；
 * - 换角色时一并完成业务数据移交（与学校后台同一条移交链路，见 server/domain/user-transfer.ts）。
 *
 * 安全边界：
 * - 只有 platform_admin 可调用；
 * - 不能维护平台管理员账号，也不能通过本接口授予 platform_admin 角色（防提权/自锁）；
 * - 目标账号必须归属某所学校；角色集合必须非空、无重复且包含主角色；
 * - 持有年级主任角色时必须给出所辖年级；
 * - 账号名下有业务数据且新角色集合不再含业务角色（teacher/psychologist）时，必须指定业务接收教师，
 *   移交与角色变更在同一事务里完成，并写审计 `platform_admin.user.roles.update`。
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { roleSchema } from '../../../../../../shared/contracts'
import { applyUserRoles, hasBusinessRole, listUserRoles, normalizeScopeGrades } from '../../../../../domain/user-roles'
import { transferUserBusinessData, userHasOpenReferrals, userOwnsBusinessData } from '../../../../../domain/user-transfer'
import { assertActiveTeacher } from '../../../../../domain/school-management'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

/** 不通过本入口维护/授予的角色与需要 scope 的角色。 */
const PROTECTED_ROLE = 'platform_admin'
const GRADE_SCOPED_ROLE = 'grade_director'

const bodySchema = z.object({
  /** 目标角色集合（覆盖式写入；至少一个，上限为当前角色目录的条数） */
  roles: z.array(roleSchema).min(1).max(7),
  /** 主角色（写回 users.role），必须包含在 roles 中 */
  primaryRole: roleSchema,
  /** 角色级范围：持有年级主任角色时必填 grades（兼容旧版 grade） */
  scopes: z.object({
    grade_director: z.object({
      grades: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
      grade: z.number().int().min(1).max(12).optional()
    })
  }).partial().optional(),
  /** 业务接收教师：账号名下有业务数据且新角色集合不再含业务角色时必填 */
  transferToUserId: z.string().uuid().optional(),
  /** 存在未完成心理转介且不再保留心理专员角色时，指定新的心理专员 */
  newPsychologistId: z.string().uuid().optional(),
  /** 操作事由（≥10 字，写入审计） */
  reason: z.string().trim().min(10).max(500)
})

export default defineEventHandler(async (event) => {
  const actor = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '账号不存在' })
  const allRoleCodes = (await listUserRoles(db, id)).map(entry => entry.roleCode)
  // 防提权与自锁：不能维护平台管理员账号，也不能通过本入口授予平台管理员角色（先于学校归属校验，保证提示准确）
  if (allRoleCodes.includes(PROTECTED_ROLE) || body.roles.includes(PROTECTED_ROLE as typeof body.roles[number])) {
    throw createError({ statusCode: 403, message: '不能通过该入口维护或授予平台管理员角色' })
  }
  if (!target.schoolId) throw createError({ statusCode: 409, message: '账号缺少学校归属，无法维护角色' })
  const schoolId = target.schoolId
  // 本入口只维护账号主租户的角色；C 端等其它租户的角色由对应入口维护，不能被整体覆盖删除。
  const currentRoleCodes = (await listUserRoles(db, id, schoolId)).map(entry => entry.roleCode)

  const uniqueRoles = [...new Set(body.roles)]
  if (uniqueRoles.length !== body.roles.length) {
    throw createError({ statusCode: 422, message: '角色集合中存在重复项' })
  }
  if (!uniqueRoles.includes(body.primaryRole)) {
    throw createError({ statusCode: 422, message: '主角色必须包含在角色集合中' })
  }
  const requestedGradeScope = body.scopes?.grade_director
  const scopeGrades = normalizeScopeGrades(
    requestedGradeScope?.grades?.length ? requestedGradeScope.grades : requestedGradeScope?.grade
  )
  if (uniqueRoles.includes(GRADE_SCOPED_ROLE as typeof uniqueRoles[number]) && !scopeGrades.length) {
    throw createError({ statusCode: 422, message: '持有年级主任角色时必须填写所辖年级' })
  }

  // 业务数据移交：新集合不再含业务角色（teacher/psychologist）且账号名下有数据时必填接收教师
  const keepsBusinessRole = hasBusinessRole(uniqueRoles)
  const needsTransfer = !keepsBusinessRole && await userOwnsBusinessData(db, schoolId, id)
  if (needsTransfer && !body.transferToUserId) {
    throw createError({ statusCode: 422, message: '该账号名下有业务数据，请选择业务接收教师（本次操作会一并完成移交）' })
  }
  if (!needsTransfer && body.transferToUserId) {
    throw createError({ statusCode: 422, message: '当前账号无需移交业务，请勿指定业务接收教师' })
  }
  if (body.transferToUserId) {
    if (body.transferToUserId === id) throw createError({ statusCode: 422, message: '不能将业务移交给同一个账号' })
    await assertActiveTeacher(event, schoolId, body.transferToUserId)
  }
  // 不再保留心理专员角色且存在未完成转介时，必须指定新的心理专员
  const losesPsychologist = currentRoleCodes.includes('psychologist') && !uniqueRoles.includes('psychologist')
  if (losesPsychologist && !body.newPsychologistId) {
    const hasOpen = await userHasOpenReferrals(db, schoolId, id)
    if (hasOpen) throw createError({ statusCode: 422, message: '该心理专员存在未完成的转介工单，请指定新的心理专员' })
  }

  const scopes = scopeGrades.length
    ? { grade_director: { grades: scopeGrades } }
    : undefined
  const rolesChanged = uniqueRoles.length !== currentRoleCodes.length
    || uniqueRoles.some(role => !currentRoleCodes.includes(role))
    || target.role !== body.primaryRole

  await db.transaction(async (tx) => {
    if (needsTransfer && body.transferToUserId) {
      await transferUserBusinessData(tx, {
        schoolId,
        fromUserId: id,
        toUserId: body.transferToUserId,
        actorId: actor.id,
        reason: body.reason,
        newPsychologistId: body.newPsychologistId
      })
    }
    await applyUserRoles(tx, {
      userId: id,
      roleCodes: uniqueRoles,
      primaryRole: body.primaryRole,
      schoolId,
      scopes
    })
    await writeAudit(event, {
      schoolId,
      actorId: actor.id,
      action: 'platform_admin.user.roles.update',
      targetType: 'user',
      targetId: id,
      metadata: {
        roles: uniqueRoles,
        primaryRole: body.primaryRole,
        previousRoles: currentRoleCodes,
        scopeGrades: scopes?.grade_director?.grades ?? null,
        scopeGrade: scopes?.grade_director?.grades?.[0] ?? null,
        transferToUserId: body.transferToUserId ?? null,
        newPsychologistId: body.newPsychologistId ?? null,
        rolesChanged,
        reason: body.reason
      }
    }, tx)
  })

  return { ok: true, roles: uniqueRoles, primaryRole: body.primaryRole, transferred: needsTransfer }
})

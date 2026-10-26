/**
 * 商业化 C 端租户解析。
 *
 * C 端用户与学校用户共用 users 表；所有 C 端数据落在同一个 kind='cend' 的学校租户下，
 * 通过 sessions.active_school_id / AuthUser.schoolId 与学校租户隔离。
 */
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser } from '../../app/composables/useAuth'
import { type DbClient, schema, useDb } from '../utils/db'
import { listUserRoles } from './user-roles'

export const CEND_SCHOOL_CODE = 'cend'
export const CEND_SCHOOL_NAME = '班主任智能体 C 端'

export interface CendSchool {
  id: string
  name: string
  code: string
}

/** 读取 C 端租户；未初始化时返回 null（迁移/初始化脚本负责创建）。 */
export async function findCendSchool(db: DbClient): Promise<CendSchool | null> {
  const [row] = await db.select({
    id: schema.schools.id,
    name: schema.schools.name,
    code: schema.schools.code
  }).from(schema.schools).where(and(
    eq(schema.schools.code, CEND_SCHOOL_CODE),
    eq(schema.schools.kind, 'cend'),
    eq(schema.schools.status, 'active')
  )).limit(1)
  return row ?? null
}

/** 判断当前激活租户是否 C 端；非 C 端学校用户不参与积分扣减。 */
export async function isCendSchool(db: DbClient, schoolId: string | null | undefined): Promise<boolean> {
  if (!schoolId) return false
  const [row] = await db.select({ id: schema.schools.id }).from(schema.schools).where(and(
    eq(schema.schools.id, schoolId),
    eq(schema.schools.kind, 'cend')
  )).limit(1)
  return Boolean(row)
}

/**
 * C 端接口前置校验：当前激活租户必须是 C 端，且账号持有 C 端角色。
 * 返回 C 端租户信息；不满足时抛 409/403。
 */
export async function requireCendContext(event: H3Event, user: AuthUser): Promise<CendSchool> {
  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化，请联系平台管理员' })
  if (user.schoolId !== cend.id) {
    throw createError({ statusCode: 409, message: '请先切换到 C 端工作区' })
  }
  const roles = await listUserRoles(db, user.id, cend.id)
  if (!roles.length) throw createError({ statusCode: 403, message: '该账号尚未开通 C 端' })
  return cend
}

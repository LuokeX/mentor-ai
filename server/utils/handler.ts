import { type H3Event } from 'h3'
import { requireUser } from './auth'
import { useDb } from './db'
import type { AppRole } from '../../app/composables/useAuth'

/**
 * 一次性获取 API 端点最常用的三个上下文：
 * - 认证用户（通过 requireUser 校验角色）
 * - Drizzle 数据库实例
 * - 加密密钥
 *
 * 替代手写的三行：
 *   const user = await requireUser(event, ['teacher'])
 *   const db = useDb(event)
 *   const secret = useRuntimeConfig(event).encryptionKey
 */
export async function apiContext(event: H3Event, roles: AppRole[]) {
  const user = await requireUser(event, roles)
  return {
    user,
    db: useDb(event),
    secret: useRuntimeConfig(event).encryptionKey as string,
  }
}
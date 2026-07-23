import { z } from 'zod'
import { getRouterParam, type H3Event } from 'h3'

const Uuid = z.string().uuid()

/**
 * 从路由参数中解析 UUID，非法时自动抛出 400。
 * 对应 46 处重复的：z.string().uuid().parse(getRouterParam(event, 'id'))
 */
export function uuidParam(event: H3Event, name = 'id'): string {
  return Uuid.parse(getRouterParam(event, name))
}
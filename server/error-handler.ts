/**
 * 全局错误处理（nitro.errorHandler 入口）。
 *
 * 仅拦截 ZodError（query/body schema 解析失败）：统一返回 400 + 精简 message，
 * 不泄露 stack（dev 模式下默认会返回含文件路径的完整调用栈）。
 * 其余错误不处理：Nitro 虚拟 error-handler 会在 handler 未写出响应
 * （event.handled 为 false）时自动调用内置默认处理器，createError 的
 * 401/403/404/409 等行为保持不变。
 */
import { ZodError } from 'zod'
import { send, setResponseHeader, setResponseStatus } from 'h3'
import { defineNitroErrorHandler } from 'nitropack/runtime'

const BAD_REQUEST_MESSAGE = '请求参数不合法'

export default defineNitroErrorHandler((error, event) => {
  const zodError = error instanceof ZodError
    ? error
    : (error.cause instanceof ZodError ? error.cause : undefined)

  if (!zodError) return

  const message = zodError.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')
  setResponseStatus(event, 400, BAD_REQUEST_MESSAGE)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return send(event, JSON.stringify({ statusCode: 400, statusMessage: BAD_REQUEST_MESSAGE, message }))
})
/**
 * 全局 PostgreSQL 错误码 → HTTP 状态码映射。
 *
 * 已手动 catch 的端点（throw createError）不受影响 —— 本 hook 会跳过已有 statusCode 的错误。
 * 未 catch 的 raw postgres error 会自动转为友好的 HTTP 响应。
 *
 * 覆盖的错误码：
 *   23505  unique_violation → 409 Conflict
 *   23503  foreign_key_violation → 409 Conflict
 *   23514  check_violation → 400 Bad Request
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error) => {
    // 已经是 HTTP 错误（由 createError 抛出），保持原样
    if ((error as any)?.statusCode) return

    const pg = error as { code?: string; detail?: string }
    if (!pg.code) return

    switch (pg.code) {
      case '23505': // unique_violation
        throw createError({ statusCode: 409, statusMessage: pg.detail || '操作冲突，数据已存在' })
      case '23503': // foreign_key_violation
        throw createError({ statusCode: 409, statusMessage: '存在关联数据，无法删除' })
      case '23514': // check_violation
        throw createError({ statusCode: 400, statusMessage: '数据不符合约束条件' })
    }
  })
})
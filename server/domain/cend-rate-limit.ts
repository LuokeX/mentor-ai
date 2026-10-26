/**
 * C 端登录失败频控（单进程内存实现，MVP 用；多实例部署时需换成共享存储）。
 * 同一 IP + 手机号 10 分钟内失败 10 次后锁定，成功登录后清零。
 */
const WINDOW_MS = 10 * 60 * 1000
const MAX_FAILURES = 10

interface Entry {
  count: number
  resetAt: number
}

const failures = new Map<string, Entry>()

function current(key: string): Entry | null {
  const entry = failures.get(key)
  if (!entry) return null
  if (entry.resetAt <= Date.now()) {
    failures.delete(key)
    return null
  }
  return entry
}

export function loginRateLimit(key: string): { allowed: boolean, retryAfterSeconds: number } {
  const entry = current(key)
  if (!entry) return { allowed: true, retryAfterSeconds: 0 }
  if (entry.count < MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) }
}

export function recordLoginFailure(key: string): void {
  const entry = current(key)
  if (!entry) {
    failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearLoginFailures(key: string): void {
  failures.delete(key)
}

export type AppRole = 'teacher' | 'psychologist' | 'school_admin' | 'platform_admin'

export interface AuthUser {
  id: string
  schoolId: string | null
  phone: string
  name: string
  role: AppRole
  roleLabel: string
  /**
   * 任教年级（1-12，教师本人资料字段）。用于按学段筛选量表/工具/知识库资源：
   * 空数组表示未填写，此时不做学段过滤（不因为缺资料而藏内容）。
   */
  teachingGrades?: number[]
}

export const useAuth = () => {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => false)

  const refresh = async () => {
    if (loading.value) return
    loading.value = true
    try {
      // Deliberately erase Nuxt's generated route union here. With many dynamic API
      // routes that union can exceed TypeScript's comparison recursion limit.
      const requestFetch = $fetch as unknown as (
        url: string,
        options?: { headers?: Record<string, string> }
      ) => Promise<AuthUser>
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      user.value = await requestFetch('/api/v1/auth/me', { headers }).catch(() => null)
    } finally {
      loading.value = false
    }
  }

  const logout = async () => {
    await $fetch('/api/v1/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return { user, loading, refresh, logout }
}

export type AppRole =
  | 'teacher'
  | 'psychologist'
  | 'school_admin'
  | 'division_principal'
  | 'moral_education_director'
  | 'grade_director'
  | 'platform_admin'

export interface AuthTenant {
  schoolId: string
  schoolName: string
  schoolCode: string
  /** school | cend */
  kind: string
  roles: AppRole[]
}

export interface AuthUser {
  id: string
  schoolId: string | null
  phone: string
  name: string
  /**
   * 当前「激活角色」：一个账号可持有多个角色（见 roles），但同一时刻只有一个生效。
   * 落地页、可访问前缀、能力解析与 requireUser 都以它为准；
   * 前端用 useAuth().hasRole() 判断「账号是否具备某角色」，不要用 role 比较。
   */
  role: AppRole
  /**
   * 账号持有的全部角色（至少一个，且必然包含主角色）。
   * 服务端 /auth/me 总会返回；历史测试构造的对象可能缺省，缺省时按 [role] 处理。
   */
  roles?: AppRole[]
  roleLabel: string
  /**
   * 任教年级（1-12，教师本人资料字段）。用于按学段筛选量表/工具/知识库资源：
   * 空数组表示未填写，此时不做学段过滤（不因为缺资料而藏内容）。
   */
  teachingGrades?: number[]
  /** 可切换的工作区（学校/C 端）；由 /auth/me 下发。 */
  tenants?: AuthTenant[]
}

/** 账号持有的角色集合：缺省 roles 的历史数据按激活角色处理。 */
export function rolesOf(user: Pick<AuthUser, 'role' | 'roles'> | null | undefined): AppRole[] {
  if (!user) return []
  if (user.roles && user.roles.length) return user.roles
  return [user.role]
}

/** 各角色的首页（激活角色决定落地页）。 */
export const ROLE_HOME: Record<AppRole, string> = {
  teacher: '/',
  psychologist: '/specialist',
  school_admin: '/school-admin',
  division_principal: '/dashboard',
  moral_education_director: '/dashboard',
  grade_director: '/dashboard',
  platform_admin: '/platform-admin'
}

/** 角色中文标签：角色切换器与跨角色提示统一使用。 */
export const ROLE_LABELS: Record<AppRole, string> = {
  teacher: '教师',
  psychologist: '心理专员',
  school_admin: '学校管理员',
  division_principal: '学部校长',
  moral_education_director: '德育主任',
  grade_director: '年级主任',
  platform_admin: '平台管理员'
}

/**
 * 各角色可访问的路径域（`/notifications` 为四角色共用，单独处理）。
 * 中间件据此反查目标路径属于哪个角色：兼任账号进入另一端的页面前，
 * 必须先切换激活角色，否则接口会按激活角色返回 403。
 */
export const ROLE_PATH_PREFIXES: Record<AppRole, string[]> = {
  teacher: ['/', '/module', '/assessments', '/information', '/growth', '/plans', '/cend'],
  psychologist: ['/specialist'],
  // 学校管理员兼管账号开通与平台使用量看板（原「系统管理员」角色已并入本角色）
  school_admin: ['/school-admin', '/usage'],
  division_principal: ['/dashboard'],
  moral_education_director: ['/dashboard'],
  grade_director: ['/dashboard'],
  platform_admin: ['/platform-admin']
}

/** 所有角色共用的路径域：这些路径不触发角色切换。 */
export const SHARED_PATH_PREFIXES = ['/notifications']

function pathMatchesPrefix(path: string, prefix: string): boolean {
  // 根路径只匹配 `/` 本身，避免把任意路径都算进教师域
  if (prefix === '/') return path === '/'
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** 路径是否落在某个角色的域内。 */
export function pathInRoleDomain(role: AppRole, path: string): boolean {
  return ROLE_PATH_PREFIXES[role].some(prefix => pathMatchesPrefix(path, prefix))
}

/** 路径是否属于所有角色共用的区域（如 /notifications）。 */
export function pathIsShared(path: string): boolean {
  return SHARED_PATH_PREFIXES.some(prefix => pathMatchesPrefix(path, prefix))
}

/** 目标路径属于哪个角色域；共用区域或未知路径返回 null。多个角色共用同一路径域时返回第一个（见 rolesDomainOfPath）。 */
export function roleDomainOfPath(path: string): AppRole | null {
  return rolesDomainOfPath(path)[0] ?? null
}

/**
 * 目标路径归属的角色集合（按 ROLE_PATH_PREFIXES 的声明顺序）。
 * 数据驾驶舱由三个角色共用（校长 / 德育主任 / 年级主任），中间件要用集合判断
 * 「当前账号持有的某个角色能否进这个域」，不能只看第一个匹配到的角色，否则会在
 * 落地页上反复重定向（会话切换目标角色不是账号持有的那个）。
 */
export function rolesDomainOfPath(path: string): AppRole[] {
  return (Object.keys(ROLE_PATH_PREFIXES) as AppRole[]).filter(role => pathInRoleDomain(role, path))
}

/** 激活角色对应的首页；未知角色回落教师首页，避免把用户困在中间页。 */
export function roleHomePath(role: AppRole | string | null | undefined): string {
  // 用取值而不是 in/prototype 判断：服务端若返回未知角色编码，取值结果为 undefined
  return (role && ROLE_HOME[role as AppRole]) || '/'
}

export const useAuth = () => {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => false)

  // 有意擦除 Nuxt 生成的路由联合类型：动态 API 路由很多，这个联合类型会超出
  // TypeScript 的比较递归上限（TS2589，并会让同文件里其它 $fetch 调用的类型
  // 解析失败），因此本文件统一走 requestFetch。
  const requestFetch = $fetch as unknown as <T>(
    url: string,
    options?: { method?: 'POST', body?: unknown, headers?: Record<string, string> }
  ) => Promise<T>

  const refresh = async () => {
    if (loading.value) return
    loading.value = true
    try {
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      user.value = await requestFetch<AuthUser | null>('/api/v1/auth/me', { headers }).catch(() => null)
    } finally {
      loading.value = false
    }
  }

  /** 账号是否持有该角色（与当前激活角色无关）；跨角色入口可见性、跳转判断用它。 */
  const hasRole = (role: AppRole) => rolesOf(user.value).includes(role)

  /** 账号是否持有其中任意一个角色。 */
  const hasAnyRole = (roles: readonly AppRole[]) => roles.some(role => rolesOf(user.value).includes(role))

  /**
   * 切换当前会话的激活角色，成功后刷新用户信息（user.role 变为新的激活角色）。
   * 未持有该角色或会话过期时抛出，由调用方提示或跳转。
   * SSR 首屏中间件也会调用：服务端 $fetch 不会自动带上登录 Cookie，这里显式转发
   * （与 refresh 同一做法），否则首屏切换会被服务端判成未登录。
   */
  const switchRole = async (role: AppRole) => {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    await requestFetch<{ ok: boolean, role: AppRole }>('/api/v1/auth/switch-role', {
      method: 'POST',
      body: { role },
      headers
    })
    await refresh()
  }

  /**
   * 切换当前会话的激活工作区（学校/C 端），成功后刷新用户信息。
   * 目标租户必须是账号实际加入的租户；未加入由服务端返回 403。
   */
  const switchTenant = async (schoolId: string) => {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    await requestFetch<{ ok: boolean, schoolId: string, role: AppRole }>('/api/v1/auth/switch-tenant', {
      method: 'POST',
      body: { schoolId },
      headers
    })
    await refresh()
  }

  /** 可切换的工作区列表。 */
  const tenants = computed<AuthTenant[]>(() => user.value?.tenants ?? [])

  /** 激活角色对应的首页（落地页）。 */
  const roleHome = computed(() => roleHomePath(user.value?.role))

  const logout = async () => {
    // 与 refresh 同一个擦除路由联合类型的请求函数：直接写 $fetch 会触发 TS2589，
    // 并使同文件内其它 $fetch 调用的类型解析失败（行为不变）。
    await requestFetch<unknown>('/api/v1/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return { user, loading, refresh, logout, hasRole, hasAnyRole, switchRole, switchTenant, tenants, roleHome }
}

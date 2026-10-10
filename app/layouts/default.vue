<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'
import { APP_VERSION } from '#shared/app-version'
import { ROLE_LABELS, roleHomePath, rolesOf, type AppRole } from '~/composables/useAuth'
const route = useRoute()
const { user, refresh, logout, hasRole, switchRole, roleHome } = useAuth()
const toast = useToast()
await refresh()

// 小屏导航（顶栏 + 底部菜单）是浮层：默认收起，点悬浮按钮才滑出，滚动或到点自动收起（桌面端恒显示）
const { hidden: headerHidden, reveal: revealNav, hide: hideNav, bindAutoHideHeader } = useAutoHideHeader()
bindAutoHideHeader()
// 页面切换后收起浮层导航，保持内容优先
watch(() => route.fullPath, () => hideNav())
// 手机端键盘状态：covered 表示底部被键盘挡住，此时底部菜单必须藏在键盘后面，
// 不能让浏览器把它拖到键盘上方（inset 供对话页把面板底部对齐到键盘上沿）
const { covered: keyboardCovered, bindKeyboardInset } = useKeyboardInset()
bindKeyboardInset()

/** 角色切换器图标：与各角色入口按钮保持同一套图标。 */
const roleIcons: Record<AppRole, string> = {
  teacher: 'i-lucide-graduation-cap',
  psychologist: 'i-lucide-heart-handshake',
  school_admin: 'i-lucide-building-2',
  division_principal: 'i-lucide-chart-column',
  moral_education_director: 'i-lucide-chart-column',
  grade_director: 'i-lucide-chart-column',
  platform_admin: 'i-lucide-shield-check'
}

/** 兼任多角色的账号显示角色切换器：只持有单一角色时保持原有顶栏。 */
const multipleRoles = computed(() => rolesOf(user.value).length > 1)
/** 看板入口：校长 / 德育主任 / 年级主任三类角色共用「数据驾驶舱」 */
const dashboardRole = computed(() => ['division_principal', 'moral_education_director', 'grade_director'].some(role => hasRole(role as AppRole)))
const roleSwitchItems = computed(() => rolesOf(user.value).map(role => ({
  label: ROLE_LABELS[role],
  icon: roleIcons[role],
  description: role === user.value?.role ? '当前身份' : `切换到${ROLE_LABELS[role]}首页`,
  // 当前激活角色不可再切（重复切换是幂等的，但这里直接置灰更直观）
  disabled: role === user.value?.role,
  onSelect: () => { void changeRole(role) }
})))

/** 切换激活角色并跳到该角色首页；失败时留在当前页并提示。 */
async function changeRole(role: AppRole) {
  if (role === user.value?.role) return
  try {
    await switchRole(role)
    toast.add({ title: `已切换为${ROLE_LABELS[role]}`, color: 'success' })
    await navigateTo(roleHomePath(role))
  } catch (error) {
    const message = (error as { data?: { message?: unknown } })?.data?.message
    toast.add({
      title: '切换身份失败',
      description: typeof message === 'string' && message.trim() ? message.trim() : '请稍后重试',
      color: 'error'
    })
  }
}

const mobileItems = computed(() => {
  if (user.value?.role === 'teacher') return [
    { label: '我的助手', icon: 'i-lucide-house', to: '/' },
    { label: '我的方案', icon: 'i-lucide-file-text', to: '/plans' },
    { label: '评估记录', icon: 'i-lucide-clipboard-list', to: '/assessments' },
    { label: '信息中心', icon: 'i-lucide-folder-open', to: '/information' },
    { label: '我的成长', icon: 'i-lucide-sprout', to: '/growth' }
  ]
  return [
    { label: '工作台', icon: 'i-lucide-layout-dashboard', to: roleHome.value },
    { label: '事件', icon: 'i-lucide-bell', to: '/notifications' }
  ]
})
const navClass = (active: boolean) => [
  'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition hover:shadow-sm',
  active
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
]
/** 悬停展开：鼠标进入 details（含下拉面板）时打开。 */
function openDropdown(event: Event) {
  ;(event.currentTarget as HTMLElement | null)?.setAttribute('open', '')
}

/** 鼠标移开 details（含下拉面板）时关闭。 */
function closeOnLeave(event: Event) {
  ;(event.currentTarget as HTMLElement | null)?.removeAttribute('open')
}

/** 点击下拉子项后关闭所在 details（专项评估/我的成长通用）。 */
function closeDropdown(event: Event) {
  ;(event.currentTarget as HTMLElement | null)?.closest('details')?.removeAttribute('open')
}
</script>

<template>
  <div class="min-h-screen">
    <header v-if="user" class="fixed inset-x-0 top-0 z-40 border-b border-emerald-950/5 bg-[#f8faf6] shadow-[0_12px_32px_-24px_rgba(15,42,35,0.55)] backdrop-blur-xl transition-transform duration-200 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-gradient-to-b after:from-[#f8faf6]/95 after:to-transparent lg:sticky lg:bg-[#f8faf6]/90 lg:shadow-none lg:after:hidden" :class="headerHidden ? '-translate-y-full' : ''">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <NuxtLink :to="roleHome" class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-2xl bg-emerald-800 text-lg text-white">六</span>
          <span>
            <span class="flex items-center gap-2">
              <strong class="block text-sm">教师赋能智能平台</strong>
              <span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700">{{ APP_VERSION }}</span>
            </span>
            <small class="text-xs text-slate-500">AI · 安全 · 成长</small>
          </span>
        </NuxtLink>
        <nav class="hidden items-center gap-2 md:flex">
          <NuxtLink v-if="hasRole('teacher')" to="/" :class="navClass(route.path === '/')"><UIcon name="i-lucide-house" class="size-4" />我的助手</NuxtLink>
          <details v-if="hasRole('teacher')" class="relative after:absolute after:inset-x-0 after:top-full after:h-1.5 after:content-['']" @mouseenter="openDropdown" @mouseleave="closeOnLeave">
            <summary :class="[...navClass(route.path.startsWith('/module') || route.path.startsWith('/assessments')), 'cursor-pointer list-none select-none']"><UIcon name="i-lucide-clipboard-list" class="size-4" />专项评估<UIcon name="i-lucide-chevron-down" class="size-3.5 opacity-70" /></summary>
            <div class="absolute left-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <NuxtLink v-for="(item, id) in moduleMeta" :key="id" :to="`/module/${id}`" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon :name="item.icon" class="size-4 text-slate-400" />{{ item.title }}</NuxtLink>
              <NuxtLink to="/assessments" class="mt-1 flex items-center gap-2.5 rounded-lg border-t border-slate-100 px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon name="i-lucide-clipboard-list" class="size-4 text-slate-400" />评估记录</NuxtLink>
            </div>
          </details>
          <NuxtLink v-if="hasRole('teacher')" to="/plans" :class="navClass(route.path.startsWith('/plans'))"><UIcon name="i-lucide-file-text" class="size-4" />我的方案</NuxtLink>
          <NuxtLink v-if="hasRole('teacher')" to="/information" :class="navClass(route.path.startsWith('/information'))"><UIcon name="i-lucide-folder-open" class="size-4" />信息中心</NuxtLink>
          <details v-if="hasRole('teacher')" class="relative after:absolute after:inset-x-0 after:top-full after:h-1.5 after:content-['']" @mouseenter="openDropdown" @mouseleave="closeOnLeave">
            <summary :class="[...navClass(route.path.startsWith('/growth') || route.path.startsWith('/notifications')), 'cursor-pointer list-none select-none']"><UIcon name="i-lucide-sprout" class="size-4" />我的成长<UIcon name="i-lucide-chevron-down" class="size-3.5 opacity-70" /></summary>
            <div class="absolute left-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <NuxtLink to="/growth" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon name="i-lucide-heart-pulse" class="size-4 text-slate-400" />自我状态分析</NuxtLink>
              <NuxtLink to="/notifications" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon name="i-lucide-notebook-pen" class="size-4 text-slate-400" />工作日志</NuxtLink>
            </div>
          </details>
          <UButton v-if="hasRole('school_admin')" to="/school-admin" :variant="route.path.startsWith('/school-admin') ? 'soft' : 'ghost'" :color="route.path.startsWith('/school-admin') ? 'primary' : 'neutral'">学校管理</UButton>
          <UButton v-if="hasRole('school_admin')" to="/usage" :variant="route.path.startsWith('/usage') ? 'soft' : 'ghost'" :color="route.path.startsWith('/usage') ? 'primary' : 'neutral'">使用量看板</UButton>
          <UButton v-if="dashboardRole" to="/dashboard" :variant="route.path.startsWith('/dashboard') ? 'soft' : 'ghost'" :color="route.path.startsWith('/dashboard') ? 'primary' : 'neutral'">数据驾驶舱</UButton>
          <UButton v-if="hasRole('platform_admin')" to="/platform-admin" :variant="route.path.startsWith('/platform-admin') ? 'soft' : 'ghost'" :color="route.path.startsWith('/platform-admin') ? 'primary' : 'neutral'">平台管理</UButton>
          <UButton v-if="hasRole('psychologist')" to="/specialist" :variant="route.path.startsWith('/specialist') ? 'soft' : 'ghost'" :color="route.path.startsWith('/specialist') ? 'primary' : 'neutral'">转介工作台</UButton>
        </nav>
        <div class="flex items-center gap-3">
          <!-- 兼任账号：顶栏直接切换激活角色并跳到对应首页 -->
          <UDropdownMenu v-if="multipleRoles" :items="roleSwitchItems">
            <UButton
              icon="i-lucide-arrow-left-right"
              color="neutral"
              variant="soft"
              size="sm"
              trailing-icon="i-lucide-chevron-down"
              aria-label="切换身份"
              :title="`切换身份（当前：${ROLE_LABELS[user.role]}）`"
            />
          </UDropdownMenu>
          <div class="hidden text-right sm:block">
            <p class="text-sm font-medium">{{ user.name }}</p>
            <p class="text-xs text-slate-500">{{ user.roleLabel }}</p>
          </div>
          <UButton icon="i-lucide-log-out" color="neutral" variant="soft" aria-label="退出" @click="logout" />
        </div>
      </div>
    </header>
    <main class="pb-[4.5rem] lg:pb-0">
      <slot />
    </main>
    <footer v-if="user && route.path !== '/'" class="mx-auto max-w-7xl px-5 pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] print:block lg:pb-6">
      <p class="text-center text-xs text-slate-400">AI 辅助建议，需人工专业判断</p>
    </footer>
    <SurveyFeedbackButton v-if="user" />
    <!-- 小屏导航默认收起，点右侧这个悬浮按钮才滑出顶栏与底部菜单；滚动或 6 秒后自动收起 -->
    <button
      v-if="user"
      type="button"
      class="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+7rem)] z-50 grid size-10 place-items-center rounded-full border border-slate-200/80 bg-white/90 text-slate-500 shadow-lg shadow-slate-900/10 backdrop-blur-xl transition-all duration-200 active:scale-95 lg:hidden"
      :class="headerHidden && !keyboardCovered ? 'opacity-100' : 'pointer-events-none translate-x-3 opacity-0'"
      aria-label="显示顶部导航和底部菜单"
      @click="revealNav()"
    >
      <UIcon name="i-lucide-menu" class="size-4" />
    </button>
    <nav v-if="user" class="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-[max(1rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-200 md:hidden" :class="[headerHidden || keyboardCovered ? 'translate-y-full' : '', keyboardCovered ? 'invisible' : '']">
      <div class="mx-auto grid w-full max-w-md" :style="{ gridTemplateColumns: `repeat(${mobileItems.length || 1}, minmax(0, 1fr))` }">
        <template v-for="item in mobileItems" :key="item.to">
          <details v-if="item.to === '/growth'" class="relative">
            <summary :class="['flex min-h-16 min-w-0 cursor-pointer list-none select-none flex-col items-center justify-center gap-1 px-0.5 text-[10px]', route.path.startsWith('/growth') || route.path.startsWith('/notifications') ? '!text-emerald-700' : 'text-slate-500']">
              <UIcon name="i-lucide-sprout" class="size-5" /><span class="max-w-full whitespace-nowrap">我的成长</span>
            </summary>
            <div class="absolute bottom-full right-0 z-[60] mb-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <NuxtLink to="/growth" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon name="i-lucide-heart-pulse" class="size-4 text-slate-400" />自我状态分析</NuxtLink>
              <NuxtLink to="/notifications" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800" @click="closeDropdown"><UIcon name="i-lucide-notebook-pen" class="size-4 text-slate-400" />工作日志</NuxtLink>
            </div>
          </details>
          <NuxtLink v-else :to="item.to" class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] text-slate-500" active-class="!text-emerald-700">
            <UIcon :name="item.icon" class="size-5" /><span class="max-w-full whitespace-nowrap">{{ item.label }}</span>
          </NuxtLink>
        </template>
      </div>
    </nav>
  </div>
</template>

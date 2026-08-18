<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'
const route = useRoute()
const { user, refresh, logout } = useAuth()
await refresh()

const roleHome = computed(() => {
  if (user.value?.role === 'school_admin') return '/school-admin'
  if (user.value?.role === 'platform_admin') return '/platform-admin'
  if (user.value?.role === 'psychologist') return '/specialist'
  return '/'
})
const mobileItems = computed(() => {
  if (user.value?.role === 'teacher') return [
    { label: '我的助手', icon: 'i-lucide-house', to: '/' },
    { label: '专项评估', icon: 'i-lucide-clipboard-list', to: '/#modules' },
    { label: '我的方案', icon: 'i-lucide-file-text', to: '/information/plans' },
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
</script>

<template>
  <div class="min-h-screen">
    <header v-if="user" class="sticky top-0 z-40 border-b border-emerald-950/5 bg-[#f8faf6]/90 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <NuxtLink :to="roleHome" class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-2xl bg-emerald-800 text-lg text-white">六</span>
          <span>
            <strong class="block text-sm">教师赋能智能平台</strong>
            <small class="text-xs text-slate-500">AI · 安全 · 成长</small>
          </span>
        </NuxtLink>
        <nav class="hidden items-center gap-2 md:flex">
          <NuxtLink v-if="user.role === 'teacher'" to="/" :class="navClass(route.path === '/')"><UIcon name="i-lucide-house" class="size-4" />我的助手</NuxtLink>
          <details v-if="user.role === 'teacher'" class="relative">
            <summary :class="[...navClass(route.path.startsWith('/module')), 'cursor-pointer list-none select-none']"><UIcon name="i-lucide-clipboard-list" class="size-4" />专项评估<UIcon name="i-lucide-chevron-down" class="size-3.5 opacity-70" /></summary>
            <div class="absolute left-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <NuxtLink v-for="(item, id) in moduleMeta" :key="id" :to="`/module/${id}`" class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800"><UIcon :name="item.icon" class="size-4 text-slate-400" />{{ item.title }}</NuxtLink>
            </div>
          </details>
          <NuxtLink v-if="user.role === 'teacher'" to="/information/plans" :class="navClass(route.path.startsWith('/information/plans'))"><UIcon name="i-lucide-file-text" class="size-4" />我的方案</NuxtLink>
          <NuxtLink v-if="user.role === 'teacher'" to="/information" :class="navClass(route.path.startsWith('/information') && !route.path.startsWith('/information/plans'))"><UIcon name="i-lucide-folder-open" class="size-4" />信息中心</NuxtLink>
          <NuxtLink v-if="user.role === 'teacher'" to="/growth" :class="navClass(route.path.startsWith('/growth'))"><UIcon name="i-lucide-sprout" class="size-4" />我的成长</NuxtLink>
          <UButton v-if="user.role === 'school_admin'" to="/school-admin" :variant="route.path.startsWith('/school-admin') ? 'soft' : 'ghost'" :color="route.path.startsWith('/school-admin') ? 'primary' : 'neutral'">学校管理</UButton>
          <UButton v-if="user.role === 'platform_admin'" to="/platform-admin" :variant="route.path.startsWith('/platform-admin') ? 'soft' : 'ghost'" :color="route.path.startsWith('/platform-admin') ? 'primary' : 'neutral'">平台管理</UButton>
          <UButton v-if="user.role === 'psychologist'" to="/specialist" :variant="route.path.startsWith('/specialist') ? 'soft' : 'ghost'" :color="route.path.startsWith('/specialist') ? 'primary' : 'neutral'">转介工作台</UButton>
        </nav>
        <div class="flex items-center gap-3">
          <div class="hidden text-right sm:block">
            <p class="text-sm font-medium">{{ user.name }}</p>
            <p class="text-xs text-slate-500">{{ user.roleLabel }}</p>
          </div>
          <UButton icon="i-lucide-log-out" color="neutral" variant="soft" aria-label="退出" @click="logout" />
        </div>
      </div>
    </header>
    <main class="pb-20 md:pb-0">
      <slot />
    </main>
    <footer v-if="user" class="mx-auto max-w-7xl px-5 pb-6 pt-2 print:block">
      <p class="text-center text-xs text-slate-400">AI 辅助建议，需人工专业判断</p>
    </footer>
    <SurveyFeedbackButton v-if="user" />
    <nav v-if="user" class="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-[max(1rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div class="mx-auto grid max-w-md" :class="user.role === 'teacher' ? 'grid-cols-5' : 'grid-cols-2'">
        <NuxtLink v-for="item in mobileItems" :key="item.to" :to="item.to" class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] text-slate-500" active-class="!text-emerald-700">
          <UIcon :name="item.icon" class="size-5" /><span class="max-w-full whitespace-nowrap">{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>

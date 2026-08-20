<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  createLabel?: string
  canCreate?: boolean
}>()
const emit = defineEmits<{ create: [] }>()

const route = useRoute()
type NavChild = { label: string; to: string; icon: string }
type NavItem = NavChild & { children?: NavChild[] }
// 除「总览」外，每项 label 必须与目标页面的 title 一致，否则点进去标题会“变名字”。
const informationNav: NavItem[] = [
  { label: '总览', to: '/information', icon: 'i-lucide-layout-dashboard' },
  { label: '负责班级', to: '/information/classes', icon: 'i-lucide-school' },
  { label: '我负责的学生', to: '/information/students', icon: 'i-lucide-users' },
  { label: '关联家长', to: '/information/guardians', icon: 'i-lucide-user-round' },
  { label: '家校沟通', to: '/information/communications', icon: 'i-lucide-messages-square' },
  { label: '学生事件记录', to: '/information/events', icon: 'i-lucide-clipboard-list' },
]
const schoolAdminNav: NavItem[] = [
  { label: '总览', to: '/school-admin', icon: 'i-lucide-layout-dashboard' },
  {
    label: '组织管理',
    to: '/school-admin/users',
    icon: 'i-lucide-building-2',
    children: [
      { label: '账号管理', to: '/school-admin/users', icon: 'i-lucide-user-cog' },
      { label: '部门管理', to: '/school-admin/departments', icon: 'i-lucide-building' },
      { label: '班级管理', to: '/school-admin/classes', icon: 'i-lucide-school' },
      { label: '学生管理', to: '/school-admin/students', icon: 'i-lucide-graduation-cap' },
      { label: '家长管理', to: '/school-admin/guardians', icon: 'i-lucide-users' },
    ],
  },
  {
    label: '业务运营',
    to: '/school-admin/imports',
    icon: 'i-lucide-briefcase',
    children: [
      { label: '导入管理', to: '/school-admin/imports', icon: 'i-lucide-upload' },
      { label: '转介管理', to: '/school-admin/referrals', icon: 'i-lucide-share-2' },
      { label: '评估记录', to: '/school-admin/assessments', icon: 'i-lucide-clipboard-list' },
      { label: '方案管理', to: '/school-admin/plans', icon: 'i-lucide-file-text' },
      { label: 'AI 对话', to: '/school-admin/conversations', icon: 'i-lucide-messages-square' },
    ],
  },
  {
    label: '风险管控',
    to: '/school-admin/access-approvals',
    icon: 'i-lucide-shield',
    children: [
      { label: '授权审批', to: '/school-admin/access-approvals', icon: 'i-lucide-shield-check' },
      { label: '审计日志', to: '/school-admin/audit', icon: 'i-lucide-list-checks' },
    ],
  },
  {
    label: '系统设置',
    to: '/school-admin/operations',
    icon: 'i-lucide-settings',
    children: [
      { label: '运维管理', to: '/school-admin/operations', icon: 'i-lucide-server' },
      { label: '学校设置', to: '/school-admin/settings', icon: 'i-lucide-settings' },
    ],
  },
]
const platformNav: NavItem[] = [
  { label: '总览', to: '/platform-admin', icon: 'i-lucide-layout-dashboard' },
  { label: '学校管理', to: '/platform-admin/schools', icon: 'i-lucide-building-2' },
  { label: '学校管理员', to: '/platform-admin/users', icon: 'i-lucide-user-cog' },
  { label: '三库运营台', to: '/platform-admin/resources', icon: 'i-lucide-library' },
  { label: '知识库', to: '/platform-admin/knowledge', icon: 'i-lucide-brain' },
  { label: '审计日志', to: '/platform-admin/audit', icon: 'i-lucide-list-checks' },
  { label: 'AI 管理中心', to: '/platform-admin/ai-center', icon: 'i-lucide-bot' },
  { label: '调研反馈', to: '/platform-admin/survey-feedback', icon: 'i-lucide-clipboard-pen-line' },
]
function dropdownElement(event: Event) {
  const current = event.currentTarget
  if (!(current instanceof HTMLElement)) return null
  return current.matches('details') ? current : current.closest('details')
}

function openDropdown(event: Event) {
  dropdownElement(event)?.setAttribute('open', '')
}

function toggleDropdown(event: Event) {
  const dropdown = dropdownElement(event)
  if (!dropdown) return
  dropdown.toggleAttribute('open')
}

function closeDropdown(event: Event) {
  ;(event.currentTarget as HTMLElement | null)?.closest('details')?.removeAttribute('open')
}

// hover 打开后保持展开，点击下拉外区域统一收起，避免鼠标移向菜单项时误触发关闭
function closeDropdownsOnOutsideClick(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('details')) {
    document.querySelectorAll('details[open]').forEach((el) => el.removeAttribute('open'))
  }
}

onMounted(() => {
  document.addEventListener('click', closeDropdownsOnOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeDropdownsOnOutsideClick)
})

const contextualNav = computed(() => route.path.startsWith('/information')
  ? informationNav
  : route.path.startsWith('/school-admin')
    ? schoolAdminNav
    : route.path.startsWith('/platform-admin')
      ? platformNav
      : [])
</script>

<template>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
    <nav v-if="contextualNav.length" class="flex flex-wrap gap-1 overflow-visible border-b border-gray-200 pb-2">
      <template v-for="item in contextualNav" :key="item.to">
        <UButton
          v-if="!item.children"
          :to="item.to"
          :icon="item.icon"
          :variant="route.path === item.to ? 'soft' : 'ghost'"
          :color="route.path === item.to ? 'primary' : 'neutral'"
          size="md"
          class="shrink-0"
        >
          {{ item.label }}
        </UButton>
        <details
          v-else
          class="relative shrink-0 after:absolute after:inset-x-0 after:top-full after:h-1.5 after:content-['']"
          @mouseenter="openDropdown"
        >
          <summary
            :class="[
              'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition hover:shadow-sm cursor-pointer list-none select-none',
              item.children!.some(c => route.path === c.to || route.path.startsWith(c.to + '/'))
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
            ]"
            @click.prevent.stop="toggleDropdown"
          >
            <UIcon :name="item.icon" class="size-4" />
            {{ item.label }}
            <UIcon name="i-lucide-chevron-down" class="size-3.5 opacity-70" />
          </summary>
          <div class="absolute left-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            <NuxtLink
              v-for="child in item.children"
              :key="child.to"
              :to="child.to"
              :class="route.path === child.to || route.path.startsWith(child.to + '/')
                ? 'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition bg-emerald-50 text-emerald-800'
                : 'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800'"
              @click="closeDropdown"
            >
              <UIcon :name="child.icon" class="size-4 text-slate-400" />
              {{ child.label }}
            </NuxtLink>
          </div>
        </details>
      </template>
    </nav>
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-base text-gray-500">{{ description }}</p>
      </div>
      <UButton
        v-if="canCreate && createLabel"
        icon="i-lucide-plus"
        color="primary"
        size="sm"
        @click="emit('create')"
      >
        {{ createLabel }}
      </UButton>
    </div>
    <slot />
  </div>
</template>

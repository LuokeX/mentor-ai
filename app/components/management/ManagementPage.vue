<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  createLabel?: string
  canCreate?: boolean
}>()
const emit = defineEmits<{ create: [] }>()

const route = useRoute()
// 除「总览」外，每项 label 必须与目标页面的 title 一致，否则点进去标题会“变名字”。
const informationNav = [
  { label: '总览', to: '/information', icon: 'i-lucide-layout-dashboard' },
  { label: '方案', to: '/information/plans', icon: 'i-lucide-clipboard-check' },
  { label: '负责班级', to: '/information/classes', icon: 'i-lucide-school' },
  { label: '我负责的学生', to: '/information/students', icon: 'i-lucide-users' },
  { label: '关联家长', to: '/information/guardians', icon: 'i-lucide-user-round' },
  { label: '家校沟通', to: '/information/communications', icon: 'i-lucide-messages-square' },
  { label: '事件记录', to: '/information/events', icon: 'i-lucide-clipboard-list' },
]
const schoolAdminNav = [
  { label: '总览', to: '/school-admin', icon: 'i-lucide-layout-dashboard' },
  { label: '账号管理', to: '/school-admin/users', icon: 'i-lucide-user-cog' },
  { label: '部门管理', to: '/school-admin/departments', icon: 'i-lucide-building' },
  { label: '班级管理', to: '/school-admin/classes', icon: 'i-lucide-school' },
  { label: '学生管理', to: '/school-admin/students', icon: 'i-lucide-graduation-cap' },
  { label: '家长管理', to: '/school-admin/guardians', icon: 'i-lucide-users' },
  { label: '导入管理', to: '/school-admin/imports', icon: 'i-lucide-upload' },
  { label: '运维管理', to: '/school-admin/operations', icon: 'i-lucide-server' },
  { label: '转介管理', to: '/school-admin/referrals', icon: 'i-lucide-share-2' },
  { label: '授权审批', to: '/school-admin/access-approvals', icon: 'i-lucide-shield-check' },
  { label: '审计日志', to: '/school-admin/audit', icon: 'i-lucide-list-checks' },
  { label: '学校设置', to: '/school-admin/settings', icon: 'i-lucide-settings' },
]
const platformNav = [
  { label: '总览', to: '/platform-admin', icon: 'i-lucide-layout-dashboard' },
  { label: '学校管理', to: '/platform-admin/schools', icon: 'i-lucide-building-2' },
  { label: '三库运营台', to: '/platform-admin/resources', icon: 'i-lucide-library' },
  { label: '知识库', to: '/platform-admin/knowledge', icon: 'i-lucide-brain' },
  { label: '委托授权', to: '/platform-admin/delegated-management', icon: 'i-lucide-shield' },
  { label: '审计日志', to: '/platform-admin/audit', icon: 'i-lucide-list-checks' },
  { label: 'AI 管理中心', to: '/platform-admin/ai-center', icon: 'i-lucide-bot' },
]
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
    <nav v-if="contextualNav.length" class="flex gap-1 overflow-x-auto border-b border-gray-200 pb-2">
      <UButton
        v-for="item in contextualNav"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        :variant="route.path === item.to ? 'soft' : 'ghost'"
        :color="route.path === item.to ? 'primary' : 'neutral'"
        size="md"
        class="shrink-0"
      >
        {{ item.label }}
      </UButton>
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

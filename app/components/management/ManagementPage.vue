<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  createLabel?: string
  canCreate?: boolean
}>()
const emit = defineEmits<{ create: [] }>()

const route = useRoute()
const informationNav = [
  { label: '总览', to: '/information' },
  { label: '班级', to: '/information/classes' },
  { label: '学生', to: '/information/students' },
  { label: '家长', to: '/information/guardians' },
  { label: '沟通', to: '/information/communications' },
  { label: '事件', to: '/information/events' },
  { label: '案例', to: '/information/cases' },
]
const schoolAdminNav = [
  { label: '总览', to: '/school-admin' },
  { label: '账号', to: '/school-admin/users' },
  { label: '部门', to: '/school-admin/departments' },
  { label: '班级', to: '/school-admin/classes' },
  { label: '学生', to: '/school-admin/students' },
  { label: '家长', to: '/school-admin/guardians' },
  { label: '导入', to: '/school-admin/imports' },
  { label: '方案运营', to: '/school-admin/operations' },
  { label: '转介', to: '/school-admin/referrals' },
  { label: '权限审批', to: '/school-admin/access-approvals' },
  { label: '审计', to: '/school-admin/audit' },
  { label: '设置', to: '/school-admin/settings' },
]
const platformNav = [
  { label: '总览', to: '/platform-admin' },
  { label: '学校', to: '/platform-admin/schools' },
  { label: '三库运营', to: '/platform-admin/resources' },
  { label: '委托授权', to: '/platform-admin/delegated-management' },
  { label: '审计', to: '/platform-admin/audit' },
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
        :variant="route.path === item.to ? 'soft' : 'ghost'"
        :color="route.path === item.to ? 'primary' : 'neutral'"
        size="sm"
        class="shrink-0"
      >
        {{ item.label }}
      </UButton>
    </nav>
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-gray-500">{{ description }}</p>
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

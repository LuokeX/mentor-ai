<script setup lang="ts">

const { data } = await useFetch<any>('/api/v1/school-admin/dashboard')
const { data: planStats } = await useFetch<any>('/api/v1/school-admin/plan-statistics')

const nav = [
  { id: 'overview', label: '管理首页', icon: 'i-lucide-layout-dashboard', to: '/school-admin' },
  { id: 'users', label: '用户管理', icon: 'i-lucide-users', to: '/school-admin/users' },
  { id: 'departments', label: '部门管理', icon: 'i-lucide-building-2', to: '/school-admin/departments' },
  { id: 'classes', label: '班级管理', icon: 'i-lucide-school', to: '/school-admin/classes' },
  { id: 'students', label: '学生管理', icon: 'i-lucide-graduation-cap', to: '/school-admin/students' },
  { id: 'guardians', label: '家长管理', icon: 'i-lucide-user-round', to: '/school-admin/guardians' },
  { id: 'imports', label: '导入中心', icon: 'i-lucide-file-up', to: '/school-admin/imports' },
  { id: 'operations', label: '方案运营', icon: 'i-lucide-activity', to: '/school-admin/operations' },
  { id: 'referrals', label: '危机转介', icon: 'i-lucide-siren', to: '/school-admin/referrals' },
  { id: 'approvals', label: '权限审批', icon: 'i-lucide-shield-check', to: '/school-admin/access-approvals' },
  { id: 'audit', label: '审计日志', icon: 'i-lucide-scroll-text', to: '/school-admin/audit' },
  { id: 'settings', label: '学校配置', icon: 'i-lucide-settings', to: '/school-admin/settings' },
] as const

const metrics = computed(() => data.value?.metrics ?? { users: 0, activeCrises: 0, assessments: 0 })
const pendingCount = computed(() => (data.value?.pendingRequests ?? []).length)
const referralCount = computed(() => (data.value?.referrals ?? []).length)
const completionRate = computed(() => planStats.value?.planCompletion?.rate ?? 0)
const overdueCount = computed(() => planStats.value?.overduePlans?.length ?? 0)
const inProgressCount = computed(() => planStats.value?.planCompletion?.inProgress ?? 0)
const completedCount = computed(() => planStats.value?.planCompletion?.completed ?? 0)
const totalPlans = computed(() => planStats.value?.planCompletion?.total ?? 0)
const topTeachers = computed(() => (planStats.value?.teacherRanking ?? []).slice(0, 5))
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10">
    <div>
      <p class="text-sm font-semibold text-indigo-700">学校管理空间</p>
      <h1 class="mt-2 text-3xl font-semibold">学校管理后台</h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">用户、部门、班级、学生、方案运营与风险管控总览。</p>
    </div>

    <!-- 导航标签 -->
    <div class="mt-8 flex flex-wrap gap-2">
      <UButton
        v-for="item in nav"
        :key="item.id"
        :to="item.to"
        :variant="item.id === 'overview' ? 'solid' : 'ghost'"
        :color="item.id === 'overview' ? 'primary' : 'neutral'"
        :icon="item.icon"
        size="sm"
      >
        {{ item.label }}
      </UButton>
    </div>

    <!-- 统计卡片 -->
    <div class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-slate-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-2xl font-semibold">{{ metrics.users }}</p>
            <p class="mt-1 text-sm font-medium text-slate-600">学校账号</p>
          </div>
          <span class="grid size-9 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <UIcon name="i-lucide-users" />
          </span>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-2xl font-semibold">{{ metrics.assessments }}</p>
            <p class="mt-1 text-sm font-medium text-slate-600">评估记录</p>
          </div>
          <span class="grid size-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
            <UIcon name="i-lucide-clipboard-check" />
          </span>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-2xl font-semibold" :class="metrics.activeCrises > 0 ? 'text-red-600' : ''">{{ metrics.activeCrises }}</p>
            <p class="mt-1 text-sm font-medium text-slate-600">待处理危机</p>
          </div>
          <span class="grid size-9 place-items-center rounded-lg bg-red-50 text-red-700">
            <UIcon name="i-lucide-siren" />
          </span>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 p-5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-2xl font-semibold">{{ pendingCount + (data?.delegatedRequests ?? []).length }}</p>
            <p class="mt-1 text-sm font-medium text-slate-600">待审批</p>
            <p class="text-xs text-slate-400">{{ pendingCount }} 访问 + {{ (data?.delegatedRequests ?? []).length }} 代管</p>
          </div>
          <span class="grid size-9 place-items-center rounded-lg bg-amber-50 text-amber-700">
            <UIcon name="i-lucide-shield-check" />
          </span>
        </div>
      </div>
    </div>

    <!-- 方案执行概览 -->
    <h2 class="mt-10 text-lg font-semibold">方案执行概览</h2>
    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-slate-200 p-5">
        <p class="text-xs font-medium text-slate-500">完成率</p>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-2xl font-bold" :class="completionRate >= 50 ? 'text-green-600' : 'text-amber-600'">
            {{ completionRate }}%
          </span>
          <span class="text-sm text-slate-400">{{ completedCount }}/{{ totalPlans }}</span>
        </div>
      </div>
      <div class="rounded-xl border border-slate-200 p-5">
        <p class="text-xs font-medium text-slate-500">执行中</p>
        <p class="mt-2 text-2xl font-bold text-blue-600">{{ inProgressCount }}</p>
        <p class="mt-1 text-xs text-slate-400">个方案进行中</p>
      </div>
      <div class="rounded-xl border border-slate-200 p-5">
        <p class="text-xs font-medium text-slate-500">超期提醒</p>
        <p class="mt-2 text-2xl font-bold" :class="overdueCount > 0 ? 'text-red-600' : 'text-green-600'">
          {{ overdueCount }}
        </p>
        <p class="mt-1 text-xs text-slate-400">个方案超 7 天未更新</p>
      </div>
    </div>

    <!-- 超期方案列表 -->
    <div v-if="planStats?.overduePlans?.length" class="mt-6">
      <h3 class="text-sm font-semibold text-red-700">需关注的方案</h3>
      <div class="mt-3 space-y-2">
        <div
          v-for="plan in planStats.overduePlans.slice(0, 5)"
          :key="plan.id"
          class="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-red-800">{{ plan.title }}</p>
            <p class="text-xs text-red-500">{{ plan.teacherName }} · {{ plan.daysSinceUpdate }} 天未更新</p>
          </div>
          <NuxtLink :to="`/information/plans/${plan.id}`" class="ml-3 shrink-0 text-xs text-red-600 hover:underline">
            查看方案
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- 教师执行排名 -->
    <div v-if="topTeachers.length" class="mt-10">
      <h2 class="text-lg font-semibold">班主任执行排名（近 7 天）</h2>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
              <th class="pb-2 pr-4">教师</th>
              <th class="pb-2 pr-4 text-right">负责方案</th>
              <th class="pb-2 pr-4 text-right">已完成动作</th>
              <th class="pb-2 text-right">完成率</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(t, i) in topTeachers"
              :key="t.teacherId"
              class="border-b border-slate-100"
            >
              <td class="py-2.5 pr-4">
                <span class="mr-2 text-xs font-bold text-slate-400">{{ Number(i) + 1 }}</span>
                {{ t.teacherName }}
              </td>
              <td class="py-2.5 pr-4 text-right">{{ t.planCount }}</td>
              <td class="py-2.5 pr-4 text-right text-green-600">{{ t.completedActionCount }}</td>
              <td class="py-2.5 text-right">
                {{ t.totalActionCount ? Math.round((t.completedActionCount / t.totalActionCount) * 100) : 0 }}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 管理原则 -->
    <div class="mt-10 rounded-xl border border-indigo-100 bg-indigo-50 p-6">
      <h2 class="text-sm font-semibold text-indigo-800">管理原则</h2>
      <ul class="mt-3 space-y-2 text-sm text-indigo-700">
        <li>· 业务档案不物理删除，使用归档和停用替代</li>
        <li>· 敏感数据访问需经过审批授权，最长 30 分钟</li>
        <li>· 所有管理员操作记录审计日志，不可篡改</li>
        <li>· 危机转介有 SLA 确认时限，超时自动升级</li>
        <li>· 平台代管仅覆盖基础资料，不含评估、聊天和方案正文</li>
      </ul>
    </div>
  </div>
</template>
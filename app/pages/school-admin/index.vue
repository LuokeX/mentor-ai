<script setup lang="ts">

const { data } = await useFetch<any>('/api/v1/school-admin/dashboard')
const { data: planStats } = await useFetch<any>('/api/v1/school-admin/plan-statistics')

const metrics = computed(() => data.value?.metrics ?? { users: 0, activeCrises: 0, assessments: 0 })
const pendingCount = computed(() => (data.value?.pendingRequests ?? []).length)
const completionRate = computed(() => planStats.value?.planCompletion?.rate ?? 0)
const overdueCount = computed(() => planStats.value?.overduePlans?.length ?? 0)
const inProgressCount = computed(() => planStats.value?.planCompletion?.inProgress ?? 0)
const completedCount = computed(() => planStats.value?.planCompletion?.completed ?? 0)
const totalPlans = computed(() => planStats.value?.planCompletion?.total ?? 0)
const topTeachers = computed(() => (planStats.value?.teacherRanking ?? []).slice(0, 5))

interface StatCard {
  label: string
  value: number | string
  icon: string
  color: string
  sub?: string
  accent?: boolean
  accentColor?: string
}

const stats = computed<StatCard[]>(() => [
  { label: '学校账号', value: metrics.value.users, icon: 'i-lucide-users', color: 'blue' },
  { label: '评估记录', value: metrics.value.assessments, icon: 'i-lucide-clipboard-check', color: 'emerald' },
  {
    label: '待处理危机', value: metrics.value.activeCrises, icon: 'i-lucide-siren', color: 'red',
    accent: metrics.value.activeCrises > 0, accentColor: 'red',
  },
  {
    label: '待审批', value: pendingCount.value, icon: 'i-lucide-shield-check', color: 'amber',
    sub: `${pendingCount.value} 访问申请`,
  },
])

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-100' },
  emerald:{ bg: 'bg-emerald-50',text: 'text-emerald-700',border: 'border-emerald-100' },
  red:    { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-100' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-100' },
}

function colorClasses(key: string) {
  const c = colorMap[key] ?? colorMap.blue!
  return [c!.bg, c!.text]
}

const completionStatus = computed(() => {
  if (completionRate.value >= 70) return { color: 'text-green-600', bg: 'bg-green-50' }
  if (completionRate.value >= 40) return { color: 'text-amber-600', bg: 'bg-amber-50' }
  return { color: 'text-red-500', bg: 'bg-red-50' }
})
</script>

<template>
  <ManagementPage title="学校管理后台" description="账号、部门、班级、学生、方案运营与风险管控总览。">

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="s in stats"
        :key="s.label"
        class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300"
      >
        <div class="flex items-start justify-between">
          <div class="min-w-0 flex-1">
            <p
              class="text-2xl font-bold tracking-tight"
              :class="s.accent ? 'text-red-600' : 'text-gray-900'"
            >
              {{ s.value }}
            </p>
            <p class="mt-1 text-sm font-medium text-gray-500">{{ s.label }}</p>
            <p v-if="s.sub" class="mt-0.5 text-xs text-gray-400">{{ s.sub }}</p>
          </div>
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg transition-colors"
            :class="colorClasses(s.color)"
          >
            <UIcon :name="s.icon" class="size-5" />
          </span>
        </div>
      </div>
    </div>

    <!-- 方案执行概览 -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">方案执行概览</h2>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <!-- 完成率 -->
        <div class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-400">完成率</p>
          <div class="mt-3 flex items-end gap-3">
            <span class="text-3xl font-bold tracking-tight" :class="completionStatus.color">
              {{ completionRate }}%
            </span>
            <span class="mb-1 text-sm text-gray-400">{{ completedCount }}/{{ totalPlans }}</span>
          </div>
          <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="completionRate >= 70 ? 'bg-green-500' : completionRate >= 40 ? 'bg-amber-500' : 'bg-red-400'"
              :style="{ width: `${Math.min(completionRate, 100)}%` }"
            />
          </div>
        </div>

        <!-- 执行中 -->
        <div class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-400">执行中</p>
          <p class="mt-3 text-3xl font-bold tracking-tight text-blue-600">{{ inProgressCount }}</p>
          <p class="mt-1 text-sm text-gray-400">个方案进行中</p>
        </div>

        <!-- 超期提醒 -->
        <div class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-400">超期提醒</p>
          <p
            class="mt-3 text-3xl font-bold tracking-tight"
            :class="overdueCount > 0 ? 'text-red-600' : 'text-green-600'"
          >
            {{ overdueCount }}
          </p>
          <p class="mt-1 text-sm text-gray-400">个方案超 7 天未更新</p>
        </div>
      </div>
    </div>

    <!-- 超期方案列表 -->
    <div v-if="planStats?.overduePlans?.length" class="mt-6">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-alert-triangle" class="size-4 text-red-500" />
        <h3 class="text-sm font-semibold text-red-700">需关注的方案</h3>
        <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
          {{ planStats.overduePlans.length }}
        </span>
      </div>
      <div class="mt-3 space-y-2">
        <div
          v-for="plan in planStats.overduePlans.slice(0, 5)"
          :key="plan.id"
          class="group flex items-center justify-between rounded-lg border border-red-100 bg-red-50/60 px-4 py-3 text-sm transition-all hover:bg-red-50 hover:border-red-200"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-red-800">{{ plan.title }}</p>
            <p class="mt-0.5 text-xs text-red-500">{{ plan.teacherName }} · {{ plan.daysSinceUpdate }} 天未更新</p>
          </div>
          <NuxtLink
            :to="`/information/plans/${plan.id}`"
            class="ml-3 shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm ring-1 ring-red-200 transition-all hover:bg-red-600 hover:text-white hover:ring-red-600"
          >
            查看方案
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- 教师执行排名 -->
    <div v-if="topTeachers.length" class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">班主任执行排名（近 7 天）</h2>
      <div class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium text-gray-500">
              <th class="py-3 pl-5 pr-4">教师</th>
              <th class="py-3 pr-4 text-right">负责方案</th>
              <th class="py-3 pr-4 text-right">已完成动作</th>
              <th class="py-3 pr-5 text-right">完成率</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              v-for="(t, i) in topTeachers"
              :key="t.teacherId"
              class="transition-colors hover:bg-gray-50/50"
            >
              <td class="py-3 pl-5 pr-4">
                <span
                  class="mr-2 inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
                  :class="Number(i) < 3 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'"
                >
                  {{ Number(i) + 1 }}
                </span>
                {{ t.teacherName }}
              </td>
              <td class="py-3 pr-4 text-right tabular-nums text-gray-700">{{ t.planCount }}</td>
              <td class="py-3 pr-4 text-right tabular-nums text-green-600 font-medium">{{ t.completedActionCount }}</td>
              <td class="py-3 pr-5 text-right tabular-nums text-gray-700">
                {{ t.totalActionCount ? Math.round((t.completedActionCount / t.totalActionCount) * 100) : 0 }}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 管理原则 -->
    <div class="mt-8 rounded-xl border border-indigo-100 bg-indigo-50/60 p-6">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-book-open" class="size-4 text-indigo-500" />
        <h2 class="text-sm font-semibold text-indigo-800">管理原则</h2>
      </div>
      <ul class="mt-3 space-y-2 text-sm text-indigo-700">
        <li class="flex items-start gap-2">
          <span class="mt-1.5 block size-1.5 shrink-0 rounded-full bg-indigo-400" />
          业务档案不物理删除，使用归档和停用替代
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 block size-1.5 shrink-0 rounded-full bg-indigo-400" />
          敏感数据访问需经过审批授权，最长 30 分钟
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 block size-1.5 shrink-0 rounded-full bg-indigo-400" />
          所有管理员操作记录审计日志，不可篡改
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 block size-1.5 shrink-0 rounded-full bg-indigo-400" />
          危机转介有 SLA 确认时限，超时自动升级
        </li>
      </ul>
    </div>
  </ManagementPage>
</template>
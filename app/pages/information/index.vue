<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

const { data } = await useFetch<any>('/api/v1/information/overview')
const { data: statsData } = await useFetch<any>('/api/v1/information/stats')
const { data: todayData } = await useFetch<any>('/api/v1/workbench/today')

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

const overviewCards = computed(() => {
  const d = data.value
  return [
    { label: '负责班级', value: d?.overviewCards?.[0]?.value ?? 0, hint: d?.overviewCards?.[0]?.hint, icon: 'i-lucide-school',        color: 'blue' },
    { label: '关联家长', value: d?.overviewCards?.[1]?.value ?? 0, hint: d?.overviewCards?.[1]?.hint, icon: 'i-lucide-user-round',    color: 'green' },
    { label: '家校沟通', value: d?.overviewCards?.[2]?.value ?? 0, hint: d?.overviewCards?.[2]?.hint, icon: 'i-lucide-messages-square', color: 'amber' },
    { label: '方案记录', value: d?.overviewCards?.[3]?.value ?? 0, hint: d?.overviewCards?.[3]?.hint, icon: 'i-lucide-clipboard-check', color: 'purple' },
  ]
})

const colorMap: Record<string, { bg: string; text: string }> = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700' },
  green:  { bg: 'bg-green-50',  text: 'text-green-700' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700' },
}

function colorClasses(key: string) {
  const c = colorMap[key] ?? colorMap.blue!
  return [c!.bg, c!.text]
}

const planCompletion = computed(() => {
  const s = statsData.value
  return s?.planCompletion ? `${s.planCompletion.completed}/${s.planCompletion.total}` : '0/0'
})

const planRate = computed(() => {
  const r = statsData.value?.planCompletion?.rate
  return r != null ? r : 0
})

const overdueCount = computed(() => statsData.value?.overduePlans?.length ?? 0)

const rateStatus = computed(() => {
  if (planRate.value >= 70) return { color: 'text-green-600', bar: 'bg-green-500' }
  if (planRate.value >= 40) return { color: 'text-amber-600', bar: 'bg-amber-500' }
  return { color: 'text-red-500', bar: 'bg-red-400' }
})

const todayTodoMetrics = computed(() => {
  const actions = todayData.value?.actions || []
  const reviews = todayData.value?.reviews || []
  const drafts = todayData.value?.drafts || []
  const assignments = todayData.value?.recentAssignments || []
  const unread = todayData.value?.unreadCount || 0
  return {
    unread,
    actions: actions.length,
    overdueActions: actions.filter((item: any) => item.overdue).length,
    reviews: reviews.length,
    drafts: drafts.length,
    assignments: assignments.length,
  }
})
</script>

<template>
  <ManagementPage title="信息中心" description="你所负责的班级、学生、沟通和方案的档案总览。">

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="card in overviewCards"
        :key="card.label"
        class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300"
      >
        <div class="flex items-start justify-between">
          <div class="min-w-0 flex-1">
            <p class="text-2xl font-bold tracking-tight text-gray-900">{{ card.value }}</p>
            <p class="mt-1 text-sm font-medium text-gray-500">{{ card.label }}</p>
            <p v-if="card.hint" class="mt-0.5 text-xs text-gray-400">{{ card.hint }}</p>
          </div>
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg"
            :class="colorClasses(card.color)"
          >
            <UIcon :name="card.icon" class="size-5" />
          </span>
        </div>
      </div>
    </div>

    <!-- 今日待办（持续使用闭环） -->
    <div class="mt-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-emerald-700">持续使用闭环</p>
          <h2 class="mt-1 text-2xl font-semibold text-gray-900">今日待办</h2>
        </div>
        <UButton to="/notifications" color="primary" icon="i-lucide-bell-ring" trailing-icon="i-lucide-arrow-right">进入工作日志</UButton>
      </div>

      <!-- 指标卡片 -->
      <div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="group rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm transition-all hover:shadow-md">
          <div class="mx-auto grid size-10 place-items-center rounded-lg bg-blue-50">
            <UIcon name="i-lucide-bell" class="size-5 text-blue-600" />
          </div>
          <p class="mt-3 text-2xl font-bold tracking-tight text-gray-900">{{ todayTodoMetrics.unread }}</p>
          <p class="mt-1 text-sm font-medium text-gray-500">未读通知</p>
        </div>
        <div class="group rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm transition-all hover:shadow-md">
          <div class="mx-auto grid size-10 place-items-center rounded-lg" :class="todayTodoMetrics.overdueActions ? 'bg-red-50' : 'bg-emerald-50'">
            <UIcon name="i-lucide-clipboard-check" class="size-5" :class="todayTodoMetrics.overdueActions ? 'text-red-600' : 'text-emerald-600'" />
          </div>
          <p class="mt-3 text-2xl font-bold tracking-tight" :class="todayTodoMetrics.overdueActions ? 'text-red-600' : 'text-gray-900'">{{ todayTodoMetrics.actions }}</p>
          <p class="mt-1 text-sm font-medium text-gray-500">
            今日动作
            <span v-if="todayTodoMetrics.overdueActions" class="text-red-500">({{ todayTodoMetrics.overdueActions }} 逾期)</span>
          </p>
        </div>
        <div class="group rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm transition-all hover:shadow-md">
          <div class="mx-auto grid size-10 place-items-center rounded-lg bg-amber-50">
            <UIcon name="i-lucide-rotate-ccw" class="size-5 text-amber-600" />
          </div>
          <p class="mt-3 text-2xl font-bold tracking-tight text-gray-900">{{ todayTodoMetrics.reviews }}</p>
          <p class="mt-1 text-sm font-medium text-gray-500">待复盘</p>
        </div>
        <div class="group rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm transition-all hover:shadow-md">
          <div class="mx-auto grid size-10 place-items-center rounded-lg bg-purple-50">
            <UIcon name="i-lucide-file-text" class="size-5 text-purple-600" />
          </div>
          <p class="mt-3 text-2xl font-bold tracking-tight text-gray-900">{{ todayTodoMetrics.drafts + todayTodoMetrics.assignments }}</p>
          <p class="mt-1 text-sm font-medium text-gray-500">草稿/移交</p>
        </div>
      </div>

      <!-- 待办列表：今日动作 + 待复盘 -->
      <div class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <UIcon name="i-lucide-clipboard-check" class="size-4 text-emerald-600" />今日动作
            </h3>
            <NuxtLink to="/notifications?tab=action" class="text-xs font-medium text-emerald-600 transition hover:text-emerald-800">查看全部</NuxtLink>
          </div>
          <div class="mt-4 space-y-2">
            <NuxtLink v-for="action in todayData?.actions.slice(0, 4)" :key="action.id" :to="`/plans/${action.planId}`" class="flex flex-col gap-1.5 rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/50">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-gray-500">{{ moduleTitle(action.planModule) }}</span>
                <UBadge :color="action.overdue ? 'error' : 'neutral'" variant="soft" size="xs">{{ action.overdue ? '已逾期' : '今日' }}</UBadge>
              </div>
              <p class="line-clamp-2 text-sm leading-5 text-gray-700">{{ action.detail }}</p>
            </NuxtLink>
            <p v-if="!todayData?.actions?.length" class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">暂无到期动作</p>
          </div>
        </div>

        <div class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <UIcon name="i-lucide-rotate-ccw" class="size-4 text-amber-600" />待复盘
            </h3>
            <span v-if="todayTodoMetrics.drafts" class="flex items-center gap-1 text-xs text-gray-400">
              <UIcon name="i-lucide-file-clock" class="size-3" />{{ todayTodoMetrics.drafts }} 份草稿
            </span>
          </div>
          <div class="mt-4 space-y-2">
            <NuxtLink v-for="review in todayData?.reviews.slice(0, 4)" :key="review.id" :to="`/plans/${review.id}`" class="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm transition-colors hover:border-amber-200 hover:bg-amber-50/50">
              <span class="min-w-0 truncate"><strong>{{ review.title }}</strong><small class="ml-1.5 text-gray-400">{{ moduleTitle(review.module) }}</small></span>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-300" />
            </NuxtLink>
            <p v-if="!todayData?.reviews?.length" class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">暂无待复盘方案</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 方案完成率 + 超期方案 -->
    <div class="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- 方案完成率 -->
      <div class="group rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <h3 class="text-base font-semibold text-gray-900">方案完成率</h3>
        <div class="mt-4 flex items-baseline gap-3">
          <span class="text-3xl font-bold tracking-tight text-gray-900">{{ planCompletion }}</span>
          <span class="text-lg font-semibold" :class="rateStatus.color">{{ planRate }}%</span>
        </div>
        <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="rateStatus.bar"
            :style="{ width: `${Math.min(planRate, 100)}%` }"
          />
        </div>
        <p class="mt-2 text-xs text-gray-400">已完成 / 全部方案</p>
      </div>

      <!-- 超期方案 -->
      <div class="group rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold text-gray-900">需关注</h3>
          <span
            v-if="overdueCount > 0"
            class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600"
          >
            {{ overdueCount }}
          </span>
        </div>
        <p
          class="mt-4 text-3xl font-bold tracking-tight"
          :class="overdueCount > 0 ? 'text-red-600' : 'text-green-600'"
        >
          {{ overdueCount }}
        </p>
        <p class="mt-1 text-sm text-gray-400">超期未更新的方案</p>
        <div v-if="statsData?.overduePlans?.length" class="mt-4 space-y-2">
          <div
            v-for="plan in statsData.overduePlans.slice(0, 4)"
            :key="plan.id"
            class="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-sm transition-colors hover:bg-red-50"
          >
            <span class="truncate font-medium text-red-700">{{ plan.title }}</span>
            <span class="ml-2 shrink-0 text-xs text-red-500">{{ plan.daysSinceUpdate }}天</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 近6个月趋势 -->
    <div v-if="statsData?.monthlyAssessments?.length || statsData?.monthlyCommunications?.length" class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">近 6 个月趋势</h2>
      <div class="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap gap-8">
          <div v-if="statsData?.monthlyAssessments?.length">
            <p class="mb-3 text-sm font-medium text-gray-500">评估次数</p>
            <div class="flex items-end gap-2">
              <div
                v-for="(item, i) in statsData.monthlyAssessments"
                :key="i"
                class="group relative"
              >
                <div
                  class="w-9 rounded-t bg-emerald-500 transition-colors hover:bg-emerald-600"
                  :style="{ height: `${Math.max(4, (item.count / Math.max(...statsData.monthlyAssessments.map((m: any) => m.count), 1)) * 80)}px` }"
                  :title="`${item.month}: ${item.count}`"
                />
                <p class="mt-1 text-center text-xs text-gray-400">{{ item.month.slice(5) }}</p>
              </div>
            </div>
          </div>
          <div v-if="statsData?.monthlyCommunications?.length">
            <p class="mb-3 text-sm font-medium text-gray-500">沟通次数</p>
            <div class="flex items-end gap-2">
              <div
                v-for="(item, i) in statsData.monthlyCommunications"
                :key="i"
                class="group relative"
              >
                <div
                  class="w-9 rounded-t bg-amber-500 transition-colors hover:bg-amber-600"
                  :style="{ height: `${Math.max(4, (item.count / Math.max(...statsData.monthlyCommunications.map((m: any) => m.count), 1)) * 80)}px` }"
                  :title="`${item.month}: ${item.count}`"
                />
                <p class="mt-1 text-center text-xs text-gray-400">{{ item.month.slice(5) }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </ManagementPage>
</template>
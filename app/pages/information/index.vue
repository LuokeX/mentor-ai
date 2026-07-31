<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

const { data } = await useFetch<any>('/api/v1/information/overview')
const { data: statsData } = await useFetch<any>('/api/v1/information/stats')

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

    <!-- 最近评估 -->
    <div v-if="data?.assessments?.length" class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">最近评估</h2>
      <div class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div class="divide-y divide-gray-50">
          <!-- 整行可点：报告一直存在 assessment_attempts.result.report 里，
               此前没有任何入口能把它重新打开。 -->
          <NuxtLink
            v-for="a in data.assessments.slice(0, 5)"
            :key="a.id"
            :to="`/information/assessments/${a.id}`"
            class="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-gray-50/50"
          >
            <div>
              <p class="font-medium text-gray-900">{{ moduleTitle(a.module) }}</p>
              <p class="text-sm text-gray-400">
                {{ a.submittedAt ? new Date(a.submittedAt).toLocaleString('zh-CN') : '未提交' }}
                <span v-if="a.planId" class="ml-2 font-medium text-green-600">已有方案</span>
              </p>
            </div>
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-medium"
              :style="{ backgroundColor: a.levelColor || '#e2e8f0', color: '#475569' }"
            >
              {{ a.levelLabel || '—' }}
            </span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </ManagementPage>
</template>
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
    { label: '负责班级', value: d?.overviewCards?.[0]?.value ?? 0, hint: d?.overviewCards?.[0]?.hint, color: 'bg-blue-50 text-blue-700', icon: 'i-lucide-school' },
    { label: '关联家长', value: d?.overviewCards?.[1]?.value ?? 0, hint: d?.overviewCards?.[1]?.hint, color: 'bg-green-50 text-green-700', icon: 'i-lucide-user-round' },
    { label: '家校沟通', value: d?.overviewCards?.[2]?.value ?? 0, hint: d?.overviewCards?.[2]?.hint, color: 'bg-amber-50 text-amber-700', icon: 'i-lucide-messages-square' },
    { label: '方案记录', value: d?.overviewCards?.[3]?.value ?? 0, hint: d?.overviewCards?.[3]?.hint, color: 'bg-purple-50 text-purple-700', icon: 'i-lucide-clipboard-check' },
  ]
})

const planCompletion = computed(() => {
  const s = statsData.value
  return s?.planCompletion ? `${s.planCompletion.completed}/${s.planCompletion.total}` : '0/0'
})

const planRate = computed(() => {
  const r = statsData.value?.planCompletion?.rate
  return r != null ? `${r}%` : '—'
})

const overdueCount = computed(() => statsData.value?.overduePlans?.length ?? 0)
</script>

<template>
  <ManagementPage title="信息中心" description="你所负责的班级、学生、沟通和方案的档案总览。">
    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="card in overviewCards"
        :key="card.label"
        class="rounded-xl border border-slate-200 p-5"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="text-2xl font-semibold">{{ card.value }}</p>
            <p class="mt-1 text-sm font-medium text-slate-600">{{ card.label }}</p>
            <p v-if="card.hint" class="mt-0.5 text-xs text-slate-400">{{ card.hint }}</p>
          </div>
          <span class="grid size-9 place-items-center rounded-lg" :class="card.color">
            <UIcon :name="card.icon" />
          </span>
        </div>
      </div>
    </div>

    <!-- 趋势与统计 -->
    <div class="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 方案完成率 -->
      <div class="rounded-xl border border-slate-200 p-6">
        <h3 class="text-sm font-semibold">方案完成率</h3>
        <div class="mt-4 flex items-baseline gap-2">
          <span class="text-3xl font-bold">{{ planCompletion }}</span>
          <span class="text-sm" :class="statsData?.planCompletion?.rate >= 50 ? 'text-green-600' : 'text-amber-600'">
            {{ planRate }}
          </span>
        </div>
        <p class="mt-1 text-xs text-slate-400">已完成 / 全部方案</p>
      </div>

      <!-- 超期方案 -->
      <div class="rounded-xl border border-slate-200 p-6">
        <h3 class="text-sm font-semibold">需关注</h3>
        <div class="mt-4">
          <p class="text-3xl font-bold" :class="overdueCount > 0 ? 'text-red-600' : 'text-green-600'">{{ overdueCount }}</p>
          <p class="mt-1 text-xs text-slate-400">超期未更新的方案</p>
        </div>
        <div v-if="statsData?.overduePlans?.length" class="mt-4 space-y-2">
          <div
            v-for="plan in statsData.overduePlans.slice(0, 5)"
            :key="plan.id"
            class="flex items-center justify-between rounded bg-red-50 px-3 py-1.5 text-xs"
          >
            <span class="font-medium text-red-700 truncate max-w-[200px]">{{ plan.title }}</span>
            <span class="text-red-500">{{ plan.daysSinceUpdate }}天</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 评估与沟通趋势 -->
    <div v-if="statsData?.monthlyAssessments?.length || statsData?.monthlyCommunications?.length" class="mt-10">
      <h2 class="text-lg font-semibold">近6个月趋势</h2>
      <div class="mt-4 rounded-xl border border-slate-200 p-6">
        <div class="flex flex-wrap gap-8">
          <div v-if="statsData?.monthlyAssessments?.length">
            <p class="text-xs font-medium text-slate-500 mb-2">评估次数</p>
            <div class="flex items-end gap-2">
              <div
                v-for="(item, i) in statsData.monthlyAssessments"
                :key="i"
                class="group relative"
              >
                <div class="w-8 rounded-t bg-emerald-500 transition-colors hover:bg-emerald-600"
                     :style="{ height: `${Math.max(4, (item.count / Math.max(...statsData.monthlyAssessments.map((m: any) => m.count), 1)) * 80)}px` }"
                     :title="`${item.month}: ${item.count}`"
                />
                <p class="mt-1 text-center text-[10px] text-slate-400">{{ item.month.slice(5) }}</p>
              </div>
            </div>
          </div>
          <div v-if="statsData?.monthlyCommunications?.length">
            <p class="text-xs font-medium text-slate-500 mb-2">沟通次数</p>
            <div class="flex items-end gap-2">
              <div
                v-for="(item, i) in statsData.monthlyCommunications"
                :key="i"
                class="group relative"
              >
                <div class="w-8 rounded-t bg-amber-500 transition-colors hover:bg-amber-600"
                     :style="{ height: `${Math.max(4, (item.count / Math.max(...statsData.monthlyCommunications.map((m: any) => m.count), 1)) * 80)}px` }"
                     :title="`${item.month}: ${item.count}`"
                />
                <p class="mt-1 text-center text-[10px] text-slate-400">{{ item.month.slice(5) }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近评估 -->
    <div v-if="data?.assessments?.length" class="mt-10">
      <h2 class="text-lg font-semibold">最近评估</h2>
      <div class="mt-4 space-y-2">
        <div
          v-for="a in data.assessments.slice(0, 5)"
          :key="a.id"
          class="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3"
        >
          <div>
            <p class="text-sm font-medium">{{ moduleTitle(a.module) }}</p>
            <p class="text-xs text-slate-400">
              {{ a.submittedAt ? new Date(a.submittedAt).toLocaleString('zh-CN') : '未提交' }}
              <span v-if="a.planId" class="ml-2 text-green-600">已有方案</span>
            </p>
          </div>
          <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" :style="{ backgroundColor: a.levelColor || '#e2e8f0', color: '#475569' }">
            {{ a.levelLabel || '—' }}
          </span>
        </div>
      </div>
    </div>
  </ManagementPage>
</template>
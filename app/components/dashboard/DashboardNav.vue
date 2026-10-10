<script setup lang="ts">
/**
 * 看板页内导航（数据总览 / AI 问答分析 / 量表与方案 / 预警看板）。
 * 默认布局导航只给非教师角色「工作台」入口，看板内部的四个页面靠这里切换。
 * 只渲染当前账号可见的页面（平台后台可逐页取消，context.pages 由服务端下发）。
 */
import type { DashboardContext, DashboardPageKey } from '#shared/dashboard'
import { DASHBOARD_PAGE_KEYS, DASHBOARD_PAGES } from '#shared/dashboard'

const route = useRoute()
const { data: context } = await useFetch<DashboardContext>('/api/v1/dashboard/context')

const fallbackKeys: DashboardPageKey[] = [...DASHBOARD_PAGE_KEYS]
const tabs = computed(() => {
  const allowed = context.value?.pages?.length ? context.value.pages : fallbackKeys
  return DASHBOARD_PAGES.filter(page => allowed.includes(page.key))
})

const isActive = (to: string) => (to === '/dashboard' ? route.path === '/dashboard' : route.path.startsWith(to))
</script>

<template>
  <nav class="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition"
      :class="isActive(tab.to) ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>

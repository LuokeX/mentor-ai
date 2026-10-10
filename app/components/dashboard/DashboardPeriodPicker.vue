<script setup lang="ts">
/**
 * 统计区间选择器（看板页面共用）：起止日期 + 快捷预设 + 超限提示。
 * 预设既可以是滚动窗口（近 N 天），也可以是自然周 / 自然月；
 * 不在组件内做权限判断，只做区间校验提示；服务端仍独立校验。
 */
import type { DashboardPeriodPreset } from '~/composables/useDashboardRange'

const props = defineProps<{
  start: string
  end: string
  presets: DashboardPeriodPreset[]
  rangeError?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:start', value: string): void
  (event: 'update:end', value: string): void
  (event: 'preset', preset: DashboardPeriodPreset): void
}>()
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-xs text-slate-500">开始日期</span>
      <input
        type="date"
        class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
        :value="start"
        @change="emit('update:start', ($event.target as HTMLInputElement).value)"
      >
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-xs text-slate-500">结束日期</span>
      <input
        type="date"
        class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
        :value="end"
        @change="emit('update:end', ($event.target as HTMLInputElement).value)"
      >
    </label>
    <div class="flex flex-wrap gap-1.5 pb-0.5">
      <button
        v-for="preset in props.presets"
        :key="preset.label"
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
        @click="emit('preset', preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <p v-if="rangeError" class="pb-0.5 text-xs text-amber-600">{{ rangeError }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 排行表（纯 HTML + Tailwind，不引入图表依赖）：行内条形按最大值归一，
 * 用于「提问关键词 Top 榜」「方案模块分布」这类排行场景。
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  rows: Array<{ label: string, value: number }>
  valueLabel?: string
  emptyText?: string
  maxRows?: number
}>(), { valueLabel: '次数', emptyText: '暂无数据', maxRows: 10 })

const visible = computed(() => props.rows.slice(0, props.maxRows))
const maxValue = computed(() => Math.max(1, ...visible.value.map(row => row.value)))
</script>

<template>
  <div>
    <ol v-if="visible.length" class="space-y-2.5">
      <li v-for="(row, index) in visible" :key="row.label" class="space-y-1">
        <div class="flex items-center gap-2 text-sm">
          <span class="w-5 text-xs text-slate-400">{{ index + 1 }}</span>
          <span class="flex-1 truncate text-slate-700">{{ row.label }}</span>
          <span class="font-medium text-slate-800">{{ row.value }}</span>
          <span class="text-xs text-slate-400">{{ valueLabel }}</span>
        </div>
        <div class="ml-7 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${(row.value / maxValue) * 100}%` }" />
        </div>
      </li>
    </ol>
    <p v-else class="py-8 text-center text-sm text-slate-400">{{ emptyText }}</p>
  </div>
</template>

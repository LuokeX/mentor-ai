<script setup lang="ts">
/**
 * 图表悬停读数浮层（纯 HTML + Tailwind）：折线图与分组柱状图共用。
 * 只负责展示与定位，指针事件由图表本体处理，因此 pointer-events-none。
 */
import { computed } from 'vue'

interface TooltipItem {
  name: string
  /** null 表示该天没有数据（如心跳未上线），显示「—」 */
  value: number | null
  color: string
}

const props = withDefaults(defineProps<{
  /** 命中点在图表宽度上的位置（百分比 0-100） */
  xPercent: number
  /** 命中点在图表高度上的位置（百分比 0-100），让浮层贴近指针 */
  yPercent?: number
  label?: string
  items: TooltipItem[]
  /** 数值后缀，如 % 或 条 */
  suffix?: string
}>(), { yPercent: 50, label: '', suffix: '' })

/** 贴近左右边缘时改变对齐方式，避免浮层被容器裁掉。 */
const transform = computed(() => {
  const xPercent = props.xPercent
  const translateX = xPercent < 12 ? '0' : xPercent > 88 ? '-100%' : '-50%'
  return `translate(${translateX}, -50%)`
})

/** 垂直方向留出浮层自身高度，避免贴住上下边缘。 */
const topPercent = computed(() => Math.min(90, Math.max(10, props.yPercent)))
</script>

<template>
  <div
    class="pointer-events-none absolute z-10 min-w-max max-w-56 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
    :style="{ left: `${xPercent}%`, top: `${topPercent}%`, transform }"
    role="presentation"
  >
    <p v-if="label" class="mb-1 font-medium text-slate-700">{{ label }}</p>
    <ul class="space-y-0.5">
      <li v-for="item in items" :key="item.name" class="flex items-center gap-2 text-slate-600">
        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
        <span class="whitespace-nowrap">{{ item.name }}</span>
        <span class="ml-auto pl-2 font-medium tabular-nums text-slate-800">{{ item.value === null ? '—' : `${item.value}${suffix}` }}</span>
      </li>
    </ul>
  </div>
</template>

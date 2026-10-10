<script setup lang="ts">
/**
 * 环形占比图（纯 SVG，不引入图表依赖）：按 stroke-dasharray 画弧，中心显示合计。
 * 用于「提问分类分布」「方案风险等级分布」这类占比场景。
 */
import { computed } from 'vue'

interface DonutSegment {
  label: string
  value: number
  color?: string
}

const props = withDefaults(defineProps<{
  segments: DonutSegment[]
  centerLabel?: string
  size?: number
  emptyText?: string
}>(), { centerLabel: '总计', size: 168, emptyText: '暂无数据' })

const PALETTE = ['#059669', '#0284c7', '#d97706', '#7c3aed', '#db2777', '#64748b']
const RADIUS = 60
const STROKE = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const total = computed(() => props.segments.reduce((sum, item) => sum + item.value, 0))
const hasData = computed(() => total.value > 0)

const arcs = computed(() => {
  let consumed = 0
  return props.segments.map((segment, index) => {
    const fraction = total.value > 0 ? segment.value / total.value : 0
    const length = fraction * CIRCUMFERENCE
    const arc = {
      label: segment.label,
      value: segment.value,
      color: segment.color ?? PALETTE[index % PALETTE.length],
      dash: `${length} ${Math.max(0, CIRCUMFERENCE - length)}`,
      offset: -consumed,
      percent: Math.round(fraction * 1000) / 10
    }
    consumed += length
    return arc
  })
})
</script>

<template>
  <div class="flex flex-col items-center gap-4 sm:flex-row">
    <svg :viewBox="`0 0 160 160`" :width="size" :height="size" class="shrink-0" role="img" aria-label="占比环形图">
      <g transform="rotate(-90 80 80)">
        <circle cx="80" cy="80" :r="RADIUS" fill="none" stroke="#f1f5f9" :stroke-width="STROKE" />
        <circle
          v-for="arc in hasData ? arcs : []"
          :key="arc.label"
          cx="80"
          cy="80"
          :r="RADIUS"
          fill="none"
          :stroke="arc.color"
          :stroke-width="STROKE"
          :stroke-dasharray="arc.dash"
          :stroke-dashoffset="arc.offset"
        />
      </g>
      <text x="80" y="76" text-anchor="middle" font-size="10" fill="#94a3b8">{{ centerLabel }}</text>
      <text x="80" y="94" text-anchor="middle" font-size="18" font-weight="600" fill="#1e293b">{{ total }}</text>
    </svg>
    <ul class="w-full space-y-1.5 text-sm">
      <li v-for="arc in arcs" :key="`legend-${arc.label}`" class="flex items-center gap-2">
        <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: arc.color }" />
        <span class="flex-1 truncate text-slate-600">{{ arc.label }}</span>
        <span class="font-medium text-slate-800">{{ arc.value }}</span>
        <span class="w-12 text-right text-xs text-slate-400">{{ arc.percent }}%</span>
      </li>
      <li v-if="!hasData" class="py-2 text-center text-sm text-slate-400">{{ emptyText }}</li>
    </ul>
  </div>
</template>

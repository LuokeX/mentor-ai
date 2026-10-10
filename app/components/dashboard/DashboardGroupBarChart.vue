<script setup lang="ts">
/**
 * 分组柱状图（纯 SVG，不引入图表依赖）：同一 X 刻度下并列展示多个序列，
 * 用于「每日方案数」「每日预警数」这类按日计数。
 */
import { computed } from 'vue'

interface BarSeries {
  name: string
  values: number[]
  color?: string
}

const props = withDefaults(defineProps<{
  labels: string[]
  series: BarSeries[]
  height?: number
  emptyText?: string
}>(), { height: 220, emptyText: '所选区间暂无数据' })

const PALETTE = ['#059669', '#0284c7', '#d97706', '#7c3aed']
const VIEW_W = 720
const PAD = { top: 16, right: 16, bottom: 26, left: 44 }
const GRID_TICKS = 4

const colored = computed(() => props.series.map((item, index) => ({ ...item, color: item.color ?? PALETTE[index % PALETTE.length] })))
const hasData = computed(() => props.labels.length > 0 && colored.value.some(item => item.values.some(value => value > 0)))
const innerW = VIEW_W - PAD.left - PAD.right
const innerH = computed(() => props.height - PAD.top - PAD.bottom)

function niceMax(raw: number): number {
  if (raw <= 0) return 1
  const exponent = Math.floor(Math.log10(raw))
  const base = 10 ** exponent
  const normalized = raw / base
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * base
}

const maxValue = computed(() => niceMax(Math.max(0, ...colored.value.flatMap(item => item.values))))
const ticks = computed(() => Array.from({ length: GRID_TICKS + 1 }, (_, index) => {
  const ratio = index / GRID_TICKS
  return { value: Math.round(maxValue.value * ratio), y: PAD.top + innerH.value * (1 - ratio) }
}))

const slotWidth = computed(() => (props.labels.length ? innerW / props.labels.length : innerW))
const barWidth = computed(() => {
  const count = Math.max(1, colored.value.length)
  return Math.max(2, Math.min(18, (slotWidth.value * 0.6) / count))
})
const labelStep = computed(() => Math.max(1, Math.ceil(props.labels.length / 7)))
const shortLabel = (label: string) => (label.length === 10 ? label.slice(5) : label)

function barX(labelIndex: number, seriesIndex: number): number {
  const slotStart = PAD.left + labelIndex * slotWidth.value
  const groupWidth = barWidth.value * colored.value.length
  return slotStart + (slotWidth.value - groupWidth) / 2 + seriesIndex * barWidth.value
}
function barHeight(value: number): number {
  return Math.max(value > 0 ? 1.5 : 0, (value / maxValue.value) * innerH.value)
}
</script>

<template>
  <div class="w-full">
    <div v-if="hasData" class="w-full overflow-hidden">
      <svg :viewBox="`0 0 ${VIEW_W} ${height}`" class="w-full" :style="{ height: `${height}px` }" role="img" aria-label="分组柱状图">
        <g v-for="tick in ticks" :key="`grid-${tick.y}`">
          <line :x1="PAD.left" :x2="VIEW_W - PAD.right" :y1="tick.y" :y2="tick.y" stroke="#e2e8f0" stroke-width="1" />
          <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end" font-size="10" fill="#94a3b8">{{ tick.value }}</text>
        </g>
        <g v-for="(item, seriesIndex) in colored" :key="item.name">
          <rect
            v-for="(value, labelIndex) in item.values"
            :key="`${item.name}-${labelIndex}`"
            :x="barX(labelIndex, seriesIndex)"
            :y="PAD.top + innerH - barHeight(value)"
            :width="barWidth"
            :height="barHeight(value)"
            :fill="item.color"
            rx="2"
          />
        </g>
        <text
          v-for="(label, index) in labels"
          v-show="index % labelStep === 0 || index === labels.length - 1"
          :key="`x-${label}`"
          :x="PAD.left + index * slotWidth + slotWidth / 2"
          :y="height - 8"
          text-anchor="middle"
          font-size="10"
          fill="#94a3b8"
        >{{ shortLabel(label) }}</text>
      </svg>
    </div>
    <p v-else class="py-10 text-center text-sm text-slate-400">{{ emptyText }}</p>
    <ul v-if="hasData" class="mt-2 flex flex-wrap gap-4 px-1 text-xs text-slate-500">
      <li v-for="item in colored" :key="`legend-${item.name}`" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: item.color }" />
        {{ item.name }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 折线图（纯 SVG，不引入图表依赖）：多序列、自适应 Y 轴刻度、空数据兜底。
 * labels 为 X 轴刻度（看板传自然日 YYYY-MM-DD，展示裁剪为 MM-DD）。
 */
import { computed } from 'vue'

interface LineSeries {
  name: string
  values: number[]
  color?: string
}

const props = withDefaults(defineProps<{
  labels: string[]
  series: LineSeries[]
  height?: number
  emptyText?: string
  /** 数值后缀，如 % 或 条 */
  suffix?: string
}>(), { height: 220, emptyText: '所选区间暂无数据', suffix: '' })

const PALETTE = ['#059669', '#0284c7', '#d97706', '#7c3aed', '#db2777']
const VIEW_W = 720
const PAD = { top: 16, right: 16, bottom: 26, left: 44 }
const GRID_TICKS = 4

const colored = computed(() => props.series.map((item, index) => ({ ...item, color: item.color ?? PALETTE[index % PALETTE.length] })))
const hasData = computed(() => props.labels.length > 0 && colored.value.some(item => item.values.some(value => value > 0)))
const innerW = VIEW_W - PAD.left - PAD.right
const innerH = computed(() => props.height - PAD.top - PAD.bottom)

/** Y 轴取整：1/2/5 × 10^n，避免刻度出现 3.7 这类零碎值。 */
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

const xOf = (index: number) => {
  if (props.labels.length <= 1) return PAD.left + innerW / 2
  return PAD.left + (index * innerW) / (props.labels.length - 1)
}
const yOf = (value: number) => PAD.top + innerH.value * (1 - value / maxValue.value)

const lines = computed(() => colored.value.map(item => ({
  ...item,
  points: item.values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' ')
})))

/** X 轴标签最多显示 7 个，避免挤在一起。 */
const labelStep = computed(() => Math.max(1, Math.ceil(props.labels.length / 7)))
const shortLabel = (label: string) => (label.length === 10 ? label.slice(5) : label)
</script>

<template>
  <div class="w-full">
    <div v-if="hasData" class="w-full overflow-hidden">
      <svg :viewBox="`0 0 ${VIEW_W} ${height}`" class="w-full" :style="{ height: `${height}px` }" role="img" aria-label="趋势折线图">
        <g v-for="tick in ticks" :key="`grid-${tick.y}`">
          <line :x1="PAD.left" :x2="VIEW_W - PAD.right" :y1="tick.y" :y2="tick.y" stroke="#e2e8f0" stroke-width="1" />
          <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end" font-size="10" fill="#94a3b8">{{ tick.value }}</text>
        </g>
        <g v-for="(line, index) in lines" :key="line.name">
          <polyline :points="line.points" fill="none" :stroke="line.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <template v-if="labels.length <= 31">
            <circle
              v-for="(point, pointIndex) in line.points.split(' ')"
              :key="`${index}-${pointIndex}`"
              :cx="point.split(',')[0]"
              :cy="point.split(',')[1]"
              r="2.5"
              :fill="line.color"
            />
          </template>
        </g>
        <text
          v-for="(label, index) in labels"
          v-show="index % labelStep === 0 || index === labels.length - 1"
          :key="`x-${label}`"
          :x="xOf(index)"
          :y="height - 8"
          text-anchor="middle"
          font-size="10"
          fill="#94a3b8"
        >{{ shortLabel(label) }}</text>
      </svg>
    </div>
    <p v-else class="py-10 text-center text-sm text-slate-400">{{ emptyText }}</p>
    <ul v-if="hasData" class="mt-2 flex flex-wrap gap-4 px-1 text-xs text-slate-500">
      <li v-for="line in lines" :key="`legend-${line.name}`" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: line.color }" />
        {{ line.name }}<span v-if="suffix" class="text-slate-400">（{{ suffix }}）</span>
      </li>
    </ul>
  </div>
</template>

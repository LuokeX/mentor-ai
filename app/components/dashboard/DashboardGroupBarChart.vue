<script setup lang="ts">
/**
 * 分组柱状图（纯 SVG，不引入图表依赖）：同一 X 刻度下并列展示多个序列，
 * 用于「每日方案数」「每日预警数」这类按日计数；悬停高亮该刻度并给出读数。
 * viewBox 宽度按容器实测铺满，避免窄列留白，也让悬停命中区与图形一致。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

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
/** 未测量宽度前的兜底 viewBox 宽度（与容器实测宽度一致后不再缩放） */
const FALLBACK_W = 720
const PAD = { top: 16, right: 16, bottom: 26, left: 44 }
const GRID_TICKS = 4

const svgRef = ref<SVGSVGElement | null>(null)
const viewW = ref(FALLBACK_W)
let resizeObserver: ResizeObserver | null = null

/** 图表只在有数据时渲染，svg 出现后再测量宽度，并跟随容器宽度变化（卡片宽度随布局变）。 */
watch(svgRef, (svg) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!svg) return
  const measure = () => {
    const width = svg.getBoundingClientRect().width
    if (width > 0) viewW.value = width
  }
  measure()
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(svg)
}, { flush: 'post' })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

const colored = computed(() => props.series.map((item, index) => ({ ...item, color: item.color ?? PALETTE[index % PALETTE.length]! })))
const hasData = computed(() => props.labels.length > 0 && colored.value.some(item => item.values.some(value => value > 0)))
const innerW = computed(() => Math.max(1, viewW.value - PAD.left - PAD.right))
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

const slotWidth = computed(() => (props.labels.length ? innerW.value / props.labels.length : innerW.value))
/** 柱子占槽位约 60%，上限随容器宽度放宽（铺满后槽位更宽，18px 会显得过细）。 */
const barWidth = computed(() => {
  const count = Math.max(1, colored.value.length)
  return Math.max(2, Math.min(30, (slotWidth.value * 0.6) / count))
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

/** 悬停读数：命中刻度索引 + 指针垂直位置（百分比），指针移出后清空。 */
const hoverIndex = ref<number | null>(null)
const hoverYPercent = ref(50)

const hover = computed(() => {
  const index = hoverIndex.value
  if (index === null || index < 0 || index >= props.labels.length) return null
  const slotStart = PAD.left + index * slotWidth.value
  return {
    index,
    x: slotStart,
    xPercent: ((slotStart + slotWidth.value / 2) / viewW.value) * 100,
    label: props.labels[index] ?? '',
    items: colored.value.map(item => ({ name: item.name, value: item.values[index] ?? 0, color: item.color }))
  }
})

/**
 * 指针位置换算：svg 按 viewBox 等比缩放（preserveAspectRatio 默认 meet）并居中，
 * 宽度尚未测量或容器比例不同时会有缩放与留白，直接按元素尺寸换算会偏移。
 */
function pointerPosition(event: PointerEvent) {
  const box = (event.currentTarget as SVGRectElement).ownerSVGElement?.getBoundingClientRect()
  if (!box || box.width <= 0 || box.height <= 0) return null
  const scale = Math.min(box.width / viewW.value, box.height / props.height)
  if (scale <= 0) return null
  return {
    x: (event.clientX - box.left - (box.width - viewW.value * scale) / 2) / scale,
    yPercent: ((event.clientY - box.top) / box.height) * 100
  }
}

/** 命中区覆盖整个图，按指针所在槽位吸附，柱子很窄或点在留白处也好点中。 */
function onPointerMove(event: PointerEvent) {
  const point = pointerPosition(event)
  if (!point || !props.labels.length) return
  hoverIndex.value = Math.min(props.labels.length - 1, Math.max(0, Math.floor((point.x - PAD.left) / slotWidth.value)))
  hoverYPercent.value = point.yPercent
}

function clearHover() {
  hoverIndex.value = null
}
</script>

<template>
  <div class="w-full">
    <div v-if="hasData" class="relative w-full">
      <svg ref="svgRef" :viewBox="`0 0 ${viewW} ${height}`" class="block w-full" :style="{ height: `${height}px` }" role="img" aria-label="分组柱状图">
        <g v-for="tick in ticks" :key="`grid-${tick.y}`">
          <line :x1="PAD.left" :x2="viewW - PAD.right" :y1="tick.y" :y2="tick.y" stroke="#e2e8f0" stroke-width="1" />
          <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end" font-size="10" fill="#94a3b8">{{ tick.value }}</text>
        </g>
        <rect
          v-if="hover"
          :x="hover.x"
          :y="PAD.top"
          :width="slotWidth"
          :height="innerH"
          fill="#f1f5f9"
        />
        <g v-for="(item, seriesIndex) in colored" :key="item.name">
          <rect
            v-for="(value, labelIndex) in item.values"
            :key="`${item.name}-${labelIndex}`"
            :x="barX(labelIndex, seriesIndex)"
            :y="PAD.top + innerH - barHeight(value)"
            :width="barWidth"
            :height="barHeight(value)"
            :fill="item.color"
            :opacity="hover && hover.index !== labelIndex ? 0.25 : 1"
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
        <rect
          x="0"
          y="0"
          :width="viewW"
          :height="height"
          fill="transparent"
          pointer-events="all"
          class="cursor-crosshair"
          @pointermove="onPointerMove"
          @pointerleave="clearHover"
        />
      </svg>
      <DashboardChartTooltip
        v-if="hover"
        :x-percent="hover.xPercent"
        :y-percent="hoverYPercent"
        :label="hover.label"
        :items="hover.items"
      />
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

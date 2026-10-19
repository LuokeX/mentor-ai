<script setup lang="ts">
/**
 * 折线图（纯 SVG，不引入图表依赖）：多序列、自适应 Y 轴刻度、空数据兜底、悬停读数。
 * labels 为 X 轴刻度（看板传自然日 YYYY-MM-DD，展示裁剪为 MM-DD）。
 * viewBox 宽度按容器实测铺满，避免窄列留白，也让悬停命中区与图形一致。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface LineSeries {
  name: string
  /** null 表示该天没有数据（如心跳未上线），折线在该点断开，悬停显示「—」 */
  values: Array<number | null>
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
const hasData = computed(() => props.labels.length > 0 && colored.value.some(item => item.values.some(value => value !== null && value > 0)))
const innerW = computed(() => Math.max(1, viewW.value - PAD.left - PAD.right))
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

const maxValue = computed(() => niceMax(Math.max(0, ...colored.value.flatMap(item => item.values.filter((value): value is number => value !== null)))))
const ticks = computed(() => Array.from({ length: GRID_TICKS + 1 }, (_, index) => {
  const ratio = index / GRID_TICKS
  return { value: Math.round(maxValue.value * ratio), y: PAD.top + innerH.value * (1 - ratio) }
}))

const xOf = (index: number) => {
  if (props.labels.length <= 1) return PAD.left + innerW.value / 2
  return PAD.left + (index * innerW.value) / (props.labels.length - 1)
}
const yOf = (value: number) => PAD.top + innerH.value * (1 - value / maxValue.value)

interface ChartSegment {
  key: string
  name: string
  color: string
  points: string
}

/** 折线按非空值切段：null 处断开，避免把「无数据」画成 0。 */
const segments = computed<ChartSegment[]>(() => colored.value.flatMap((item, seriesIndex) => {
  const result: ChartSegment[] = []
  let points: string[] = []
  const flush = () => {
    if (!points.length) return
    result.push({ key: `${seriesIndex}-${result.length}`, name: item.name, color: item.color, points: points.join(' ') })
    points = []
  }
  item.values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      flush()
      return
    }
    points.push(`${xOf(index)},${yOf(value)}`)
  })
  flush()
  return result
}))

/** X 轴标签最多显示 7 个，避免挤在一起。 */
const labelStep = computed(() => Math.max(1, Math.ceil(props.labels.length / 7)))
const shortLabel = (label: string) => (label.length === 10 ? label.slice(5) : label)

/** 悬停读数：命中刻度索引 + 指针垂直位置（百分比），指针移出后清空。 */
const hoverIndex = ref<number | null>(null)
const hoverYPercent = ref(50)

const hover = computed(() => {
  const index = hoverIndex.value
  if (index === null || index < 0 || index >= props.labels.length) return null
  const x = xOf(index)
  return {
    x,
    xPercent: (x / viewW.value) * 100,
    label: props.labels[index] ?? '',
    items: colored.value.map(item => ({ name: item.name, value: item.values[index] ?? null, color: item.color }))
  }
})

const hoverDots = computed(() => {
  const index = hoverIndex.value
  if (index === null || index < 0 || index >= props.labels.length) return []
  return colored.value.flatMap(item => {
    const value = item.values[index]
    if (value === null || value === undefined || !Number.isFinite(value)) return []
    return [{ name: item.name, color: item.color, y: yOf(value) }]
  })
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

/** 命中区覆盖整个图，按指针位置就近吸附到最近的刻度，刻度密集或点在留白处也能读到值。 */
function onPointerMove(event: PointerEvent) {
  const point = pointerPosition(event)
  if (!point || !props.labels.length) return
  const lastIndex = props.labels.length - 1
  hoverIndex.value = lastIndex <= 0
    ? 0
    : Math.min(lastIndex, Math.max(0, Math.round(((point.x - PAD.left) / innerW.value) * lastIndex)))
  hoverYPercent.value = point.yPercent
}

function clearHover() {
  hoverIndex.value = null
}
</script>

<template>
  <div class="w-full">
    <div v-if="hasData" class="relative w-full">
      <svg ref="svgRef" :viewBox="`0 0 ${viewW} ${height}`" class="block w-full" :style="{ height: `${height}px` }" role="img" aria-label="趋势折线图">
        <g v-for="tick in ticks" :key="`grid-${tick.y}`">
          <line :x1="PAD.left" :x2="viewW - PAD.right" :y1="tick.y" :y2="tick.y" stroke="#e2e8f0" stroke-width="1" />
          <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end" font-size="10" fill="#94a3b8">{{ tick.value }}</text>
        </g>
        <g v-for="segment in segments" :key="segment.key">
          <polyline :points="segment.points" fill="none" :stroke="segment.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <template v-if="labels.length <= 31">
            <circle
              v-for="(point, pointIndex) in segment.points.split(' ')"
              :key="`${segment.key}-${pointIndex}`"
              :cx="point.split(',')[0]"
              :cy="point.split(',')[1]"
              r="2.5"
              :fill="segment.color"
            />
          </template>
        </g>
        <template v-if="hover">
          <line
            :x1="hover.x"
            :x2="hover.x"
            :y1="PAD.top"
            :y2="PAD.top + innerH"
            stroke="#94a3b8"
            stroke-width="1"
            stroke-dasharray="3 3"
          />
          <circle
            v-for="dot in hoverDots"
            :key="`hover-${dot.name}`"
            :cx="hover.x"
            :cy="dot.y"
            r="4"
            :fill="dot.color"
            stroke="#ffffff"
            stroke-width="1.5"
          />
        </template>
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
        :suffix="suffix"
      />
    </div>
    <p v-else class="py-10 text-center text-sm text-slate-400">{{ emptyText }}</p>
    <ul v-if="hasData" class="mt-2 flex flex-wrap gap-4 px-1 text-xs text-slate-500">
      <li v-for="line in colored" :key="`legend-${line.name}`" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: line.color }" />
        {{ line.name }}<span v-if="suffix" class="text-slate-400">（{{ suffix }}）</span>
      </li>
    </ul>
  </div>
</template>

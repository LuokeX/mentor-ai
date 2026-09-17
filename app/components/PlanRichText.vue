<script setup lang="ts">
/**
 * 方案正文渲染：把「一行一句」的方案纯文本排成有层级的正文。
 *
 * 方案页的「具体实施方案」（建议区）与行动正文（执行区）共用这一个组件，
 * 两处口径一致，避免一边加粗关键词、另一边还是纯文本。
 * 结构化规则集中在 `~/utils/plan-text.ts`（纯函数、有单测），本组件只负责样式。
 */
import type { PlanTextBlock } from '~/utils/plan-text'

const props = defineProps<{
  /** 方案正文原文：三库机械条目或 AI 改写后的「人话版」 */
  text?: string | null
  /** 紧凑排版：方案执行区等次级位置使用 */
  dense?: boolean
  /** 弱化正文颜色：与父级次要说明的灰度保持一致 */
  muted?: boolean
}>()

const blocks = computed(() => parsePlanText(props.text))

const rootClass = computed(() => [
  props.dense ? 'space-y-1 text-xs leading-5' : 'space-y-1.5 text-sm leading-7',
  props.muted ? 'text-slate-500' : 'text-slate-700',
])

const headingClass = computed(() => (props.muted ? 'text-slate-700' : 'text-slate-900'))

const keywordClass = computed(() => (props.muted ? 'text-slate-700' : 'text-slate-900'))

function blockClass(block: PlanTextBlock): string {
  if (block.kind === 'heading') return `flex items-start gap-1.5 font-semibold ${headingClass.value}`
  if (block.kind === 'subheading') {
    return 'flex items-start gap-1.5 rounded-lg border-l-2 border-emerald-400 bg-emerald-50/60 px-2.5 py-1 font-medium text-emerald-800'
  }
  if (block.kind === 'step') return 'flex items-start gap-1.5'
  return ''
}

function markerClass(block: PlanTextBlock): string {
  if (block.kind === 'heading') return 'shrink-0 select-none text-indigo-500'
  if (block.kind === 'subheading') return 'shrink-0 select-none text-emerald-500'
  return 'shrink-0 select-none tabular-nums text-slate-400'
}
</script>

<template>
  <div v-if="blocks.length" :class="rootClass">
    <p
      v-for="(block, index) in blocks"
      :key="index"
      :class="blockClass(block)"
    >
      <span v-if="block.marker" :class="markerClass(block)" aria-hidden="true">{{ block.marker }}</span>
      <span class="min-w-0">
        <template v-for="(segment, segmentIndex) in block.segments" :key="segmentIndex">
          <strong v-if="segment.emphasis === 'keyword'" class="font-semibold" :class="keywordClass">{{ segment.text }}</strong>
          <span v-else-if="segment.emphasis === 'label'" class="font-medium" :class="headingClass">{{ segment.text }}</span>
          <span v-else-if="segment.emphasis === 'quote'" class="text-emerald-700">{{ segment.text }}</span>
          <template v-else>{{ segment.text }}</template>
        </template>
      </span>
    </p>
  </div>
</template>

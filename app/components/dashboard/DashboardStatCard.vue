<script setup lang="ts">
/**
 * 看板指标卡：数值为空（分母为 0 的比率）显示「—」，并可用 hint 标注口径。
 * 可选 delta 展示环比（文本与方向由调用方算好，卡片只负责呈现与配色）。
 */
const props = withDefaults(defineProps<{
  label: string
  value: number | string | null | undefined
  unit?: string
  hint?: string
  /** 环比文案：如「较上期 ↑ 12.4%」；tone 决定颜色（positive 绿 / negative 红 / neutral 灰） */
  delta?: { text: string, tone: 'positive' | 'negative' | 'neutral' } | null
}>(), { unit: '', hint: '', delta: null })

const display = computed(() => (props.value === null || props.value === undefined || props.value === '' ? '—' : props.value))

const deltaClass = computed(() => {
  if (props.delta?.tone === 'positive') return 'text-emerald-600'
  if (props.delta?.tone === 'negative') return 'text-rose-500'
  return 'text-slate-400'
})
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <p class="text-xs text-slate-500">{{ label }}</p>
    <p class="mt-1 text-2xl font-semibold text-slate-800">
      {{ display }}<span v-if="display !== '—' && unit" class="ml-1 text-sm font-normal text-slate-400">{{ unit }}</span>
    </p>
    <p v-if="delta" class="mt-1 text-[11px] font-medium" :class="deltaClass">{{ delta.text }}</p>
    <p v-if="hint" class="mt-1 text-[11px] leading-4 text-slate-400">{{ hint }}</p>
  </div>
</template>

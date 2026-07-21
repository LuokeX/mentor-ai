<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'
import type { ModuleId } from '#shared/contracts'
import { useModuleScores } from '~/composables/useModuleScores'

const { moduleScores, hasScores } = useModuleScores()

// 按占比排序
const sortedModules = computed<Array<{ id: ModuleId; score: number; title: string; color: string }>>(() => {
  return Object.entries(moduleScores.value)
    .map(([id, score]) => ({
      id: id as ModuleId,
      score,
      title: moduleMeta[id as ModuleId]?.title || id,
      color: getBarColor(score)
    }))
    .sort((a, b) => b.score - a.score)
})

function getBarColor(score: number): string {
  if (score >= 0.5) return 'bg-emerald-500'
  if (score >= 0.2) return 'bg-amber-400'
  return 'bg-slate-300'
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <UIcon name="i-lucide-bar-chart-3" class="size-4 text-emerald-600" />
      <span class="text-xs font-semibold text-slate-500">模块评估占比</span>
    </div>

    <div v-if="!hasScores" class="py-3 text-center text-xs text-slate-400">
      对话后将自动分析
    </div>

    <div v-else class="space-y-2.5">
      <div v-for="item in sortedModules" :key="item.id" class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-600">{{ item.title }}</span>
          <span class="font-mono tabular-nums text-slate-500">{{ percentage(item.score) }}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            :class="item.color"
            class="h-full rounded-full transition-all duration-500 ease-out"
            :style="{ width: percentage(item.score) }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
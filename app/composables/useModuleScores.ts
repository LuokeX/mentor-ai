import type { ModuleId } from '#shared/contracts'

const INITIAL_SCORES: Record<ModuleId, number> = {
  self_growth: 0,
  class_system: 0,
  home_school: 0,
  student_case: 0,
  learning_problem: 0
}

// 全局单例 — 页面切换不清除，满足"不随新对话消失"的需求
const moduleScores = ref<Record<ModuleId, number>>({ ...INITIAL_SCORES })
const hasScores = computed(() => Object.values(moduleScores.value).some(v => v > 0))

export function useModuleScores() {
  function updateScores(scores: Record<string, number>) {
    const next: Record<ModuleId, number> = { ...INITIAL_SCORES }
    for (const [key, value] of Object.entries(scores)) {
      if (key in next) {
        next[key as ModuleId] = Math.round(value * 100) / 100
      }
    }
    moduleScores.value = next
  }

  function resetScores() {
    moduleScores.value = { ...INITIAL_SCORES }
  }

  return {
    moduleScores: readonly(moduleScores),
    hasScores,
    updateScores,
    resetScores
  }
}
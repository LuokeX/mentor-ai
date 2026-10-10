<script setup lang="ts">
/**
 * 数据驾驶舱筛选用的受控多选下拉（班级、量表分类等共用）。
 *
 * 空数组表示「全部」：不勾选任何项即不过滤；选项支持按 group 分组展示（班级按年级分组）。
 * 组件不做权限与数据范围判断，选项由页面按服务端下发的范围构造。
 */
import { computed } from 'vue'

interface DashboardMultiSelectOption {
  value: string
  label: string
  group?: string
}

const props = withDefaults(defineProps<{
  label: string
  options: DashboardMultiSelectOption[]
  modelValue: string[]
  allLabel?: string
}>(), { allLabel: '全部' })

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const grouped = computed(() => {
  const groups = new Map<string, DashboardMultiSelectOption[]>()
  for (const option of props.options) {
    const key = option.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }))
})

const summary = computed(() => {
  if (!props.modelValue.length) return props.allLabel
  if (props.modelValue.length <= 2) {
    return props.modelValue
      .map(value => props.options.find(option => option.value === value)?.label ?? value)
      .join('、')
  }
  return `${props.modelValue.length} 项已选`
})

function toggle(value: string) {
  const next = props.modelValue.includes(value)
    ? props.modelValue.filter(item => item !== value)
    : [...props.modelValue, value]
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-xs text-slate-500">{{ label }}</span>
    <details class="relative">
      <summary class="flex w-44 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        <span class="truncate">{{ summary }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-3.5 shrink-0 text-slate-400" />
      </summary>
      <div class="absolute left-0 z-30 mt-1 max-h-72 w-56 space-y-0.5 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        <p v-if="!options.length" class="px-1.5 py-2 text-xs text-slate-400">暂无可选项</p>
        <template v-for="entry in grouped" :key="entry.group || 'default'">
          <p v-if="entry.group" class="px-1.5 pt-1.5 text-[11px] text-slate-400">{{ entry.group }}</p>
          <label
            v-for="option in entry.items"
            :key="option.value"
            class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              class="size-3.5 rounded border-slate-300"
              :checked="modelValue.includes(option.value)"
              @change="toggle(option.value)"
            >
            <span class="truncate">{{ option.label }}</span>
          </label>
        </template>
        <button
          v-if="modelValue.length"
          type="button"
          class="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-emerald-700 hover:bg-emerald-50"
          @click="emit('update:modelValue', [])"
        >
          清空（恢复全部）
        </button>
      </div>
    </details>
  </div>
</template>

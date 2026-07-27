<script setup lang="ts">
import type { Capability } from '~~/shared/management'

defineProps<{
  columns: Array<{ key: string; label: string; sortable?: boolean; class?: string }>
  rows: Array<Record<string, any> & { _capabilities: Capability[]; id: string }>
  loading?: boolean
  sort?: string
  order?: 'asc' | 'desc'
  selectedIds?: string[]
}>()
const emit = defineEmits<{
  'update:selectedIds': [string[]]
  'sort': [field: string]
  'row-click': [row: Record<string, any>]
}>()
</script>

<template>
  <div class="overflow-x-auto border border-gray-200 rounded-lg">
    <UTable
      :rows="rows"
      :columns="(columns as any)"
      :loading="loading"
      :sort="{ column: sort, direction: order }"
      @update:sort="(s: any) => emit('sort', s.column)"
    >
      <template #empty>
        <div class="py-12 text-center text-gray-500 text-sm">暂无数据</div>
      </template>
    </UTable>
  </div>
</template>
<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { ManagedColumn, ManagedRow } from '~~/shared/management'

const props = defineProps<{
  columns: ManagedColumn[]
  rows: ManagedRow[]
  loading?: boolean
  sort?: string
  order?: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  'sort': [field: string]
  'row-click': [row: ManagedRow]
}>()

const tableColumns = computed<TableColumn<ManagedRow>[]>(() => props.columns.map(column => ({
  accessorKey: column.key,
  header: column.label,
  enableSorting: column.sortable === true,
  meta: {
    class: {
      th: [
        column.class,
        column.mobileHidden ? 'hidden md:table-cell' : '',
      ].filter(Boolean).join(' '),
      td: [
        column.class,
        column.mobileHidden ? 'hidden md:table-cell' : '',
      ].filter(Boolean).join(' '),
    },
  },
})))

const sorting = computed(() => props.sort
  ? [{ id: props.sort, desc: props.order === 'desc' }]
  : [])

function onSortingChange(value: Array<{ id: string; desc: boolean }> | undefined) {
  const next = value?.[0]
  if (next?.id) emit('sort', next.id)
}

function onSelect(_event: Event, row: TableRow<ManagedRow>) {
  emit('row-click', row.original)
}
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
    <UTable
      :data="rows"
      :columns="tableColumns"
      :loading="loading"
      :sorting="sorting"
      :sorting-options="{ manualSorting: true }"
      sticky="header"
      :get-row-id="row => row.id"
      :ui="{
        th: 'whitespace-nowrap bg-gray-50/95 text-xs font-semibold text-gray-600',
        td: 'whitespace-nowrap text-sm text-gray-700',
        tr: 'hover:bg-primary-50/40',
      }"
      @update:sorting="onSortingChange"
      @select="onSelect"
    >
      <template
        v-for="column in columns"
        :key="column.key"
        #[`${column.key}-cell`]="scope"
      >
        <slot
          :name="`${column.key}-data`"
          :row="scope.row.original"
          :value="scope.getValue()"
        >
          {{ scope.getValue() ?? '—' }}
        </slot>
      </template>
      <template #empty>
        <div class="py-12 text-center text-gray-500 text-sm">暂无数据</div>
      </template>
    </UTable>
  </div>
</template>

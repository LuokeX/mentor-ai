<script setup lang="ts" generic="T extends ManagedRowBase">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { ManagedColumn, ManagedRowBase } from '~~/shared/management'

const props = defineProps<{
  columns: ManagedColumn[]
  rows: T[]
  loading?: boolean
  sort?: string
  order?: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  'sort': [field: string]
  'row-click': [row: T]
}>()

const tableColumns = computed<TableColumn<T>[]>(() => props.columns.map(column => ({
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

function onSelect(_event: Event, row: TableRow<T>) {
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
        th: 'whitespace-nowrap bg-gray-50/95 text-sm font-semibold text-gray-600',
        td: 'whitespace-nowrap text-base text-gray-700',
        tr: 'hover:bg-primary-50/40',
      }"
      @update:sorting="onSortingChange"
      @select="onSelect"
    >
      <template
        v-for="column in columns"
        :key="column.key"
        #[`${column.key}-header`]="header"
      >
        <button
          v-if="column.sortable"
          type="button"
          class="group inline-flex cursor-pointer items-center gap-1.5 transition hover:text-gray-900"
          :aria-label="`按${column.label}排序`"
          @click="emit('sort', column.key)"
        >
          {{ column.label }}
          <UIcon
            :name="sort === column.key ? (order === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
            class="size-3.5 shrink-0"
            :class="sort === column.key ? 'text-primary-500' : 'opacity-40 group-hover:opacity-70'"
          />
        </button>
        <span v-else>{{ column.label }}</span>
      </template>
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
        <div class="py-12 text-center text-gray-500 text-base">暂无数据</div>
      </template>
    </UTable>
  </div>
</template>

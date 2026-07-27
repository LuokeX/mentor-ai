<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
import type { Capability } from '~~/shared/management'


const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{
  id: string; name: string; grade: number; studentCount: number; status: string; externalCode: string | null; updatedAt: string
}>('/api/v1/information/classes')

const { can } = useCapabilities()

const columns = [
  { key: 'name', label: '班级名称', sortable: true },
  { key: 'grade', label: '年级', sortable: true },
  { key: 'studentCount', label: '学生数', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' },
  { label: '已毕业', value: 'graduated' },
]

const statusLabel = (s: string) => s === 'active' ? '在读' : s === 'archived' ? '已归档' : s === 'graduated' ? '已毕业' : s
</script>

<template>
  <ManagementPage
    title="班级管理"
    description="管理您负责的班级档案"
    :can-create="can('create', pageCapabilities)"
    create-label="创建班级"
  >
    <TableToolbar
      :search-value="q"
      :status-filter="'all'"
      :status-options="statusOptions"
      search-placeholder="搜索班级名称..."
      :loading="loading"
      @search="onSearch"
      @update:status-filter="onStatusChange"
      @refresh="refresh"
    />

    <ManagedDataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      :sort="sort"
      :order="order"
      @sort="onSortChange"
    >
      <template #status-data="{ row }">
        <UBadge :color="row.status === 'active' ? 'success' : row.status === 'archived' ? 'neutral' : 'info'" variant="subtle" size="xs">
          {{ statusLabel(row.status) }}
        </UBadge>
      </template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
        />
      </template>
    </ManagedDataTable>

    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>

    <TablePagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />
  </ManagementPage>
</template>
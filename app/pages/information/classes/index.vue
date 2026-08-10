<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { classStageLabel, classStageColor } = useDisplayLabels()
const { rows, total, page, pageSize, q, statusFilter, sort, order, loading, error, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{
  id: string; name: string; grade: number; studentCount: number; status: string; externalCode: string | null; updatedAt: string
  energyStage: string | null; genderRatio: { male: number; female: number; unknown: number } | null; weakestSystem: string | null
}>('/api/v1/information/classes')

const columns = [
  { key: 'name', label: '班级名称', sortable: true },
  { key: 'grade', label: '年级', sortable: true },
  { key: 'studentCount', label: '学生数', sortable: true },
  { key: 'genderRatio', label: '男女比例' },
  { key: 'energyStage', label: '四阶阶段', sortable: true },
  { key: 'weakestSystem', label: '最薄弱系统' },
  { key: 'status', label: '状态', sortable: true },
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' },
  { label: '已毕业', value: 'graduated' },
]

const statusLabel = (s: string) => s === 'active' ? '在读' : s === 'archived' ? '已归档' : s === 'graduated' ? '已毕业' : s

function openClass(row: { id: string }) {
  void navigateTo(`/information/classes/${row.id}`)
}

const ratioText = (row: any) => {
  const g = row.genderRatio
  if (!g) return '—'
  const total = g.male + g.female
  if (!total) return '—'
  return `${g.male} : ${g.female}`
}
</script>

<template>
  <ManagementPage
    title="负责班级"
    description="管理您负责的班级档案"
    :can-create="false"
  >
    <TableToolbar
      :search-value="q"
      :status-filter="statusFilter"
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
      @row-click="openClass"
    >
      <template #genderRatio-data="{ row }">
        <span class="text-sm text-slate-600">{{ ratioText(row) }}</span>
      </template>
      <template #energyStage-data="{ row }">
        <UBadge v-if="row.energyStage" :color="classStageColor(row.energyStage)" variant="subtle" size="xs">
          {{ classStageLabel(row.energyStage) }}
        </UBadge>
        <span v-else class="text-sm text-slate-300">未评估</span>
      </template>
      <template #weakestSystem-data="{ row }">
        <span class="text-sm text-slate-600">{{ row.weakestSystem || '—' }}</span>
      </template>
      <template #status-data="{ row }">
        <UBadge :color="row.status === 'active' ? 'success' : row.status === 'archived' ? 'neutral' : 'info'" variant="subtle" size="xs">
          {{ statusLabel(row.status) }}
        </UBadge>
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
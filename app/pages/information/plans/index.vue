<script setup lang="ts">
/**
 * 方案列表。
 *
 * 补这一页之前，方案只能从「提交评估后的那一次 CTA」「工作台今日动作」
 * 「事件中心待复盘」三个入口进入。方案一旦不逾期也不待复盘，就再也点不到——
 * 教师做完的工作在系统里等于消失了。
 */
import { moduleMeta } from '#shared/assessments'
import { useManagedList } from '~/composables/useManagedList'

interface PlanRow {
  id: string
  title: string
  module: string
  status: string
  nextReviewAt: string | null
  completedAt: string | null
  updatedAt: string
}

const {
  rows, total, page, pageSize, q, statusFilter, sort, order, loading, error,
  onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh
} = useManagedList<PlanRow>('/api/v1/plans')

const columns = [
  { key: 'title', label: '方案标题', sortable: true },
  { key: 'module', label: '模块' },
  { key: 'status', label: '状态' },
  { key: 'nextReviewAt', label: '复盘日期', sortable: true },
  { key: 'updatedAt', label: '最近更新', sortable: true },
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '待确认', value: 'pending_acceptance' },
  { label: '待复盘', value: 'review_due' },
  { label: '需调整', value: 'adjustment_needed' },
  { label: '需协同', value: 'escalated' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
]

// 与方案详情页保持同一套文案和配色，避免同一状态在两个页面长得不一样
const STATUS_TEXT: Record<string, string> = {
  pending_acceptance: '待确认', accepted: '已接受', in_progress: '进行中',
  review_due: '待复盘', adjustment_needed: '需调整', escalated: '需协同',
  completed: '已完成', closed: '已关闭', archived: '已归档'
}
const STATUS_COLOR: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'error'> = {
  pending_acceptance: 'warning', accepted: 'info', in_progress: 'info',
  review_due: 'warning', adjustment_needed: 'warning', escalated: 'error',
  completed: 'success', closed: 'neutral', archived: 'neutral'
}

const moduleTitle = (module: string) =>
  (moduleMeta as Record<string, { title: string }>)[module]?.title || module

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('zh-CN') : '—'

/** 复盘日期已过且方案未结束时标红，让教师一眼看到该处理哪个 */
function reviewOverdue(row: PlanRow) {
  if (!row.nextReviewAt || row.completedAt) return false
  return new Date(row.nextReviewAt).getTime() < Date.now()
}

const router = useRouter()
</script>

<template>
  <ManagementPage
    title="方案"
    description="由评估生成的行动方案，含执行、复盘与质量反馈记录"
    :can-create="false"
  >
    <TableToolbar
      :search-value="q"
      :status-filter="statusFilter"
      :status-options="statusOptions"
      search-placeholder="搜索方案标题..."
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
      @row-click="(row: PlanRow) => router.push(`/information/plans/${row.id}`)"
    >
      <template #title-data="{ row }">
        <NuxtLink :to="`/information/plans/${row.id}`" class="font-medium text-emerald-700 hover:underline">
          {{ row.title }}
        </NuxtLink>
      </template>
      <template #module-data="{ row }">{{ moduleTitle(row.module) }}</template>
      <template #status-data="{ row }">
        <UBadge :color="STATUS_COLOR[row.status] || 'neutral'" variant="subtle" size="xs">
          {{ STATUS_TEXT[row.status] || row.status }}
        </UBadge>
      </template>
      <template #nextReviewAt-data="{ row }">
        <span :class="reviewOverdue(row) ? 'font-medium text-red-600' : ''">
          {{ formatDate(row.nextReviewAt) }}
          <template v-if="reviewOverdue(row)"> · 已逾期</template>
        </span>
      </template>
      <template #updatedAt-data="{ row }">{{ formatDate(row.updatedAt) }}</template>
    </ManagedDataTable>

    <div v-if="error" class="py-8 text-center text-sm text-red-500">{{ error }}</div>
    <div v-else-if="!loading && !rows.length" class="py-12 text-center text-sm text-slate-400">
      还没有方案。完成一次模块评估后，系统会自动生成对应的行动方案。
    </div>

    <TablePagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />
  </ManagementPage>
</template>

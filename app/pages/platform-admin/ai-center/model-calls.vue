<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface ModelCallRow {
  id: string
  schoolName: string | null
  ownerName: string | null
  purpose: string
  provider: string
  model: string
  status: string
  latencyMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  errorCode: string | null
  dataMode: string | null
  createdAt: string
}

const purposeLabels: Record<string, string> = {
  clarification_round: '澄清追问',
  clarification_summary: '澄清总结',
  assistant_answer: '聊天回答',
  assistant_answer_stream: '聊天流式回答',
  assessment_report: '评估报告润色',
  instrument_recommendation: '量表分诊',
  plan_update_extraction: '方案更新提取',
}

const page = ref(1)
const pageSize = ref<20 | 50 | 100>(20)
const statusFilter = ref('all')
const purposeFilter = ref('all')

const query = computed(() => {
  const q: Record<string, string> = { page: String(page.value), pageSize: String(pageSize.value) }
  if (statusFilter.value !== 'all') q.status = statusFilter.value
  if (purposeFilter.value !== 'all') q.purpose = purposeFilter.value
  return q
})

const { data, pending, refresh } = useFetch<{ rows: ModelCallRow[], total: number, page: number, pageSize: number }>('/api/v1/platform-admin/ai-center/model-calls', {
  query,
  watch: false,
  default: () => ({ rows: [], total: 0, page: 1, pageSize: 20 }),
})

const rows = computed(() => data.value?.rows ?? [])
const total = computed(() => data.value?.total ?? 0)

function reload() {
  page.value = 1
  refresh()
}
function onPageChange(p: number) {
  page.value = p
  refresh()
}
function onPageSizeChange(size: number) {
  pageSize.value = size as 20 | 50 | 100
  page.value = 1
  refresh()
}

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
  { label: '兜底', value: 'fallback' },
]
const purposeOptions = [
  { label: '全部用途', value: 'all' },
  ...Object.entries(purposeLabels).map(([value, label]) => ({ label, value })),
]
</script>

<template>
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词模板、调用监控与治理概览。">
    <AiCenterTabs />

    <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">调用审计</h2>
        <p class="mt-1 text-sm text-gray-500">全部 AI 模型调用记录（ai_model_calls）。语义安全/规则改写/模块路由调用按设计不落审计。</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <USelect
          :model-value="statusFilter"
          :options="statusOptions"
          class="w-36"
          value-key="value"
          @update:model-value="(v: any) => { statusFilter = String(v ?? 'all'); reload() }"
        />
        <USelect
          :model-value="purposeFilter"
          :options="purposeOptions"
          class="w-44"
          value-key="value"
          @update:model-value="(v: any) => { purposeFilter = String(v ?? 'all'); reload() }"
        />
        <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">刷新</UButton>
      </div>
    </div>

    <div class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div v-if="pending" class="p-12 text-center text-sm text-gray-400">加载中…</div>
      <table v-else class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50/70">
          <tr class="text-left text-xs text-gray-500">
            <th class="px-5 py-3 font-medium">时间</th>
            <th class="px-4 py-3 font-medium">学校 / 教师</th>
            <th class="px-4 py-3 font-medium">用途</th>
            <th class="px-4 py-3 font-medium">模型</th>
            <th class="px-4 py-3 font-medium">状态</th>
            <th class="px-4 py-3 font-medium">延迟</th>
            <th class="px-4 py-3 font-medium">Token</th>
            <th class="px-4 py-3 font-medium">错误码</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="row in rows" :key="row.id" class="transition-colors hover:bg-gray-50/50">
            <td class="whitespace-nowrap px-5 py-3 text-xs text-gray-400">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
            <td class="px-4 py-3">
              <p class="text-xs text-gray-700">{{ row.schoolName || '—' }}</p>
              <p class="text-xs text-gray-400">{{ row.ownerName || '—' }}</p>
            </td>
            <td class="px-4 py-3 text-xs text-gray-700">{{ purposeLabels[row.purpose] || row.purpose }}</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500">{{ row.model }}</td>
            <td class="px-4 py-3">
              <UBadge :color="row.status === 'success' ? 'success' : row.status === 'fallback' ? 'warning' : 'error'" variant="subtle" size="xs">{{ row.status }}</UBadge>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ row.latencyMs !== null ? `${row.latencyMs}ms` : '—' }}</td>
            <td class="px-4 py-3 text-xs text-gray-400">
              {{ row.promptTokens !== null ? `${row.promptTokens}/${row.completionTokens ?? 0}` : '—' }}
            </td>
            <td class="px-4 py-3 text-xs text-red-500">{{ row.errorCode || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!pending && !rows.length" class="p-12 text-center text-sm text-gray-400">暂无符合条件的调用记录</div>
    </div>

    <div class="mt-4">
      <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
    </div>
  </ManagementPage>
</template>
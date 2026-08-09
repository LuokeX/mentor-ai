<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface ModelEntry {
  env: string | number | boolean
  override: string | number | boolean | null
  effective: string | number | boolean
}
interface RecentCall {
  id: string
  schoolName: string | null
  purpose: string
  model: string
  status: string
  latencyMs: number | null
  errorCode: string | null
  createdAt: string
}

const { data, pending, refresh } = await useFetch<{
  models: Record<string, ModelEntry>
  keys: { deepseekApiKey: { configured: boolean, note: string }, deepseekBaseUrl: string, agreementVersion: string }
  stats7d: { total: number, success: number, failed: number, avgLatencyMs: number, byPurpose: Array<{ purpose: string, total: number, failed: number }> }
  recentCalls: RecentCall[]
  governance: { byDataMode: Array<{ dataMode: string | null, total: number }> }
}>('/api/v1/platform-admin/ai-center/dashboard')

const purposeLabels: Record<string, string> = {
  clarification_round: '澄清追问',
  clarification_summary: '澄清总结',
  assistant_answer: '聊天回答',
  assistant_answer_stream: '聊天流式回答',
  assessment_report: '评估报告润色',
  instrument_recommendation: '量表分诊',
  plan_update_extraction: '方案更新提取',
}
const dataModeLabels: Record<string, string> = {
  local: '本地处理',
  redacted: '脱敏模式',
  full_context: '完整上下文',
}

const modelRows = computed(() => [
  { key: 'routerModel', label: '路由模型（分诊/路由/安全）', value: data.value?.models.routerModel },
  { key: 'generatorModel', label: '生成模型（聊天/报告/推荐）', value: data.value?.models.generatorModel },
  { key: 'timeoutMs', label: '调用超时（ms）', value: data.value?.models.timeoutMs },
  { key: 'embeddingModel', label: '向量模型（Ollama）', value: data.value?.models.embeddingModel },
  { key: 'embeddingEnabled', label: '向量检索开关', value: data.value?.models.embeddingEnabled },
])

function effectiveText(value: ModelEntry | undefined) {
  if (!value) return '—'
  if (typeof value.effective === 'boolean') return value.effective ? '开启' : '关闭'
  return String(value.effective)
}
</script>

<template>
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词模板、调用监控与治理概览。">
    <AiCenterTabs />

    <!-- 模型配置 -->
    <h2 class="mt-6 text-lg font-semibold text-gray-900">模型配置</h2>
    <p class="mt-1 text-sm text-gray-500">DB 覆盖值热生效（缓存 30 秒内），未覆盖时使用环境变量默认。</p>
    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="row in modelRows"
        :key="row.key"
        class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium text-gray-700">{{ row.label }}</p>
          <UBadge v-if="row.value?.override !== null && row.value?.override !== undefined" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-2 text-xl font-bold tracking-tight text-gray-900">{{ effectiveText(row.value) }}</p>
        <p v-if="row.value?.override !== null && row.value?.override !== undefined" class="mt-1 text-xs text-gray-400">
          环境变量默认：{{ row.value?.override === row.value?.env ? row.value?.env : row.value?.env }}
        </p>
      </div>
    </div>

    <!-- 服务与密钥状态 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">服务与密钥</h2>
    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full" :class="data?.keys.deepseekApiKey.configured ? 'bg-green-500' : 'bg-amber-500'" />
          <p class="text-sm font-medium text-gray-700">DeepSeek API 密钥</p>
        </div>
        <p class="mt-1.5 text-xs text-gray-400">{{ data?.keys.deepseekApiKey.configured ? '已配置（环境变量，只读）' : '未配置（AI 调用将降级为规则兜底）' }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-sm font-medium text-gray-700">DeepSeek Base URL</p>
        <p class="mt-1.5 text-xs font-mono text-gray-500 break-all">{{ data?.keys.deepseekBaseUrl }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-sm font-medium text-gray-700">供应商协议版本</p>
        <p class="mt-1.5 text-xs text-gray-500">{{ data?.keys.agreementVersion }}</p>
      </div>
    </div>

    <!-- 近 7 天调用统计 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">近 7 天调用统计</h2>
    <div v-if="pending" class="mt-4 text-sm text-gray-400">加载中…</div>
    <div v-else class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-2xl font-bold tracking-tight text-gray-900">{{ data?.stats7d.total ?? 0 }}</p>
        <p class="mt-1 text-sm font-medium text-gray-500">总调用次数</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-2xl font-bold tracking-tight text-green-600">{{ data?.stats7d.success ?? 0 }}</p>
        <p class="mt-1 text-sm font-medium text-gray-500">成功</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-2xl font-bold tracking-tight text-red-500">{{ data?.stats7d.failed ?? 0 }}</p>
        <p class="mt-1 text-sm font-medium text-gray-500">失败 / 兜底</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-2xl font-bold tracking-tight text-gray-900">{{ data?.stats7d.avgLatencyMs ?? 0 }}ms</p>
        <p class="mt-1 text-sm font-medium text-gray-500">平均延迟</p>
      </div>
    </div>

    <!-- 按用途分布 -->
    <div v-if="data?.stats7d.byPurpose?.length" class="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="divide-y divide-gray-50">
        <div v-for="item in data.stats7d.byPurpose" :key="item.purpose" class="flex items-center gap-4 px-5 py-3">
          <span class="w-32 shrink-0 text-sm text-gray-700">{{ purposeLabels[item.purpose] || item.purpose }}</span>
          <div class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full bg-primary-500"
              :style="{ width: `${Math.max(2, (item.total / data.stats7d.total) * 100)}%` }"
            />
          </div>
          <span class="w-24 shrink-0 text-right text-xs text-gray-500">{{ item.total }} 次 / 失败 {{ item.failed }}</span>
        </div>
      </div>
    </div>

    <!-- 治理概览 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">AI 数据治理</h2>
    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div v-for="item in data?.governance.byDataMode ?? []" :key="item.dataMode ?? 'null'" class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-2xl font-bold tracking-tight text-gray-900">{{ item.total }}</p>
        <p class="mt-1 text-sm font-medium text-gray-500">{{ dataModeLabels[item.dataMode ?? ''] || item.dataMode || '未设置' }}学校</p>
      </div>
    </div>

    <!-- 最近调用 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">最近调用</h2>
    <div class="mt-4 flex items-center justify-between">
      <p class="text-sm text-gray-500">最近 20 条，完整记录见「调用审计」。</p>
      <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-refresh-cw" @click="() => refresh()">刷新</UButton>
    </div>
    <div v-if="data?.recentCalls?.length" class="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="divide-y divide-gray-50">
        <div v-for="call in data.recentCalls" :key="call.id" class="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <div class="flex min-w-0 items-center gap-3">
            <UBadge :color="call.status === 'success' ? 'success' : 'error'" variant="subtle" size="xs">{{ call.status }}</UBadge>
            <span class="truncate font-medium text-gray-700">{{ purposeLabels[call.purpose] || call.purpose }}</span>
            <span class="truncate font-mono text-xs text-gray-400">{{ call.model }}</span>
            <span class="shrink-0 text-xs text-gray-400">{{ call.schoolName || '—' }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-3 text-xs text-gray-400">
            <span v-if="call.latencyMs !== null">{{ call.latencyMs }}ms</span>
            <span v-if="call.errorCode" class="text-red-500">{{ call.errorCode }}</span>
            <span>{{ new Date(call.createdAt).toLocaleString('zh-CN') }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="!pending" class="mt-3 rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">暂无 AI 调用记录</div>
  </ManagementPage>
</template>
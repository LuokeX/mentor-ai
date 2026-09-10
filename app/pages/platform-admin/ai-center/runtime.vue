<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface RuntimeEntry {
  env: string | number | boolean | null
  effective: string | number | boolean | null
  source: 'env' | 'code'
}

const { data, refresh, pending } = await useFetch<{
  values: {
    routerModel: RuntimeEntry
    generatorModel: RuntimeEntry
    timeoutMs: RuntimeEntry
    embeddingModel: RuntimeEntry
    embeddingEnabled: RuntimeEntry
    agentEnabled: RuntimeEntry
    agentMaxRounds: RuntimeEntry
    agentTemperature: RuntimeEntry
    agentTools: RuntimeEntry
  }
  agentToolNames: string[]
  envOnly: {
    deepseekApiKey: { configured: boolean }
    deepseekBaseUrl: string
    agreementVersion: string
    ollamaBaseUrl: string
    embeddingTimeoutMs: number
  }
}>('/api/v1/platform-admin/ai-center/runtime')

const AGENT_TOOL_LABELS: Record<string, string> = {
  recommend_assessment: '推荐量表',
  knowledge_search: '知识库检索',
  module_route: '问题分诊（模块路由）',
  entity_memory: '实体记忆',
}

const enabledToolText = computed(() => {
  const names = data.value?.agentToolNames ?? []
  if (!names.length) return '—'
  return names.map(name => AGENT_TOOL_LABELS[name] || name).join(' / ')
})

function effectiveText(value: RuntimeEntry | undefined, on = '开启', off = '关闭') {
  if (!value) return '—'
  if (typeof value.effective === 'boolean') return value.effective ? on : off
  return value.effective === null ? '—' : String(value.effective)
}

const testing = ref(false)
const testResult = ref<{ ok: boolean, latencyMs?: number, model?: string, error?: string, status?: number } | null>(null)
async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await $fetch<{ ok: boolean, latencyMs?: number, model?: string, error?: string, status?: number }>('/api/v1/platform-admin/ai-center/runtime/test', { method: 'POST' })
  } catch (error: any) {
    testResult.value = { ok: false, error: error?.data?.message || '请求失败' }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词正文、调用监控与治理概览。">
    <AiCenterTabs />

    <div class="mt-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">模型与服务（只读）</h2>
        <p class="mt-1 text-sm text-gray-500">
          运行时参数只来自环境变量与代码默认值，改配置需调整环境变量并重启应用进程；此页仅供核对，不提供在线修改。
        </p>
      </div>
      <div class="flex gap-2">
        <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">刷新</UButton>
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-cable" :loading="testing" @click="testConnection">连通性测试</UButton>
      </div>
    </div>

    <!-- 测试结果 -->
    <div v-if="testResult" class="mt-4 rounded-xl border p-4 text-sm" :class="testResult.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'">
      <p v-if="testResult.ok">连接正常：{{ testResult.model }} 响应 {{ testResult.latencyMs }}ms</p>
      <p v-else>连接失败：{{ testResult.error }}{{ testResult.status ? `（HTTP ${testResult.status}）` : '' }}</p>
    </div>

    <!-- 模型配置 -->
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">路由模型</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">分诊路由 / 语义安全 / 方案更新提取</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.routerModel) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 DEEPSEEK_ROUTER_MODEL</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">生成模型</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">聊天 / 报告润色 / 量表分诊</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.generatorModel) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 DEEPSEEK_GENERATOR_MODEL</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">调用超时（毫秒）</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">常规调用超时；安全链路小超时固定不变</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.timeoutMs) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 DEEPSEEK_TIMEOUT_MS</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">向量模型</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">Ollama 嵌入模型名</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.embeddingModel) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 EMBEDDING_MODEL</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">向量检索开关</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">关闭后知识检索退化为关键词模式</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.embeddingEnabled) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 EMBEDDING_ENABLED</p>
      </div>
    </div>

    <!-- Agent 回答模式 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">Agent 回答模式（只读）</h2>
    <p class="mt-1 text-sm text-gray-500">Agent 行为要点已随代码发布（回答先行、量表优先等），这里只展示生效参数。</p>
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">Agent 启用</p>
          <UBadge variant="soft" color="neutral" size="xs">环境变量</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">开启后所有消息走「回答先行 Agent」；关闭回落澄清分诊流程</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.agentEnabled) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：环境变量 AGENT_ENABLED</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">工具轮次上限</p>
          <UBadge variant="soft" color="neutral" size="xs">代码默认</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">Agent 单轮最多调用工具次数</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.agentMaxRounds) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：server/agent/graph.ts 的 MAX_TOOL_ROUNDS</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">采样温度</p>
          <UBadge variant="soft" color="neutral" size="xs">代码默认</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">0~2，值越高回答越发散</p>
        <p class="mt-2 text-lg font-semibold tracking-tight text-gray-900">{{ effectiveText(data?.values.agentTemperature) }}</p>
        <p class="mt-1 text-xs text-gray-400">来源：server/integrations/models.ts 的默认温度</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">启用工具</p>
          <UBadge variant="soft" color="neutral" size="xs">代码默认</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">按上下文裁剪后全部生效（未接入业务对象时只暴露无状态工具）</p>
        <p class="mt-2 text-sm font-medium text-gray-900">{{ enabledToolText }}</p>
      </div>
    </div>

    <!-- env 只读 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">环境变量（只读）</h2>
    <div class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <tbody class="divide-y divide-gray-100">
          <tr class="hover:bg-gray-50/50">
            <td class="px-5 py-3 font-medium text-gray-700">DeepSeek API 密钥</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ data?.envOnly.deepseekApiKey.configured ? '已配置' : '未配置（AI 调用降级为规则兜底）' }}</td>
          </tr>
          <tr class="hover:bg-gray-50/50">
            <td class="px-5 py-3 font-medium text-gray-700">DeepSeek Base URL</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500 break-all">{{ data?.envOnly.deepseekBaseUrl }}</td>
          </tr>
          <tr class="hover:bg-gray-50/50">
            <td class="px-5 py-3 font-medium text-gray-700">供应商协议版本</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ data?.envOnly.agreementVersion || '未登记（full_context 门禁关闭）' }}</td>
          </tr>
          <tr class="hover:bg-gray-50/50">
            <td class="px-5 py-3 font-medium text-gray-700">Ollama Base URL</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500 break-all">{{ data?.envOnly.ollamaBaseUrl }}</td>
          </tr>
          <tr class="hover:bg-gray-50/50">
            <td class="px-5 py-3 font-medium text-gray-700">向量超时（毫秒）</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ data?.envOnly.embeddingTimeoutMs }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </ManagementPage>
</template>

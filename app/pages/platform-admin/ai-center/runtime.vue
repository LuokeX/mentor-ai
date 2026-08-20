<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface RuntimeEntry {
  env: string | number | boolean
  override: string | number | boolean | null
  effective: string | number | boolean
}

const toast = useToast()
const { data, refresh } = await useFetch<{
  initialized: boolean
  values: {
    routerModel: RuntimeEntry
    generatorModel: RuntimeEntry
    timeoutMs: RuntimeEntry
    embeddingModel: RuntimeEntry
    embeddingEnabled: RuntimeEntry
  }
  envOnly: {
    deepseekApiKey: { configured: boolean }
    deepseekBaseUrl: string
    agreementVersion: string
    ollamaBaseUrl: string
    embeddingTimeoutMs: number
  }
}>('/api/v1/platform-admin/ai-center/runtime')

// 可编辑字段（空 = 回落环境变量）
const routerModel = ref('')
const generatorModel = ref('')
const timeoutMs = ref('')
const embeddingModel = ref('')
const embeddingEnabled = ref('') // '' 默认 | 'true' | 'false'

watch(data, (value) => {
  if (!value) return
  routerModel.value = (value.values.routerModel.override as string) ?? ''
  generatorModel.value = (value.values.generatorModel.override as string) ?? ''
  timeoutMs.value = value.values.timeoutMs.override !== null ? String(value.values.timeoutMs.override) : ''
  embeddingModel.value = (value.values.embeddingModel.override as string) ?? ''
  embeddingEnabled.value = value.values.embeddingEnabled.override === null ? '' : String(value.values.embeddingEnabled.override)
}, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/platform-admin/ai-center/runtime', {
      method: 'PATCH',
      body: {
        routerModel: routerModel.value.trim() || null,
        generatorModel: generatorModel.value.trim() || null,
        timeoutMs: timeoutMs.value.trim() ? Number(timeoutMs.value.trim()) : null,
        embeddingModel: embeddingModel.value.trim() || null,
        embeddingEnabled: embeddingEnabled.value === '' ? null : embeddingEnabled.value === 'true',
      },
    })
    toast.add({ title: '配置已保存', description: '已热生效（缓存 30 秒内）。留空字段继续使用环境变量默认。', color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    saving.value = false
  }
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
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词模板、调用监控与治理概览。">
    <AiCenterTabs />

    <div class="mt-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">模型与服务</h2>
        <p class="mt-1 text-sm text-gray-500">运行时参数热生效（缓存 30 秒内）。留空 = 使用环境变量默认值；密钥与协议版本仅存于环境变量。</p>
      </div>
      <div class="flex gap-2">
        <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-refresh-cw" @click="() => refresh()">刷新</UButton>
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-cable" :loading="testing" @click="testConnection">连通性测试</UButton>
        <UButton color="primary" size="sm" icon="i-lucide-save" :loading="saving" @click="save">保存配置</UButton>
      </div>
    </div>

    <!-- 测试结果 -->
    <div v-if="testResult" class="mt-4 rounded-xl border p-4 text-sm" :class="testResult.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'">
      <p v-if="testResult.ok">连接正常：{{ testResult.model }} 响应 {{ testResult.latencyMs }}ms</p>
      <p v-else>连接失败：{{ testResult.error }}{{ testResult.status ? `（HTTP ${testResult.status}）` : '' }}</p>
    </div>

    <!-- 可编辑配置 -->
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">路由模型</p>
          <UBadge v-if="data?.values.routerModel.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">分诊路由 / 语义安全 / 方案更新提取</p>
        <UInput v-model="routerModel" class="mt-2 w-full" placeholder="如 deepseek-v4-flash" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.routerModel.env }}</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">生成模型</p>
          <UBadge v-if="data?.values.generatorModel.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">聊天 / 报告润色 / 量表分诊</p>
        <UInput v-model="generatorModel" class="mt-2 w-full" placeholder="如 deepseek-v4-pro" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.generatorModel.env }}</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">调用超时（毫秒）</p>
          <UBadge v-if="data?.values.timeoutMs.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">常规调用超时；安全链路小超时固定不变</p>
        <UInput v-model="timeoutMs" class="mt-2 w-full" placeholder="如 30000" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.timeoutMs.env }}</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">向量模型</p>
          <UBadge v-if="data?.values.embeddingModel.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">Ollama 嵌入模型名</p>
        <UInput v-model="embeddingModel" class="mt-2 w-full" placeholder="如 text-embedding-v4（百炼）/ qwen3-embedding:0.6b（ollama）" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.embeddingModel.env }}</p>
      </div>

      <!-- embedding 开关 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">向量检索开关</p>
          <UBadge v-if="data?.values.embeddingEnabled.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">关闭后知识检索退化为关键词模式</p>
        <USelect
          :model-value="embeddingEnabled"
          class="mt-2 w-full"
          :options="[
            { label: '默认（环境变量）', value: '' },
            { label: '开启', value: 'true' },
            { label: '关闭', value: 'false' },
          ]"
          value-key="value"
          @update:model-value="(v: any) => { embeddingEnabled = String(v ?? '') }"
        />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.embeddingEnabled.env ? '开启' : '关闭' }}</p>
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
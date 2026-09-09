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
    agentEnabled: RuntimeEntry
    agentMaxRounds: RuntimeEntry
    agentTemperature: RuntimeEntry
    agentTools: RuntimeEntry
    agentBehaviorNotes: RuntimeEntry
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
const agentEnabled = ref('') // '' 默认 | 'true' | 'false'
const agentMaxRounds = ref('')
const agentTemperature = ref('')
const agentTools = ref<string[]>([])
const agentBehaviorNotes = ref('')

const AGENT_TOOL_OPTIONS = [
  { label: '推荐量表', value: 'recommend_assessment' },
  { label: '知识库检索', value: 'knowledge_search' },
  { label: '问题分诊（模块路由）', value: 'module_route' },
  { label: '实体记忆', value: 'entity_memory' },
]

watch(data, (value) => {
  if (!value) return
  routerModel.value = (value.values.routerModel.override as string) ?? ''
  generatorModel.value = (value.values.generatorModel.override as string) ?? ''
  timeoutMs.value = value.values.timeoutMs.override !== null ? String(value.values.timeoutMs.override) : ''
  embeddingModel.value = (value.values.embeddingModel.override as string) ?? ''
  embeddingEnabled.value = value.values.embeddingEnabled.override === null ? '' : String(value.values.embeddingEnabled.override)
  agentEnabled.value = value.values.agentEnabled.override === null ? '' : String(value.values.agentEnabled.override)
  agentMaxRounds.value = value.values.agentMaxRounds.override !== null ? String(value.values.agentMaxRounds.override) : ''
  agentTemperature.value = value.values.agentTemperature.override !== null ? String(value.values.agentTemperature.override) : ''
  agentTools.value = Array.isArray(value.values.agentTools.override) ? value.values.agentTools.override as string[] : []
  agentBehaviorNotes.value = (value.values.agentBehaviorNotes.override as string) ?? ''
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
        agentEnabled: agentEnabled.value === '' ? null : agentEnabled.value === 'true',
        agentMaxRounds: agentMaxRounds.value.trim() ? Number(agentMaxRounds.value.trim()) : null,
        agentTemperature: agentTemperature.value.trim() ? Number(agentTemperature.value.trim()) : null,
        agentTools: agentTools.value.length ? agentTools.value : null,
        agentBehaviorNotes: agentBehaviorNotes.value.trim() || null,
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

    <!-- Agent（回答先行）可编辑配置 -->
    <h2 class="mt-8 text-lg font-semibold text-gray-900">Agent 回答模式</h2>
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Agent 启用开关 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">Agent 启用</p>
          <UBadge v-if="data?.values.agentEnabled.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">开启后所有消息走「回答先行 Agent」；关闭回落澄清分诊流程</p>
        <USelect
          :model-value="agentEnabled"
          class="mt-2 w-full"
          :options="[
            { label: '默认（环境变量）', value: '' },
            { label: '开启', value: 'true' },
            { label: '关闭', value: 'false' },
          ]"
          value-key="value"
          @update:model-value="(v: any) => { agentEnabled = String(v ?? '') }"
        />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.agentEnabled.env ? '开启' : '关闭' }}</p>
      </div>

      <!-- Agent 工具轮次上限 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">工具轮次上限</p>
          <UBadge v-if="data?.values.agentMaxRounds.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">Agent 单轮最多调用工具次数（1~20）</p>
        <UInput v-model="agentMaxRounds" class="mt-2 w-full" type="number" min="1" max="20" placeholder="如 6" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.agentMaxRounds.env }}</p>
      </div>

      <!-- Agent 采样温度 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">采样温度</p>
          <UBadge v-if="data?.values.agentTemperature.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">0~2，值越高回答越发散</p>
        <UInput v-model="agentTemperature" class="mt-2 w-full" type="number" min="0" max="2" step="0.05" placeholder="如 0.35" />
        <p class="mt-2 text-xs text-gray-400">环境变量默认：{{ data?.values.agentTemperature.env }}</p>
      </div>

      <!-- Agent 启用的工具 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">启用工具</p>
          <UBadge v-if="data?.values.agentTools.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">不勾选 = 使用全部默认工具</p>
        <USelectMultiple
          v-model="agentTools"
          class="mt-2 w-full"
          :options="AGENT_TOOL_OPTIONS"
          value-key="value"
          placeholder="选择启用的工具"
          size="sm"
        />
        <p class="mt-2 text-xs text-gray-400">可用工具：推荐量表 / 知识库检索 / 问题分诊 / 实体记忆</p>
      </div>

      <!-- Agent 行为补充要点 -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">行为补充要点</p>
          <UBadge v-if="data?.values.agentBehaviorNotes.override !== null" variant="soft" color="primary" size="xs">DB 覆盖</UBadge>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">追加在系统提示词末尾的行为约束；留空 = 使用内置「回答先行」要点。注：诊断/确定性规则边界等硬约束仍由代码强制。</p>
        <UTextarea
          v-model="agentBehaviorNotes"
          class="mt-2 w-full"
          :rows="5"
          placeholder="每行一条行为约束，如：回答先行，只输出给班主任看的自然语言回答。"
        />
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
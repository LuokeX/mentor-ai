<script setup lang="ts">
definePageMeta({ layout: 'default' })
const { data } = await useFetch<any>('/api/v1/platform-admin/dashboard')

const stats = computed(() => [
  { label: '学校租户', value: data.value?.schools?.length || 0, icon: 'i-lucide-building-2', color: 'blue' },
  { label: '应急访问申请', value: data.value?.accessRequests?.length || 0, icon: 'i-lucide-key-round', color: 'amber' },
  { label: '代管授权', value: data.value?.delegatedManagementGrants?.length || 0, icon: 'i-lucide-shield', color: 'purple' },
  { label: '活跃学校', value: data.value?.schools?.filter((s: any) => s.status === 'active').length || 0, icon: 'i-lucide-school', color: 'green' },
])

const colorMap: Record<string, { bg: string; text: string }> = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700' },
  green:  { bg: 'bg-green-50',  text: 'text-green-700' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700' },
}

function colorClasses(key: string) {
  const c = colorMap[key] ?? colorMap.blue!
  return [c!.bg, c!.text]
}

const health = computed(() => [
  { label: '数据库', status: data.value?.health?.database || 'unknown', ok: true },
  { label: 'DeepSeek', status: data.value?.health?.modelConfigured ? '已配置' : '未配置', ok: data.value?.health?.modelConfigured },
  { label: '向量检索', status: data.value?.health?.embeddingEnabled ? data.value?.health?.embeddingModel || '已启用' : '关键词模式', ok: data.value?.health?.embeddingEnabled },
  { label: '短信服务', status: data.value?.health?.smsProvider || '未配置', ok: !!data.value?.health?.smsProvider },
])
</script>

<template>
  <ManagementPage title="平台管理后台" description="学校租户、三库资源、委托授权、审计与系统健康总览。">

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="s in stats"
        :key="s.label"
        class="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300"
      >
        <div class="flex items-start justify-between">
          <div class="min-w-0 flex-1">
            <p class="text-2xl font-bold tracking-tight text-gray-900">{{ s.value }}</p>
            <p class="mt-1 text-sm font-medium text-gray-500">{{ s.label }}</p>
          </div>
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg"
            :class="colorClasses(s.color)"
          >
            <UIcon :name="s.icon" class="size-5" />
          </span>
        </div>
      </div>
    </div>

    <!-- 服务状态 -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">服务状态</h2>
      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="h in health"
          :key="h.label"
          class="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md"
        >
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full" :class="h.ok ? 'bg-green-500' : 'bg-amber-500'" />
            <span class="text-sm font-medium text-gray-700">{{ h.label }}</span>
          </div>
          <p class="mt-1.5 text-xs text-gray-400">{{ h.status }}</p>
        </div>
      </div>
    </div>

    <!-- 最近审计 -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">最近操作记录</h2>
      <div v-if="data?.auditLogs?.length" class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div class="divide-y divide-gray-50">
          <div
            v-for="log in data.auditLogs.slice(0, 10)"
            :key="log.id"
            class="flex items-center justify-between px-5 py-3 text-sm transition-colors hover:bg-gray-50/50"
          >
            <div class="flex items-center gap-3">
              <UBadge variant="soft" size="xs">{{ log.action }}</UBadge>
              <span class="text-gray-500">{{ log.targetType }} / {{ log.targetId?.slice(0, 8) }}</span>
            </div>
            <span class="text-xs text-gray-400">{{ new Date(log.createdAt).toLocaleString('zh-CN') }}</span>
          </div>
        </div>
      </div>
      <div v-else class="mt-4 rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
        暂无操作记录
      </div>
    </div>
  </ManagementPage>
</template>
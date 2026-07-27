<script setup lang="ts">
definePageMeta({ layout: 'default' })
const { data } = await useFetch<any>('/api/v1/platform-admin/dashboard')

const stats = computed(() => [
  { label: '学校租户', value: data.value?.schools?.length || 0, color: 'bg-blue-50 text-blue-700', icon: 'i-lucide-building-2' },
  { label: '应急访问申请', value: data.value?.accessRequests?.length || 0, color: 'bg-amber-50 text-amber-700', icon: 'i-lucide-key-round' },
  { label: '代管授权', value: data.value?.delegatedManagementGrants?.length || 0, color: 'bg-purple-50 text-purple-700', icon: 'i-lucide-shield' },
  { label: '资源覆盖', value: data.value?.schools?.filter((s: any) => s.status === 'active').length || 0, color: 'bg-green-50 text-green-700', icon: 'i-lucide-school' },
])

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
        v-for="card in stats"
        :key="card.label"
        class="rounded-xl border border-slate-200 p-5"
        :class="card.color.replace('text-', 'bg-').replace('bg-', 'bg-').replace('700', '50')"
      >
        <div class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-lg" :class="card.color">
            <UIcon :name="card.icon" />
          </span>
          <div>
            <p class="text-2xl font-semibold" :class="card.color.replace('bg-', 'text-')">{{ card.value }}</p>
            <p class="text-xs text-slate-500">{{ card.label }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 服务状态 -->
    <h2 class="mt-10 text-lg font-semibold">服务状态</h2>
    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
      <div
        v-for="h in health"
        :key="h.label"
        class="rounded-lg border border-slate-200 p-4"
      >
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full" :class="h.ok ? 'bg-green-500' : 'bg-amber-500'" />
          <span class="text-sm font-medium">{{ h.label }}</span>
        </div>
        <p class="mt-1 text-xs text-slate-500">{{ h.status }}</p>
      </div>
    </div>

    <!-- 最近审计 -->
    <h2 class="mt-10 text-lg font-semibold">最近操作记录</h2>
    <div v-if="data?.auditLogs?.length" class="mt-4 space-y-2">
      <div
        v-for="log in data.auditLogs.slice(0, 10)"
        :key="log.id"
        class="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5 text-sm"
      >
        <div class="flex items-center gap-3">
          <UBadge variant="soft" size="xs">{{ log.action }}</UBadge>
          <span class="text-slate-600">{{ log.targetType }} / {{ log.targetId?.slice(0, 8) }}</span>
        </div>
        <span class="text-xs text-slate-400">{{ new Date(log.createdAt).toLocaleString('zh-CN') }}</span>
      </div>
    </div>
    <div v-else class="mt-4 rounded-lg border border-slate-100 p-8 text-center text-sm text-slate-400">
      暂无操作记录
    </div>
  </ManagementPage>
</template>
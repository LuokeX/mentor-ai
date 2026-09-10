<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface PromptItem {
  code: string
  name: string
  description: string | null
  placeholders: Array<{ key: string, label: string, description?: string }>
  template: string | null
  available: boolean
}

const { data, refresh, pending } = await useFetch<{ items: PromptItem[] }>('/api/v1/platform-admin/ai-center/prompts')

const items = computed(() => data.value?.items ?? [])

const viewing = ref<PromptItem | null>(null)
const viewerOpen = computed({
  get: () => Boolean(viewing.value),
  set: (v: boolean) => { if (!v) viewing.value = null },
})
</script>

<template>
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词正文、调用监控与治理概览。">
    <AiCenterTabs />

    <div class="mt-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">提示词库（只读）</h2>
        <p class="mt-1 text-sm text-gray-500">
          提示词正文随代码发布（<code class="rounded bg-gray-100 px-1 py-0.5 text-xs">server/domain/ai-prompt-baselines.ts</code>），
          修改文案请走代码评审与发版；此页仅供查看。下方标记为「缺失」的调用点运行时降级到确定性流程。
        </p>
      </div>
      <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">刷新</UButton>
    </div>

    <div class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50/70">
          <tr class="text-left text-xs text-gray-500">
            <th class="px-5 py-3 font-medium">名称</th>
            <th class="px-4 py-3 font-medium">编码</th>
            <th class="px-4 py-3 font-medium">状态</th>
            <th class="px-4 py-3 font-medium">字数</th>
            <th class="px-4 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="item in items" :key="item.code" class="transition-colors hover:bg-gray-50/50">
            <td class="px-5 py-3">
              <p class="font-medium text-gray-900">{{ item.name }}</p>
              <p class="mt-0.5 line-clamp-1 max-w-md text-xs text-gray-400">{{ item.description }}</p>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500">{{ item.code }}</td>
            <td class="px-4 py-3">
              <UBadge :color="item.available ? 'success' : 'error'" variant="subtle" size="xs">
                {{ item.available ? '代码正文就绪' : '正文缺失' }}
              </UBadge>
            </td>
            <td class="px-4 py-3 text-xs text-gray-400">{{ item.template?.length ?? 0 }}</td>
            <td class="px-4 py-3 text-right">
              <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-eye" @click="() => { viewing = item }">查看</UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 只读正文 -->
    <USlideover :open="viewerOpen" title="提示词正文（只读）" @update:open="(v: boolean) => { if (!v) viewing = null }">
      <template #body>
        <div v-if="viewing" class="flex flex-col gap-4 p-4">
          <div>
            <p class="text-sm font-medium text-gray-700">{{ viewing.name }}</p>
            <p class="mt-0.5 font-mono text-xs text-gray-400">{{ viewing.code }}</p>
            <p v-if="viewing.description" class="mt-1 text-xs text-gray-500">{{ viewing.description }}</p>
          </div>

          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">正文</p>
            <pre class="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">{{ viewing.template || '（缺失）' }}</pre>
          </div>

          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">可用占位符</p>
            <div class="flex flex-col gap-1.5">
              <div v-for="ph in viewing.placeholders" :key="ph.key" class="rounded-lg bg-gray-50 px-3 py-2">
                <code class="text-xs font-semibold text-primary-700">&#123;&#123;{{ ph.key }}&#125;&#125;</code>
                <span class="ml-2 text-xs font-medium text-gray-600">{{ ph.label }}</span>
                <p v-if="ph.description" class="mt-0.5 text-xs text-gray-400">{{ ph.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </USlideover>
  </ManagementPage>
</template>

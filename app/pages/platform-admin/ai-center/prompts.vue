<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface PromptItem {
  code: string
  name: string
  description: string | null
  placeholders: Array<{ key: string, label: string, description?: string }>
  status: 'builtin' | 'draft' | 'published' | 'draft_over_published'
  template: string
  published: string | null
  publishedAt: string | null
  updatedAt: string | null
}

const toast = useToast()
const { data, refresh, pending } = await useFetch<{ items: PromptItem[] }>('/api/v1/platform-admin/ai-center/prompts')

const items = computed(() => data.value?.items ?? [])

const statusMeta: Record<PromptItem['status'], { label: string, color: 'neutral' | 'warning' | 'success' | 'info' }> = {
  builtin: { label: '内置基线', color: 'neutral' },
  draft: { label: '草稿', color: 'warning' },
  published: { label: '已发布', color: 'success' },
  draft_over_published: { label: '草稿（已发布生效中）', color: 'info' },
}

// ---- 编辑器 ----
const editing = ref<PromptItem | null>(null)
const editorOpen = ref(false)
const editorName = ref('')
const editorDescription = ref('')
const editorTemplate = ref('')
const saving = ref(false)
const publishing = ref(false)
const resetConfirm = ref<PromptItem | null>(null)
const resetConfirmOpen = computed({
  get: () => Boolean(resetConfirm.value),
  set: (v: boolean) => { if (!v) resetConfirm.value = null },
})

function openEditor(item: PromptItem) {
  editing.value = item
  editorName.value = item.name
  editorDescription.value = item.description ?? ''
  editorTemplate.value = item.template
  editorOpen.value = true
}

async function initPrompt(item: PromptItem) {
  try {
    await $fetch('/api/v1/platform-admin/ai-center/prompts', { method: 'POST', body: { code: item.code } })
    toast.add({ title: '已初始化', description: `「${item.name}」已从内置基线创建，可以开始编辑。`, color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '初始化失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  }
}

async function saveDraft() {
  if (!editing.value) return
  saving.value = true
  try {
    await $fetch(`/api/v1/platform-admin/ai-center/prompts/${editing.value.code}`, {
      method: 'PATCH',
      body: { name: editorName.value, description: editorDescription.value || undefined, template: editorTemplate.value },
    })
    toast.add({ title: '草稿已保存', description: '未发布，运行时仍使用已发布版本或内置基线。', color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!editing.value) return
  publishing.value = true
  try {
    await $fetch(`/api/v1/platform-admin/ai-center/prompts/${editing.value.code}`, {
      method: 'PATCH',
      body: { name: editorName.value, description: editorDescription.value || undefined, template: editorTemplate.value },
    })
    await $fetch(`/api/v1/platform-admin/ai-center/prompts/${editing.value.code}/publish`, { method: 'POST' })
    toast.add({ title: '已发布', description: '新提示词立即对全部调用点热生效。', color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '发布失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    publishing.value = false
  }
}

async function doReset() {
  if (!resetConfirm.value) return
  try {
    await $fetch(`/api/v1/platform-admin/ai-center/prompts/${resetConfirm.value.code}/reset`, { method: 'POST' })
    toast.add({ title: '已重置为内置基线', description: '运行时回退使用内置提示词。', color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '重置失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    resetConfirm.value = null
  }
}
</script>

<template>
  <ManagementPage title="AI 管理中心" description="平台 AI 服务配置、提示词模板、调用监控与治理概览。">
    <AiCenterTabs />

    <div class="mt-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">提示词库</h2>
        <p class="mt-1 text-sm text-gray-500">9 个 AI 调用点的提示词模板。发布即热生效；不编辑时全部使用内置基线。</p>
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
            <th class="px-4 py-3 font-medium">更新时间</th>
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
              <UBadge :color="statusMeta[item.status].color" variant="subtle" size="xs">{{ statusMeta[item.status].label }}</UBadge>
            </td>
            <td class="px-4 py-3 text-xs text-gray-400">
              {{ item.updatedAt ? formatDateTime(item.updatedAt) : '—' }}
            </td>
            <td class="px-4 py-3 text-right">
              <div class="flex justify-end gap-1">
                <UButton v-if="item.status === 'builtin'" color="neutral" variant="soft" size="xs" icon="i-lucide-file-plus" @click="initPrompt(item)">初始化</UButton>
                <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-pencil" @click="openEditor(item)">编辑</UButton>
                <UButton v-if="item.status !== 'builtin'" color="neutral" variant="ghost" size="xs" icon="i-lucide-rotate-ccw" @click="() => { resetConfirm = item }">重置内置</UButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑器 -->
    <USlideover :open="editorOpen" title="提示词编辑器" @update:open="(v: boolean) => { editorOpen = v }">
      <template #body>
        <div v-if="editing" class="flex flex-col gap-4 p-4">
          <UFormField label="名称">
            <UInput v-model="editorName" class="w-full" />
          </UFormField>
          <UFormField label="用途说明">
            <UInput v-model="editorDescription" class="w-full" placeholder="可选" />
          </UFormField>

          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">模板内容</p>
            <UTextarea
              v-model="editorTemplate"
              class="w-full"
              :rows="16"
              placeholder="模板内容"
            />
          </div>

          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">可用占位符</p>
            <div class="flex flex-col gap-1.5">
              <div v-for="ph in editing.placeholders" :key="ph.key" class="rounded-lg bg-gray-50 px-3 py-2">
                <code class="text-xs font-semibold text-primary-700">&#123;&#123;{{ ph.key }}&#125;&#125;</code>
                <span class="ml-2 text-xs font-medium text-gray-600">{{ ph.label }}</span>
                <p v-if="ph.description" class="mt-0.5 text-xs text-gray-400">{{ ph.description }}</p>
              </div>
            </div>
            <p class="mt-2 text-xs text-gray-400">删除占位符 = 不注入对应动态内容；保留全部占位符可保持与内置基线一致。</p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-between gap-2 p-4">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-rotate-ccw" @click="() => { resetConfirm = editing }">重置为内置</UButton>
          <div class="flex gap-2">
            <UButton color="neutral" variant="soft" size="sm" :loading="saving" @click="saveDraft">保存草稿</UButton>
            <UButton color="primary" size="sm" icon="i-lucide-rocket" :loading="publishing" @click="publish">保存并发布</UButton>
          </div>
        </div>
      </template>
    </USlideover>

    <!-- 重置确认 -->
    <UModal v-model:open="resetConfirmOpen">
      <div class="p-6">
        <h3 class="text-lg font-semibold text-gray-900">重置为内置基线？</h3>
        <p class="mt-2 text-sm text-gray-500">
          「{{ resetConfirm?.name }}」的草稿与已发布内容都将清除，运行时回退使用内置提示词。此操作会立即热生效。
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <UButton color="neutral" variant="soft" @click="() => { resetConfirm = null }">取消</UButton>
          <UButton color="error" @click="doReset">确认重置</UButton>
        </div>
      </div>
    </UModal>
  </ManagementPage>
</template>
<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute()
const documentId = route.params.documentId as string
const { moduleLabel, resourceStatusLabel } = useDisplayLabels()
const toast = useToast()

const { data: document, refresh: refreshDocument } = await useFetch<any>(
  `/api/v1/platform-admin/module-resources/documents/${documentId}`
)

const reindexPending = ref(false)
async function reindexDocument() {
  reindexPending.value = true
  try {
    const result = await $fetch(`/api/v1/platform-admin/module-resources/documents/${documentId}/reindex`, {
      method: 'POST'
    })
    toast.add({ title: `向量重建完成：${result.embeddedCount}/${result.chunkCount} 分块已向量化`, color: 'success' })
    await refreshDocument()
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '重建失败', color: 'error' })
  } finally {
    reindexPending.value = false
  }
}

async function deleteDocument() {
  if (!confirm('确定删除该文档及其所有分块数据？此操作不可撤销。')) return
  try {
    await $fetch(`/api/v1/platform-admin/module-resources/documents/${documentId}`, { method: 'DELETE' })
    toast.add({ title: '文档已删除', color: 'success' })
    await navigateTo('/platform-admin/knowledge')
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '删除失败', color: 'error' })
  }
}

const expandedChunks = ref<Set<number>>(new Set())
function toggleChunk(index: number) {
  const s = new Set(expandedChunks.value)
  if (s.has(index)) s.delete(index)
  else s.add(index)
  expandedChunks.value = s
}

function embeddingStatusColor(status: string) {
  switch (status) {
    case 'ready': return 'success'
    case 'pending': return 'warning'
    case 'disabled': return 'neutral'
    case 'partial': return 'warning'
    default: return 'neutral'
  }
}

function embeddingStatusLabel(status: string) {
  switch (status) {
    case 'ready': return '已就绪'
    case 'pending': return '待处理'
    case 'disabled': return '未启用'
    case 'partial': return '部分'
    default: return status
  }
}
</script>

<template>
  <ManagementPage title="文档详情">
    <div v-if="document" class="space-y-6">
      <!-- 面包屑 -->
      <div class="flex items-center gap-2 text-sm text-slate-500">
        <NuxtLink to="/platform-admin/knowledge" class="hover:text-indigo-600">知识库</NuxtLink>
        <span>/</span>
        <span class="text-slate-800">{{ document.title }}</span>
      </div>

      <!-- 文档元数据 -->
      <div class="panel p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-2xl font-semibold">{{ document.title }}</h2>
            <p class="mt-2 text-sm text-slate-500">{{ document.libraryName }} · 知识库 · v{{ document.versionLabel }}</p>
          </div>
          <div class="flex gap-2">
            <UButton size="md" icon="i-lucide-zap" :loading="reindexPending" @click="reindexDocument">重建向量</UButton>
            <UButton size="md" color="error" variant="soft" icon="i-lucide-trash-2" @click="deleteDocument">删除文档</UButton>
          </div>
        </div>

        <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div class="rounded-lg bg-slate-50 p-3 text-sm">
            模块 <strong class="block text-lg">{{ moduleLabel(document.module) }}</strong>
          </div>
          <div class="rounded-lg bg-slate-50 p-3 text-sm">
            类型 <strong class="block text-lg">知识库</strong>
          </div>
          <div class="rounded-lg bg-slate-50 p-3 text-sm">
            状态 <UBadge :color="document.status === 'ready' ? 'success' : 'neutral'" variant="soft" size="xs" class="mt-1">{{ resourceStatusLabel(document.status) }}</UBadge>
          </div>
          <div class="rounded-lg bg-slate-50 p-3 text-sm">
            向量状态 <UBadge :color="embeddingStatusColor(document.embeddingSummary?.status)" variant="soft" size="xs" class="mt-1">
              {{ embeddingStatusLabel(document.embeddingSummary?.status) }}
            </UBadge>
          </div>
          <div class="rounded-lg bg-slate-50 p-3 text-sm">
            分块 <strong class="block text-lg">{{ document.embeddingSummary?.embeddedChunks ?? 0 }}/{{ document.chunkCount }}</strong>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-3 text-xs text-slate-400">
          <div>来源：{{ document.originalFilename || '直接输入' }}</div>
          <div>类型：{{ document.sourceType }}</div>
          <div>内容字符数：{{ document.contentCharCount?.toLocaleString() }}</div>
          <div>向量模型：{{ document.embeddingSummary?.model || '-' }}</div>
          <div>checksum：{{ document.checksum?.slice(0, 12) }}...</div>
          <div>创建时间：{{ new Date(document.createdAt).toLocaleString('zh-CN') }}</div>
        </div>
      </div>

      <!-- 分块列表 -->
      <div class="panel overflow-x-auto p-6">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-lg font-semibold">分块列表（{{ document.chunks?.length ?? 0 }} 块）</h3>
          <UButton v-if="(document.embeddingSummary?.status) !== 'ready'" color="warning" variant="soft" size="sm" icon="i-lucide-zap" :loading="reindexPending" @click="reindexDocument">
            {{ document.embeddingSummary?.embeddedChunks > 0 ? '重建向量' : '生成向量' }}
          </UButton>
        </div>

        <div class="mt-4 space-y-2">
          <div v-for="chunk in document.chunks" :key="chunk.id" class="rounded-lg border border-slate-100 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-mono text-slate-400">#{{ chunk.chunkIndex }}</span>
                  <span v-if="chunk.heading" class="text-sm font-semibold text-slate-700">{{ chunk.heading }}</span>
                  <UBadge :color="chunk.hasEmbedding ? 'success' : 'warning'" variant="soft" size="xs">
                    {{ chunk.hasEmbedding ? '已向量化' : '未向量化' }}
                  </UBadge>
                </div>
                <div @click="toggleChunk(chunk.chunkIndex)" class="mt-2 cursor-pointer">
                  <p v-if="!expandedChunks.has(chunk.chunkIndex)" class="text-sm text-slate-600 line-clamp-3">{{ chunk.content }}</p>
                  <pre v-else class="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm text-slate-700">{{ chunk.content }}</pre>
                  <span class="mt-1 inline-block text-xs text-indigo-500">
                    {{ expandedChunks.has(chunk.chunkIndex) ? '收起' : '展开' }}
                  </span>
                </div>
              </div>
              <div class="shrink-0 space-y-1 text-right text-xs text-slate-400">
                <div>Token 估算: {{ chunk.tokenEstimate }}</div>
                <div v-if="chunk.embeddedAt">向量化时间: {{ new Date(chunk.embeddedAt).toLocaleString('zh-CN') }}</div>
                <div v-if="chunk.embeddingModel">模型: {{ chunk.embeddingModel }}</div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!document.chunks?.length" class="py-16 text-center text-sm text-slate-400">
          该文档没有分块数据。
        </div>
      </div>
    </div>

    <div v-else class="space-y-6">
      <div class="flex items-center gap-2 text-sm text-slate-500">
        <NuxtLink to="/platform-admin/knowledge" class="hover:text-indigo-600">知识库</NuxtLink>
      </div>
      <div class="panel p-16 text-center">
        <p class="text-sm text-slate-400">加载中...</p>
      </div>
    </div>
  </ManagementPage>
</template>
<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { data: resourceData, refresh: refreshResources } = await useFetch<any>('/api/v1/platform-admin/module-resources')
const { moduleLabel, resourceStatusLabel } = useDisplayLabels()
const toast = useToast()

const moduleOptions = [
  { label: '全部模块', value: '__all__' },
  { label: '自我成长', value: 'self_growth' },
  { label: '班级系统', value: 'class_system' },
  { label: '家校沟通', value: 'home_school' },
  { label: '学生个案', value: 'student_case' },
  { label: '学习问题', value: 'learning_problem' }
]

const libraryTypeOptions = [
  { label: '全部类型', value: '__all__' },
  { label: '量表库', value: 'assessment' },
  { label: '归因库', value: 'attribution' },
  { label: '工具库', value: 'tool' },
  { label: '输出模板', value: 'output_template' },
  { label: '关键词路由', value: 'keyword_route' },
  { label: '知识库', value: 'knowledge' }
]

const embeddingStatusOptions = [
  { label: '全部', value: '__all__' },
  { label: '已就绪', value: 'ready' },
  { label: '待处理', value: 'pending' },
  { label: '未启用', value: 'disabled' },
  { label: '部分完成', value: 'partial' }
]

const filters = reactive({
  module: '__all__',
  libraryType: 'knowledge',
  search: '',
  embeddingStatus: '__all__',
  status: '__all__'
})

const page = ref(1)
const pageSize = 20

const documentQuery = computed(() => {
  const params = new URLSearchParams()
  if (filters.module && filters.module !== '__all__') params.set('module', filters.module)
  if (filters.libraryType && filters.libraryType !== '__all__') params.set('libraryType', filters.libraryType)
  if (filters.search) params.set('search', filters.search)
  if (filters.embeddingStatus && filters.embeddingStatus !== '__all__') params.set('embeddingStatus', filters.embeddingStatus)
  if (filters.status && filters.status !== '__all__') params.set('status', filters.status)
  params.set('limit', String(pageSize))
  params.set('offset', String((page.value - 1) * pageSize))
  return `/api/v1/platform-admin/module-resources/documents?${params.toString()}`
})

const { data: documentData, refresh: refreshDocuments } = await useFetch<any>(documentQuery, { watch: [documentQuery] })

const totalDocuments = computed(() => documentData.value?.total ?? 0)
const documents = computed(() => documentData.value?.documents ?? [])

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

// 上传文档
const uploadOpen = ref(false)
const uploadPending = ref(false)
const uploadForm = reactive({
  title: '',
  sourceType: 'markdown' as string,
  content: '',
  originalFilename: '',
  module: 'self_growth' as string,
  tags: '',
  sourceRef: '',
  confirmNoPersonalData: false
})

const libraries = computed(() => resourceData.value?.libraries || [])

async function uploadDocument() {
  if (!uploadForm.title.trim() || !uploadForm.content.trim()) {
    toast.add({ title: '请填写标题和内容', color: 'warning' })
    return
  }
  if (!uploadForm.confirmNoPersonalData) {
    toast.add({ title: '请确认文档不含个人隐私数据', color: 'warning' })
    return
  }
  uploadPending.value = true
  try {
    await $fetch('/api/v1/platform-admin/module-resources/documents', {
      method: 'POST',
      body: {
        title: uploadForm.title.trim(),
        sourceType: uploadForm.sourceType,
        content: uploadForm.content,
        originalFilename: uploadForm.originalFilename || undefined,
        module: uploadForm.module || undefined,
        tags: uploadForm.tags ? uploadForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : undefined,
        sourceRef: uploadForm.sourceRef.trim() || undefined,
        confirmNoPersonalData: true
      }
    })
    toast.add({ title: '文档已上传并开始向量化', color: 'success' })
    uploadOpen.value = false
    uploadForm.title = ''
    uploadForm.content = ''
    uploadForm.originalFilename = ''
    uploadForm.tags = ''
    uploadForm.sourceRef = ''
    uploadForm.confirmNoPersonalData = false
    await refreshDocuments()
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '上传失败', color: 'error' })
  } finally {
    uploadPending.value = false
  }
}

async function deleteDocument(id: string) {
  if (!confirm('确定删除该文档及其所有分块数据？此操作不可撤销。')) return
  try {
    await $fetch(`/api/v1/platform-admin/module-resources/documents/${id}`, { method: 'DELETE' })
    toast.add({ title: '文档已删除', color: 'success' })
    await refreshDocuments()
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '删除失败', color: 'error' })
  }
}

const batchReindexPending = ref(false)
async function batchReindex() {
  batchReindexPending.value = true
  try {
    const result = await $fetch('/api/v1/platform-admin/module-resources/documents/batch-reindex', {
      method: 'POST',
      body: { allPending: true }
    })
    toast.add({ title: `重建完成：${result.processed} 篇文档，${result.totalEmbedded}/${result.totalChunks} 分块已向量化`, color: 'success' })
    await refreshDocuments()
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '批量重建失败', color: 'error' })
  } finally {
    batchReindexPending.value = false
  }
}

// 批量导入
const batchImportOpen = ref(false)
const batchImportPending = ref(false)
const batchImportFile = ref<File | null>(null)
const batchImportFileBase64 = ref('')
const batchImportDefaultModule = ref('self_growth')
const batchImportResult = ref<any>(null)

function onBatchFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  batchImportFile.value = file
  batchImportResult.value = null
  if (file) {
    const reader = new FileReader()
    reader.onload = () => {
      batchImportFileBase64.value = String(reader.result || '').split(',')[1] || ''
    }
    reader.readAsDataURL(file)
  } else {
    batchImportFileBase64.value = ''
  }
}

async function commitBatchImport() {
  if (!batchImportFile.value || !batchImportFileBase64.value) {
    toast.add({ title: '请选择 XLSX 文件', color: 'warning' })
    return
  }
  batchImportPending.value = true
  try {
    batchImportResult.value = await $fetch('/api/v1/platform-admin/module-resources/documents/batch-import', {
      method: 'POST',
      body: {
        contentBase64: batchImportFileBase64.value,
        filename: batchImportFile.value.name,
        defaultModule: batchImportDefaultModule.value
      }
    })
    toast.add({
      title: `导入完成：${batchImportResult.value.imported} 篇文档，${batchImportResult.value.embeddedChunks}/${batchImportResult.value.totalChunks} 分块已向量化`,
      color: 'success'
    })
    batchImportFile.value = null
    batchImportFileBase64.value = ''
    batchImportDefaultModule.value = 'self_growth'
    await refreshDocuments()
  } catch (error: any) {
    toast.add({ title: error?.data?.message || '批量导入失败', color: 'error' })
  } finally {
    batchImportPending.value = false
  }
}

// 导出
const exportPending = ref(false)
async function exportDocuments() {
  exportPending.value = true
  try {
    const params = new URLSearchParams()
    if (filters.module !== '__all__') params.set('module', filters.module)
    if (filters.search) params.set('search', filters.search)
    const url = `/api/v1/platform-admin/module-resources/documents/export?${params.toString()}`
    // 直接触发下载
    const resp = await fetch(url, { credentials: 'include' })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: '导出失败' }))
      throw new Error(err.message || '导出失败')
    }
    const blob = await resp.blob()
    const downloadUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = `knowledge_export_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(downloadUrl)
    toast.add({ title: '导出完成', color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.message || '导出失败', color: 'error' })
  } finally {
    exportPending.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadForm.originalFilename = file.name
  const reader = new FileReader()
  reader.onload = () => {
    uploadForm.content = reader.result as string
    if (file.name.endsWith('.md')) uploadForm.sourceType = 'markdown'
    else if (file.name.endsWith('.json')) uploadForm.sourceType = 'json'
    else uploadForm.sourceType = 'text'
  }
  reader.readAsText(file)
}
</script>

<template>
  <ManagementPage title="知识库" description="管理专业术语、AI 参考文档，支持向量化检索">
    <div class="space-y-6">
      <!-- 筛选栏 -->
      <div class="panel p-4">
        <div class="flex flex-wrap items-end gap-3">
          <div class="w-36">
            <label class="mb-1 block text-xs text-slate-500">模块</label>
            <USelect v-model="filters.module" :items="moduleOptions" size="md" class="w-full" @change="() => { page = 1 }" />
          </div>
          <div class="w-36">
            <label class="mb-1 block text-xs text-slate-500">库类型</label>
            <USelect v-model="filters.libraryType" :items="libraryTypeOptions" size="md" class="w-full" @change="() => { page = 1 }" />
          </div>
          <div class="w-36">
            <label class="mb-1 block text-xs text-slate-500">向量状态</label>
            <USelect v-model="filters.embeddingStatus" :items="embeddingStatusOptions" size="md" class="w-full" @change="() => { page = 1 }" />
          </div>
          <div class="flex-1 min-w-48">
            <label class="mb-1 block text-xs text-slate-500">搜索</label>
            <UInput v-model="filters.search" placeholder="标题或内容关键字..." size="md" class="w-full" @input="() => { page = 1 }" />
          </div>
          <UButton color="neutral" variant="soft" size="md" icon="i-lucide-refresh-cw" @click="() => { refreshDocuments(); refreshResources() }">刷新</UButton>
          <UButton size="md" icon="i-lucide-plus" @click="() => { uploadOpen = true }">上传文档</UButton>
          <UButton color="neutral" variant="soft" size="md" icon="i-lucide-file-down" as="a" href="/templates/knowledge.xlsx" download external>下载模板</UButton>
          <UButton color="neutral" variant="soft" size="md" icon="i-lucide-upload-cloud" @click="() => { batchImportOpen = true }">批量导入</UButton>
          <UButton color="neutral" variant="soft" size="md" icon="i-lucide-download" @click="exportDocuments">导出</UButton>
          <UButton color="warning" variant="soft" size="md" icon="i-lucide-zap" :loading="batchReindexPending" @click="batchReindex">重建全部待处理向量</UButton>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="grid gap-4 sm:grid-cols-4">
        <div class="rounded-lg bg-white p-4 text-sm shadow-sm">
          文档总数 <strong class="block text-3xl">{{ totalDocuments }}</strong>
        </div>
        <div class="rounded-lg bg-white p-4 text-sm shadow-sm">
          已就绪 <strong class="block text-3xl text-green-600">{{ documents.filter((d: any) => d.embeddingStatus === 'ready').length }}</strong>
        </div>
        <div class="rounded-lg bg-white p-4 text-sm shadow-sm">
          待处理 <strong class="block text-3xl text-amber-600">{{ documents.filter((d: any) => d.embeddingStatus === 'pending').length }}</strong>
        </div>
        <div class="rounded-lg bg-white p-4 text-sm shadow-sm">
          未启用 <strong class="block text-3xl text-slate-400">{{ documents.filter((d: any) => d.embeddingStatus === 'disabled').length }}</strong>
        </div>
      </div>

      <!-- 文档列表 -->
      <div class="panel overflow-x-auto p-6">
        <table class="w-full text-left text-sm">
          <thead class="text-xs text-slate-400">
            <tr>
              <th class="py-3 pr-4">标题</th>
              <th class="pr-4">资源库</th>
              <th class="pr-4">库类型</th>
              <th class="pr-4">版本</th>
              <th class="pr-4">向量状态</th>
              <th class="pr-4">分块</th>
              <th class="pr-4">创建时间</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in documents" :key="doc.id" class="border-t border-slate-100">
              <td class="py-4 pr-4">
                <NuxtLink :to="`/platform-admin/knowledge/${doc.id}`" class="font-medium text-indigo-600 hover:underline">
                  {{ doc.title }}
                </NuxtLink>
                <p class="mt-0.5 text-xs text-slate-400">{{ doc.originalFilename || '-' }}</p>
              </td>
              <td class="pr-4 text-xs text-slate-500">{{ doc.libraryName || '-' }}</td>
              <td class="pr-4"><UBadge color="neutral" variant="soft" size="xs">知识库</UBadge></td>
              <td class="pr-4 text-xs text-slate-500">v{{ doc.versionLabel || '-' }}</td>
              <td class="pr-4">
                <UBadge :color="embeddingStatusColor(doc.embeddingStatus)" variant="soft" size="xs">
                  {{ embeddingStatusLabel(doc.embeddingStatus) }}
                </UBadge>
              </td>
              <td class="pr-4 text-xs text-slate-500">{{ doc.embeddedChunkCount ?? 0 }}/{{ doc.chunkCount ?? 0 }}</td>
              <td class="pr-4 text-xs text-slate-400">{{ new Date(doc.createdAt).toLocaleString('zh-CN') }}</td>
              <td class="space-x-1 text-right">
                <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-eye" :to="`/platform-admin/knowledge/${doc.id}`">详情</UButton>
                <UButton size="sm" color="error" variant="soft" icon="i-lucide-trash-2" @click="deleteDocument(doc.id)">删除</UButton>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!documents.length" class="py-16 text-center text-sm text-slate-400">
          暂无文档。点击"上传文档"添加知识库内容。
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalDocuments > pageSize" class="flex items-center justify-between">
        <span class="text-sm text-slate-500">共 {{ totalDocuments }} 篇文档</span>
        <div class="flex gap-2">
          <UButton size="sm" color="neutral" variant="soft" :disabled="page <= 1" @click="() => { page-- }">上一页</UButton>
          <UButton size="sm" color="neutral" variant="soft">{{ page }}</UButton>
          <UButton size="sm" color="neutral" variant="soft" :disabled="page * pageSize >= totalDocuments" @click="() => { page++ }">下一页</UButton>
        </div>
      </div>

      <!-- 上传弹窗 -->
      <UModal v-model:open="uploadOpen" title="上传知识文档">
        <template #body>
          <div class="space-y-4">
            <UFormField label="文档标题">
              <UInput v-model="uploadForm.title" placeholder="例如：认知行为疗法术语表" class="w-full" />
            </UFormField>
            <UFormField label="所属模块">
              <USelect v-model="uploadForm.module" :items="[
                { label: '自我成长', value: 'self_growth' },
                { label: '班级系统', value: 'class_system' },
                { label: '家校沟通', value: 'home_school' },
                { label: '学生个案', value: 'student_case' },
                { label: '学习问题', value: 'learning_problem' }
              ]" class="w-full" />
            </UFormField>
            <UFormField label="文档类型">
              <USelect v-model="uploadForm.sourceType" :items="[
                { label: 'Markdown', value: 'markdown' },
                { label: '纯文本', value: 'text' },
                { label: 'JSON', value: 'json' }
              ]" class="w-full" />
            </UFormField>
            <UFormField label="标签关键词">
              <UInput v-model="uploadForm.tags" placeholder="逗号分隔，如：术语,干预方法,评估标准" class="w-full" />
              <p class="mt-1 text-xs text-slate-400">可选。多个标签用逗号或中文逗号分隔。</p>
            </UFormField>
            <UFormField label="来源出处">
              <UInput v-model="uploadForm.sourceRef" placeholder="如：《班主任工作手册》第3章" class="w-full" />
              <p class="mt-1 text-xs text-slate-400">可选。标注资料原始来源，便于引用追溯。</p>
            </UFormField>
            <UFormField label="上传文件">
              <input type="file" accept=".md,.txt,.json" class="block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm" @change="onFileChange" />
              <p class="mt-1 text-xs text-slate-400">支持 .md / .txt / .json 格式。也可直接在下方粘贴内容。</p>
            </UFormField>
            <UFormField label="内容（可直接粘贴）">
              <UTextarea v-model="uploadForm.content" :rows="12" placeholder="粘贴 Markdown 或纯文本内容..." class="w-full font-mono text-sm" />
            </UFormField>
            <label class="flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" v-model="uploadForm.confirmNoPersonalData" class="mt-0.5" />
              <span>我确认此文档<strong>不含学生/教师/家长的姓名、身份证号、联系方式等个人隐私数据</strong></span>
            </label>
            <div class="flex justify-end gap-3">
              <UButton color="neutral" variant="soft" @click="() => { uploadOpen = false }">取消</UButton>
              <UButton color="primary" :loading="uploadPending" @click="uploadDocument" :disabled="!uploadForm.title.trim() || !uploadForm.content.trim()">上传并向量化</UButton>
            </div>
          </div>
        </template>
      </UModal>

      <!-- 批量导入 Slideover -->
      <USlideover v-model:open="batchImportOpen" title="批量导入知识文档" description="上传知识库填写模板，批量导入文档并自动向量化。">
        <template #body>
          <div class="mb-5 flex items-center gap-3 rounded-lg border border-primary-100 bg-primary-50/60 p-3">
            <UIcon name="i-lucide-file-down" class="size-5 shrink-0 text-primary-500" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-primary-800">知识库填写模板</p>
              <p class="text-xs text-primary-500">下载模板，按列填写后在此上传批量导入。</p>
            </div>
            <UButton
              as="a"
              external
              href="/templates/knowledge.xlsx"
              download="知识库填写模板.xlsx"
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lucide-download"
            >下载</UButton>
          </div>

          <div class="space-y-5">
            <UFormField label="知识库 XLSX 文件">
              <input type="file" accept=".xlsx,.xls" class="block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm" @change="onBatchFileChange" />
              <p class="mt-1 text-xs text-slate-400">支持 .xlsx / .xls 格式。Excel 中每行的「所属模块」列可覆盖下方默认值。</p>
            </UFormField>
            <UFormField label="默认所属模块" help="当 Excel 行内未填写所属模块时，使用此默认值。">
              <USelect v-model="batchImportDefaultModule" :items="[
                { label: '自我成长', value: 'self_growth' },
                { label: '班级系统', value: 'class_system' },
                { label: '家校沟通', value: 'home_school' },
                { label: '学生个案', value: 'student_case' },
                { label: '学习问题', value: 'learning_problem' }
              ]" class="w-full" />
            </UFormField>
            <div class="flex gap-3">
              <UButton color="primary" icon="i-lucide-upload-cloud" :disabled="!batchImportFile" :loading="batchImportPending" @click="commitBatchImport">确认导入</UButton>
            </div>
          </div>

          <!-- 导入结果 -->
          <div v-if="batchImportResult" class="mt-6 space-y-4 border-t border-slate-100 pt-6">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-slate-700">导入结果</h3>
              <UBadge color="success" variant="soft" size="xs">完成</UBadge>
            </div>
            <div class="flex divide-x divide-slate-100 rounded-lg bg-slate-50/70">
              <div class="flex-1 px-3 py-2.5 text-center text-xs text-slate-500">导入文档 <strong class="block text-base text-slate-700">{{ batchImportResult.imported }}</strong></div>
              <div class="flex-1 px-3 py-2.5 text-center text-xs text-slate-500">总分块 <strong class="block text-base text-slate-700">{{ batchImportResult.totalChunks }}</strong></div>
              <div class="flex-1 px-3 py-2.5 text-center text-xs text-slate-500">已向量化 <strong class="block text-base text-indigo-600">{{ batchImportResult.embeddedChunks }}</strong></div>
            </div>
          </div>
        </template>
      </USlideover>

    </div>
  </ManagementPage>
</template>
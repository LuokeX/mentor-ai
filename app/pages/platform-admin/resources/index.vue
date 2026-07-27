<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { data: dashboard } = await useFetch<any>('/api/v1/platform-admin/dashboard')
const { data: resourceData, refresh: refreshResources } = await useFetch<any>('/api/v1/platform-admin/module-resources')
const { data: resourceQuality, refresh: refreshResourceQuality } = await useFetch<any>('/api/v1/platform-admin/resource-quality')
const toast = useToast()
const { moduleLabel, libraryTypeLabel, resourceScopeLabel, resourceStatusLabel, resourceStatusColor } = useDisplayLabels()

const moduleOptions = [
  { label: '自我成长', value: 'self_growth' },
  { label: '班级系统', value: 'class_system' },
  { label: '家校沟通', value: 'home_school' },
  { label: '学生个案', value: 'student_case' },
  { label: '学习问题', value: 'learning_problem' }
]
const libraryTypeOptions = [
  { label: '量表库', value: 'assessment' },
  { label: '归因库', value: 'attribution' },
  { label: '工具库', value: 'tool' }
]
const scopeOptions = [
  { label: '平台默认', value: 'global' },
  { label: '校本覆盖', value: 'school' }
]
const issueColor: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error'
}
const AUTO_LIBRARY_ID = '__auto__'

const form = reactive({
  module: 'home_school',
  libraryType: 'assessment',
  scope: 'global',
  schoolId: '',
  libraryId: AUTO_LIBRARY_ID,
  libraryName: '',
  libraryDescription: '',
  version: '1.0.0',
  notes: '',
  publish: false,
  confirmNoPersonalData: false
})
const selectedFile = ref<File | null>(null)
const fileBase64 = ref('')
const pending = ref(false)
const previewResult = ref<any>(null)
const projectionOpen = ref(false)
const projectionResult = ref<any>(null)
const versionPreviewOpen = ref(false)
const versionPreviewResult = ref<any>(null)

const matchingLibraries = computed(() => (resourceData.value?.libraries || []).filter((item: any) =>
  item.module === form.module
  && item.libraryType === form.libraryType
  && item.scope === form.scope
  && (form.scope === 'global' || item.schoolId === form.schoolId)
))
const allVersions = computed(() => resourceData.value?.versions || [])
const selectedLibraryVersions = computed(() => allVersions.value.filter((version: any) =>
  form.libraryId !== AUTO_LIBRARY_ID && version.libraryId === form.libraryId
))
const publishedCount = computed(() => allVersions.value.filter((version: any) => version.status === 'published').length)
const expectedResourceKeys = computed(() => moduleOptions.flatMap(module => libraryTypeOptions.map(type => `${module.value}:${type.value}`)))
const publishedKeys = computed(() => new Set((resourceData.value?.libraries || []).flatMap((library: any) =>
  allVersions.value.some((version: any) => version.libraryId === library.id && version.status === 'published')
    ? [`${library.module}:${library.libraryType}`]
    : []
)))
const coverageRate = computed(() => expectedResourceKeys.value.length
  ? Math.round((publishedKeys.value.size / expectedResourceKeys.value.length) * 100)
  : 0)

watch(matchingLibraries, (libraries) => {
  if (form.libraryId === AUTO_LIBRARY_ID || libraries.some((item: any) => item.id === form.libraryId)) return
  form.libraryId = AUTO_LIBRARY_ID
}, { immediate: true })

watch(() => [form.module, form.libraryType, form.scope, form.schoolId], () => {
  previewResult.value = null
})

function libraryLabel(item: any) {
  const scope = item.scope === 'global' ? '平台默认' : '校本覆盖'
  return `${item.name} · ${scope}`
}

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] || null
  selectedFile.value = file
  previewResult.value = null
  fileBase64.value = file ? await fileToBase64(file) : ''
}

function buildBody(extra: Record<string, unknown> = {}) {
  if (!selectedFile.value) throw new Error('请选择资源文件')
  const selectedLibraryId = form.libraryId === AUTO_LIBRARY_ID ? '' : form.libraryId
  return {
    libraryId: selectedLibraryId || undefined,
    module: form.module,
    libraryType: form.libraryType,
    scope: form.scope,
    schoolId: form.scope === 'school' ? form.schoolId : undefined,
    libraryName: selectedLibraryId ? undefined : form.libraryName,
    libraryDescription: form.libraryDescription || undefined,
    version: form.version,
    notes: form.notes || undefined,
    filename: selectedFile.value.name,
    contentBase64: fileBase64.value,
    confirmNoPersonalData: form.confirmNoPersonalData,
    publish: form.publish,
    ...extra
  }
}

async function previewImport() {
  pending.value = true
  try {
    previewResult.value = await $fetch('/api/v1/platform-admin/module-resources/import-preview', {
      method: 'POST',
      body: buildBody()
    })
    toast.add({ title: previewResult.value.validation.ok ? '预检完成' : '预检发现错误', color: previewResult.value.validation.ok ? 'success' : 'error' })
  } catch (error: any) {
    toast.add({ title: '预检失败', description: error?.data?.message || '请检查文件和字段', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function commitImport() {
  pending.value = true
  try {
    await $fetch('/api/v1/platform-admin/module-resources/import', {
      method: 'POST',
      body: buildBody()
    })
    await refreshResources()
    await refreshResourceQuality()
    previewResult.value = null
    selectedFile.value = null
    fileBase64.value = ''
    form.confirmNoPersonalData = false
    toast.add({ title: form.publish ? '资源已导入并发布' : '资源草稿已导入', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '导入失败', description: error?.data?.message || '请根据预检结果修正', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function versionAction(id: string, action: 'publish' | 'retire' | 'rollback') {
  pending.value = true
  try {
    await $fetch(`/api/v1/platform-admin/module-resources/versions/${id}`, { method: 'PATCH', body: { action } })
    await refreshResources()
    toast.add({ title: action === 'retire' ? '版本已停用' : '版本已发布', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '版本操作失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function inspectProjection(id: string) {
  pending.value = true
  try {
    projectionResult.value = await $fetch(`/api/v1/platform-admin/module-resources/versions/${id}/projection`)
    projectionOpen.value = true
  } catch (error: any) {
    toast.add({ title: '投影读取失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function inspectPreview(id: string) {
  pending.value = true
  try {
    versionPreviewResult.value = await $fetch(`/api/v1/platform-admin/module-resources/versions/${id}/preview`, { method: 'POST' })
    versionPreviewOpen.value = true
  } catch (error: any) {
    toast.add({ title: '版本预览失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    pending.value = false
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-indigo-700">三库运营台</p>
        <h1 class="mt-2 text-3xl font-semibold">资源导入、校验与发布</h1>
        <p class="mt-2 text-sm text-slate-500">面向业务整理后的量表库、归因库和工具库；默认不读取旧原始资料。</p>
      </div>
      <UButton to="/platform-admin" color="neutral" variant="soft" icon="i-lucide-arrow-left">返回平台后台</UButton>
    </div>

    <div class="mt-6 grid gap-4 sm:grid-cols-4">
      <div class="panel p-5"><p class="text-sm text-slate-500">资源库</p><strong class="mt-2 block text-3xl">{{ resourceData?.libraries?.length || 0 }}</strong></div>
      <div class="panel p-5"><p class="text-sm text-slate-500">版本</p><strong class="mt-2 block text-3xl">{{ resourceData?.versions?.length || 0 }}</strong></div>
      <div class="panel p-5"><p class="text-sm text-slate-500">已发布</p><strong class="mt-2 block text-3xl">{{ publishedCount }}</strong></div>
      <div class="panel p-5"><p class="text-sm text-slate-500">发布覆盖率</p><strong class="mt-2 block text-3xl">{{ coverageRate }}%</strong></div>
    </div>

    <div class="panel mt-6 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold">质量反哺</h2>
          <p class="mt-1 text-sm text-slate-500">汇总方案反馈，不展示学校业务正文。</p>
        </div>
        <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-refresh-cw" @click="() => refreshResourceQuality()">刷新</UButton>
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-5">
        <div class="rounded-lg bg-slate-50 p-4 text-sm">反馈 <strong class="block text-2xl">{{ resourceQuality?.summary?.feedbackCount || 0 }}</strong></div>
        <div class="rounded-lg bg-slate-50 p-4 text-sm">模块 <strong class="block text-2xl">{{ resourceQuality?.summary?.moduleCount || 0 }}</strong></div>
        <div class="rounded-lg bg-slate-50 p-4 text-sm">版本 <strong class="block text-2xl">{{ resourceQuality?.summary?.trackedVersionCount || 0 }}</strong></div>
        <div class="rounded-lg bg-slate-50 p-4 text-sm">规则 <strong class="block text-2xl">{{ resourceQuality?.summary?.trackedRuleCount || 0 }}</strong></div>
        <div class="rounded-lg bg-slate-50 p-4 text-sm">工具 <strong class="block text-2xl">{{ resourceQuality?.summary?.trackedToolCount || 0 }}</strong></div>
      </div>
      <div class="mt-5 grid gap-5 lg:grid-cols-3">
        <div>
          <h3 class="text-sm font-semibold">优先修订规则</h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.rules?.slice(0, 6) || []" :key="`${item.module}:${item.code}`" class="rounded-lg bg-red-50 p-3 text-sm">
              <strong>{{ item.code }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · 归因 {{ item.attributionAccuracy }}/5 · {{ item.count }} 次反馈</p>
            </div>
            <p v-if="!resourceQuality?.rules?.length" class="py-6 text-center text-sm text-slate-400">暂无规则反馈</p>
          </div>
        </div>
        <div>
          <h3 class="text-sm font-semibold">优先修订工具</h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.tools?.slice(0, 6) || []" :key="`${item.module}:${item.code}`" class="rounded-lg bg-amber-50 p-3 text-sm">
              <strong>{{ item.code }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · 工具 {{ item.toolUsability }}/5 · 过难率 {{ Math.round((item.hardActionRate || 0) * 100) }}%</p>
            </div>
            <p v-if="!resourceQuality?.tools?.length" class="py-6 text-center text-sm text-slate-400">暂无工具反馈</p>
          </div>
        </div>
        <div>
          <h3 class="text-sm font-semibold">版本质量</h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.versions?.slice(0, 6) || []" :key="item.code" class="rounded-lg bg-sky-50 p-3 text-sm">
              <strong>{{ item.version || item.code.slice(0, 8) }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · {{ libraryTypeLabel(item.libraryType) }} · {{ item.count }} 次反馈</p>
            </div>
            <p v-if="!resourceQuality?.versions?.length" class="py-6 text-center text-sm text-slate-400">暂无版本反馈</p>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <form class="panel space-y-5 p-6" @submit.prevent="previewImport">
        <div>
          <h2 class="text-xl font-semibold">上传标准资源</h2>
          <p class="mt-1 text-sm text-slate-500">支持模板 Excel 或 JSON。先预检，再确认写入。</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="模块"><USelect v-model="form.module" :items="moduleOptions" class="w-full" /></UFormField>
          <UFormField label="库类型"><USelect v-model="form.libraryType" :items="libraryTypeOptions" class="w-full" /></UFormField>
          <UFormField label="范围"><USelect v-model="form.scope" :items="scopeOptions" class="w-full" /></UFormField>
          <UFormField v-if="form.scope === 'school'" label="学校"><USelect v-model="form.schoolId" :items="dashboard?.schools?.map((school:any)=>({label:school.name,value:school.id})) || []" class="w-full" /></UFormField>
        </div>
        <UFormField label="已有资源库">
          <USelect v-model="form.libraryId" :items="[{label:'自动创建或复用匹配资源库',value:AUTO_LIBRARY_ID}, ...matchingLibraries.map((item:any)=>({label:libraryLabel(item),value:item.id}))]" class="w-full" />
        </UFormField>
        <div v-if="form.libraryId === AUTO_LIBRARY_ID" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="资源库名称"><UInput v-model="form.libraryName" class="w-full" /></UFormField>
          <UFormField label="版本号"><UInput v-model="form.version" class="w-full" /></UFormField>
          <UFormField class="sm:col-span-2" label="资源库说明"><UTextarea v-model="form.libraryDescription" :rows="2" class="w-full" /></UFormField>
        </div>
        <UFormField v-else label="版本号"><UInput v-model="form.version" class="w-full" /></UFormField>
        <UFormField label="版本说明"><UInput v-model="form.notes" class="w-full" /></UFormField>
        <UFormField label="资源文件" help="接受 .xlsx、.xls、.json；不得包含真实个人业务数据。">
          <input type="file" accept=".xlsx,.xls,.json,application/json" class="block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm" @change="onFileChange" />
        </UFormField>
        <div class="flex flex-wrap gap-4">
          <UCheckbox v-model="form.confirmNoPersonalData" label="确认不含真实个人业务数据" />
          <UCheckbox v-model="form.publish" label="预检通过后直接发布" />
        </div>
        <div class="flex gap-3">
          <UButton type="submit" icon="i-lucide-shield-check" :disabled="!selectedFile || !form.confirmNoPersonalData || (form.libraryId === AUTO_LIBRARY_ID && matchingLibraries.length === 0 && form.libraryName.trim().length < 2)" :loading="pending">预检</UButton>
          <UButton color="primary" variant="soft" icon="i-lucide-upload-cloud" :disabled="!previewResult?.validation?.ok" :loading="pending" @click="commitImport">确认导入</UButton>
        </div>
      </form>

      <div class="panel p-6">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">预检结果</h2>
            <p class="mt-1 text-sm text-slate-500">错误会阻断导入；警告允许导入但建议业务补齐。</p>
          </div>
          <UBadge v-if="previewResult" :color="previewResult.validation.ok ? (previewResult.validation.warnings?.length ? 'warning' : 'success') : 'error'" variant="soft">
            {{ previewResult.validation.ok ? (previewResult.validation.warnings?.length ? '有警告' : '通过') : '失败' }}
          </UBadge>
        </div>
        <div v-if="previewResult" class="mt-5 space-y-5">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg bg-slate-50 p-4 text-sm">量表 <strong class="block text-2xl">{{ previewResult.projection.assessmentCount }}</strong></div>
            <div class="rounded-lg bg-slate-50 p-4 text-sm">规则 <strong class="block text-2xl">{{ previewResult.projection.attributionRuleCount }}</strong></div>
            <div class="rounded-lg bg-slate-50 p-4 text-sm">工具 <strong class="block text-2xl">{{ previewResult.projection.toolCount }}</strong></div>
          </div>
          <div v-if="previewResult.validation.errors?.length" class="rounded-lg border border-red-200 bg-red-50 p-4">
            <p class="text-sm font-semibold text-red-700">错误</p>
            <p v-for="issue in previewResult.validation.errors" :key="`${issue.path}:${issue.message}`" class="mt-2 text-xs text-red-700">{{ issue.path ? `${issue.path} · ` : '' }}{{ issue.message }}</p>
          </div>
          <div v-if="previewResult.validation.warnings?.length" class="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p class="text-sm font-semibold text-amber-700">警告</p>
            <p v-for="issue in previewResult.validation.warnings.slice(0, 12)" :key="`${issue.path}:${issue.message}`" class="mt-2 text-xs text-amber-700">{{ issue.path ? `${issue.path} · ` : '' }}{{ issue.message }}</p>
          </div>
          <pre class="max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{{ JSON.stringify(previewResult.preview, null, 2) }}</code></pre>
        </div>
        <div v-else class="mt-5 rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">上传文件后先执行预检。</div>
      </div>
    </div>

    <div class="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div class="panel p-6">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-xl font-semibold">资源库</h2>
          <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-refresh-cw" @click="() => refreshResources()">刷新</UButton>
        </div>
        <div class="mt-4 space-y-3">
          <button v-for="library in resourceData?.libraries || []" :key="library.id" type="button" class="w-full rounded-lg border p-4 text-left transition" :class="form.libraryId === library.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-100 hover:bg-slate-50'" @click="Object.assign(form, { module: library.module, libraryType: library.libraryType, scope: library.scope, schoolId: library.schoolId || '', libraryId: library.id })">
            <div class="flex items-start justify-between gap-3">
              <div><strong>{{ moduleLabel(library.module) }} · {{ libraryTypeLabel(library.libraryType) }}</strong><p class="mt-1 text-xs text-slate-400">{{ resourceScopeLabel(library.scope) }}</p></div>
              <UBadge color="neutral" variant="soft">{{ allVersions.filter((version:any)=>version.libraryId===library.id).length }} 版</UBadge>
            </div>
          </button>
          <p v-if="!resourceData?.libraries?.length" class="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">暂无资源库。新版业务库导入后会显示在这里。</p>
        </div>
      </div>

      <div class="panel p-6">
        <h2 class="text-xl font-semibold">版本管理</h2>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-slate-400"><tr><th class="py-3">版本</th><th>状态</th><th>更新时间</th><th class="text-right">操作</th></tr></thead>
            <tbody>
              <tr v-for="version in selectedLibraryVersions" :key="version.id" class="border-t border-slate-100">
                <td class="py-4"><strong>{{ version.version }}</strong><p class="mt-1 max-w-sm truncate text-xs text-slate-400">{{ version.notes || '暂无说明' }}</p></td>
                <td><UBadge :color="resourceStatusColor(version.status)" variant="soft">{{ resourceStatusLabel(version.status) }}</UBadge></td>
                <td class="text-xs text-slate-400">{{ new Date(version.updatedAt).toLocaleString('zh-CN') }}</td>
                <td class="space-x-1 text-right">
                  <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-pencil" @click="() => { navigateTo(`/platform-admin/resources/edit/${version.id}`) }">编辑</UButton>
                  <UButton v-if="version.status !== 'published'" size="xs" @click="versionAction(version.id, 'publish')">发布</UButton>
                  <UButton v-if="version.status === 'published'" size="xs" color="neutral" variant="soft" @click="versionAction(version.id, 'retire')">停用</UButton>
                  <UButton v-if="version.status === 'retired'" size="xs" color="neutral" variant="soft" @click="versionAction(version.id, 'rollback')">回滚</UButton>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!selectedLibraryVersions.length" class="py-12 text-center text-sm text-slate-400">请选择资源库查看版本。</p>
        </div>
      </div>
    </div>

    <UModal v-model:open="versionPreviewOpen" title="版本预览">
      <template #body>
        <pre class="max-h-[65vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{{ JSON.stringify(versionPreviewResult, null, 2) }}</code></pre>
      </template>
    </UModal>
    <UModal v-model:open="projectionOpen" title="结构化投影">
      <template #body>
        <div class="mb-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg bg-slate-50 p-4 text-sm">量表 <strong class="block text-2xl">{{ projectionResult?.summary?.assessmentCount || 0 }}</strong></div>
          <div class="rounded-lg bg-slate-50 p-4 text-sm">规则 <strong class="block text-2xl">{{ projectionResult?.summary?.attributionRuleCount || 0 }}</strong></div>
          <div class="rounded-lg bg-slate-50 p-4 text-sm">工具 <strong class="block text-2xl">{{ projectionResult?.summary?.toolCount || 0 }}</strong></div>
        </div>
        <pre class="max-h-[60vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{{ JSON.stringify(projectionResult, null, 2) }}</code></pre>
      </template>
    </UModal>
  </div>

</template>
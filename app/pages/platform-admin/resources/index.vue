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
  { label: '工具库', value: 'tool' },
  { label: '输出模板', value: 'output_template' },
  { label: '关键词路由', value: 'keyword_route' }
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

const form = reactive({
  module: 'home_school',
  scope: 'global',
  schoolId: '',
  version: '1.0.0',
  notes: '',
  publish: false,
  confirmNoPersonalData: false
})
const pending = ref(false)
const projectionOpen = ref(false)
const projectionResult = ref<any>(null)
const versionPreviewOpen = ref(false)
const versionPreviewResult = ref<any>(null)
const expandedLibrary = ref<string | null>(null)
const importOpen = ref(false)
/** 整套导入（批量）：一次上传多个库文件、同一版本号，上传的库之间互相校验，未上传的库回退现行已发布版本 */
const batchFiles = reactive<Record<string, { file: File | null, base64: string }>>({
  assessment: { file: null, base64: '' },
  attribution: { file: null, base64: '' },
  tool: { file: null, base64: '' },
  output_template: { file: null, base64: '' },
  keyword_route: { file: null, base64: '' }
})
const batchPreviewResult = ref<any>(null)

const allVersions = computed(() => resourceData.value?.versions || [])
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

watch(() => [form.module, form.scope, form.schoolId], () => {
  batchPreviewResult.value = null
})

// ===== 量表编排诊断 =====
// triggerError 一直声明「供运营台排查」却没有任何入口。这里补上：
// 把编排关系摊开，并标出会让量表永远激活不了的问题。
const mapModule = ref(moduleOptions[0]!.value)
const { data: instrumentMap, pending: mapPending, refresh: refreshInstrumentMap } = await useFetch<any>(
  '/api/v1/platform-admin/module-resources/instrument-map',
  { query: computed(() => ({ module: mapModule.value })) }
)
const INSTRUMENT_ROLE_TEXT: Record<string, string> = {
  screening: '入口筛查', deep_dive: '深度诊断', situational: '专项/情境', red_line: '红线检查'
}

const batchCrossRefErrors = computed(() =>
  (batchPreviewResult.value?.crossRef?.issues || []).filter((issue: any) => issue.severity === 'error'))
const batchCrossRefWarnings = computed(() =>
  (batchPreviewResult.value?.crossRef?.issues || []).filter((issue: any) => issue.severity === 'warning'))

/** 发布被校验拦下时的结构化明细。只弹 toast 的话管理员不知道该改哪一行。 */
const blockedIssues = ref<Array<{ severity: string, message: string, source?: string }>>([])
const blockedTitle = ref('')

// ===== 整套导入（批量） =====
/** 必须 5 个文件全传才允许预检 */
const batchHasFile = computed(() => Object.values(batchFiles).every(slot => slot.file))
/** 版本号必须是真实版本号（x.y.z），不是随意标签 */
const versionValid = computed(() => /^\d+\.\d+\.\d+$/.test(form.version))

async function onBatchFileChange(event: Event, libraryType: string) {
  const file = (event.target as HTMLInputElement).files?.[0] || null
  batchFiles[libraryType]!.file = file
  batchFiles[libraryType]!.base64 = file ? await fileToBase64(file) : ''
  batchPreviewResult.value = null
}

function buildBatchBody() {
  const files: Array<{ libraryType: string, filename: string, contentBase64: string }> = []
  for (const option of libraryTypeOptions) {
    const slot = batchFiles[option.value]
    if (!slot?.file) continue
    files.push({ libraryType: option.value, filename: slot.file.name, contentBase64: slot.base64 })
  }
  if (files.length !== 5) throw new Error('必须上传全部 5 个库文件')
  return {
    module: form.module,
    scope: form.scope,
    schoolId: form.scope === 'school' ? form.schoolId : undefined,
    version: form.version,
    notes: form.notes || undefined,
    files,
    confirmNoPersonalData: form.confirmNoPersonalData,
    publish: form.publish
  }
}

async function previewBatchImport() {
  pending.value = true
  try {
    batchPreviewResult.value = await $fetch('/api/v1/platform-admin/module-resources/import-batch-preview', {
      method: 'POST',
      body: buildBatchBody()
    })
    toast.add({
      title: batchPreviewResult.value.canImport ? '整套预检通过' : '整套预检发现错误',
      description: batchPreviewResult.value.canImport ? '本次上传的库之间校验通过' : '库内校验或跨库引用存在错误，请先修正',
      color: batchPreviewResult.value.canImport ? 'success' : 'error'
    })
  } catch (error: any) {
    toast.add({ title: '预检失败', description: error?.data?.message || '请检查文件和字段', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function commitBatchImport() {
  pending.value = true
  try {
    await $fetch('/api/v1/platform-admin/module-resources/import-batch', {
      method: 'POST',
      body: buildBatchBody()
    })
    await refreshResources()
    await refreshResourceQuality()
    batchPreviewResult.value = null
    for (const key of Object.keys(batchFiles)) {
      batchFiles[key]!.file = null
      batchFiles[key]!.base64 = ''
    }
    form.confirmNoPersonalData = false
    importOpen.value = false
    toast.add({ title: form.publish ? '资源已整套导入并发布' : '资源草稿已整套导入', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '导入失败', description: error?.data?.message || '请根据预检结果修正', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function versionAction(id: string, action: 'publish' | 'retire' | 'rollback') {
  pending.value = true
  blockedIssues.value = []
  try {
    await $fetch(`/api/v1/platform-admin/module-resources/versions/${id}`, { method: 'PATCH', body: { action } })
    await refreshResources()
    toast.add({ title: action === 'retire' ? '版本已停用' : '版本已发布', color: 'success' })
  } catch (error: any) {
    const data = error?.data?.data
    const crossRef = (data?.crossRef?.issues || []).filter((issue: any) => issue.severity === 'error')
      .map((issue: any) => ({
        severity: 'error',
        message: issue.message,
        source: [issue.sourceLibraryType, issue.sourceCode, issue.sourceField].filter(Boolean).join(' · ')
      }))
    const validation = (data?.validation?.errors || []).map((issue: any) => ({
      severity: 'error', message: issue.message, source: issue.path
    }))
    blockedIssues.value = [...validation, ...crossRef]
    blockedTitle.value = crossRef.length ? '跨库引用校验未通过，已阻止发布' : '资源版本校验未通过，已阻止发布'
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
  <ManagementPage title="三库运营台" description="面向业务整理后的量表库、归因库和工具库；默认不读取旧原始资料。">

    <!-- ===== 统计横条 ===== -->
    <div class="grid grid-cols-2 divide-x divide-slate-100 overflow-hidden rounded-xl border border-slate-100 bg-white sm:grid-cols-4">
      <div class="px-5 py-4">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">资源库</p>
        <strong class="mt-1 block text-2xl text-slate-800">{{ resourceData?.libraries?.length || 0 }}</strong>
      </div>
      <div class="px-5 py-4">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">版本</p>
        <strong class="mt-1 block text-2xl text-slate-800">{{ resourceData?.versions?.length || 0 }}</strong>
      </div>
      <div class="px-5 py-4">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">已发布</p>
        <strong class="mt-1 block text-2xl text-slate-800">{{ publishedCount }}</strong>
      </div>
      <div class="px-5 py-4">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">发布覆盖率</p>
        <strong class="mt-1 block text-2xl text-slate-800">{{ coverageRate }}%</strong>
      </div>
    </div>

    <!-- ===== 量表编排诊断 ===== -->
    <section class="mb-6 rounded-xl border border-slate-100 bg-white p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">量表编排</h2>
          <p class="mt-0.5 text-sm text-slate-400">
            该模块已发布量表的角色与前置/触发关系。触发条件写错时教师端只会显示「当前不需要做」，不会报错——在这里能看出来。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <USelect v-model="mapModule" :items="moduleOptions" class="w-40" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="mapPending" @click="() => refreshInstrumentMap()" />
        </div>
      </div>

      <div v-if="instrumentMap?.summary?.length" class="mt-4 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p v-for="(text, index) in instrumentMap.summary" :key="`ms-${index}`" class="text-xs leading-5 text-amber-700">{{ text }}</p>
      </div>

      <div v-if="!instrumentMap?.instruments?.length" class="mt-4 rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400">
        本模块还没有已发布的量表。
      </div>
      <div v-else class="mt-4 grid gap-3 lg:grid-cols-2">
        <article
          v-for="node in instrumentMap.instruments"
          :key="node.code"
          class="rounded-xl border p-4"
          :class="node.problems.length ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <strong class="text-sm text-slate-800">{{ node.title }}</strong>
              <p class="mt-0.5 font-mono text-xs text-slate-400">{{ node.code }} · {{ node.questionCount }} 题</p>
            </div>
            <div class="flex flex-wrap gap-1">
              <UBadge v-if="node.role" size="xs" :color="node.role === 'screening' ? 'primary' : 'neutral'" variant="soft">{{ INSTRUMENT_ROLE_TEXT[node.role] || node.role }}</UBadge>
              <UBadge v-else size="xs" color="warning" variant="soft">未标角色</UBadge>
              <UBadge v-if="node.isRequired" size="xs" color="success" variant="soft">必做</UBadge>
            </div>
          </div>

          <dl class="mt-3 space-y-1 text-xs text-slate-500">
            <div v-if="node.prerequisiteCodes.length"><dt class="inline font-medium">前置：</dt><dd class="inline font-mono">{{ node.prerequisiteCodes.join('、') }}</dd></div>
            <div v-if="node.exclusiveCodes.length"><dt class="inline font-medium">互斥：</dt><dd class="inline font-mono">{{ node.exclusiveCodes.join('、') }}</dd></div>
            <div v-if="node.triggerCondition"><dt class="inline font-medium">触发条件：</dt><dd class="inline font-mono">{{ node.triggerCondition }}</dd></div>
            <div v-if="node.triggerConditionNote"><dt class="inline font-medium">说明：</dt><dd class="inline">{{ node.triggerConditionNote }}</dd></div>
            <div v-if="!node.prerequisiteCodes.length && !node.triggerCondition" class="text-slate-400">无门禁，随时可做</div>
          </dl>

          <ul v-if="node.problems.length" class="mt-3 space-y-1 border-t border-red-200 pt-2">
            <li v-for="(problem, index) in node.problems" :key="`p-${index}`" class="text-xs leading-5 text-red-700">{{ problem.message }}</li>
          </ul>
        </article>
      </div>
    </section>

    <!-- ===== 质量反哺 ===== -->
    <section class="rounded-xl border border-slate-100 bg-white p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">质量反哺</h2>
          <p class="mt-0.5 text-sm text-slate-400">汇总方案反馈，不展示学校业务正文。</p>
        </div>
        <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" @click="() => refreshResourceQuality()">刷新</UButton>
      </div>

      <!-- 摘要行 -->
      <div class="mt-4 flex flex-wrap divide-x divide-slate-100 rounded-lg bg-slate-50/70">
        <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">反馈 <strong class="block text-lg text-slate-700">{{ resourceQuality?.summary?.feedbackCount || 0 }}</strong></div>
        <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">模块 <strong class="block text-lg text-slate-700">{{ resourceQuality?.summary?.moduleCount || 0 }}</strong></div>
        <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">版本 <strong class="block text-lg text-slate-700">{{ resourceQuality?.summary?.trackedVersionCount || 0 }}</strong></div>
        <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">规则 <strong class="block text-lg text-slate-700">{{ resourceQuality?.summary?.trackedRuleCount || 0 }}</strong></div>
        <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">工具 <strong class="block text-lg text-slate-700">{{ resourceQuality?.summary?.trackedToolCount || 0 }}</strong></div>
      </div>

      <!-- 三栏反馈明细 -->
      <div class="mt-5 grid gap-5 lg:grid-cols-3">
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span class="inline-block size-2 rounded-full bg-red-400" />
            优先修订规则
          </h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.rules?.slice(0, 6) || []" :key="`${item.module}:${item.code}`" class="rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm">
              <strong class="text-slate-800">{{ item.code }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · 归因 {{ item.attributionAccuracy }}/5 · {{ item.count }} 次反馈</p>
            </div>
            <p v-if="!resourceQuality?.rules?.length" class="py-6 text-center text-sm text-slate-400">暂无规则反馈</p>
          </div>
        </div>
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span class="inline-block size-2 rounded-full bg-amber-400" />
            优先修订工具
          </h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.tools?.slice(0, 6) || []" :key="`${item.module}:${item.code}`" class="rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-sm">
              <strong class="text-slate-800">{{ item.code }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · 工具 {{ item.toolUsability }}/5 · 过难率 {{ Math.round((item.hardActionRate || 0) * 100) }}%</p>
            </div>
            <p v-if="!resourceQuality?.tools?.length" class="py-6 text-center text-sm text-slate-400">暂无工具反馈</p>
          </div>
        </div>
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span class="inline-block size-2 rounded-full bg-sky-400" />
            版本质量
          </h3>
          <div class="mt-3 space-y-2">
            <div v-for="item in resourceQuality?.versions?.slice(0, 6) || []" :key="item.code" class="rounded-lg border border-sky-100 bg-sky-50/60 p-3 text-sm">
              <strong class="text-slate-800">{{ item.version || item.code.slice(0, 8) }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ moduleLabel(item.module) }} · {{ libraryTypeLabel(item.libraryType) }} · {{ item.count }} 次反馈</p>
            </div>
            <p v-if="!resourceQuality?.versions?.length" class="py-6 text-center text-sm text-slate-400">暂无版本反馈</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== 导入资源按钮（统计栏右侧） ===== -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-slate-800">资源库与版本</h2>
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" @click="() => refreshResources()">刷新</UButton>
        <!-- 业务不是技术人员，逐列填 Excel 基本填不出来；向导只问中文，编码和表达式由系统生成 -->
        <UButton to="/platform-admin/resources/wizard" color="primary" size="xs" variant="soft" icon="i-lucide-wand-sparkles">业务填写向导</UButton>
        <UButton color="primary" size="xs" icon="i-lucide-upload-cloud" @click="() => { importOpen = true }">导入资源</UButton>
      </div>
    </div>

    <!-- ===== 导入 Slideover ===== -->
    <USlideover v-model:open="importOpen" title="导入资源" description="上传 Excel 或 JSON 模板，先预检，再确认写入。">
      <template #body>
        <!-- 整套导入：必须上传全部 5 个库文件、同一版本号（真实版本号 x.y.z），5 个文件之间互相校验 -->
        <div class="mb-4 rounded-lg border border-primary-100 bg-primary-50/60 p-3">
          <p class="text-sm font-medium text-primary-800">整套导入：一次上传全部 5 个库文件、同一版本号</p>
          <p class="mt-1 text-xs leading-5 text-primary-500">
            必须上传全部 5 个库文件（量表/归因/工具/输出模板/关键词路由），本次上传的 5 个库之间互相校验，不与其他已发布版本校验。全部通过后一起写入。
          </p>
        </div>
        <form class="space-y-5" @submit.prevent="previewBatchImport">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="模块"><USelect v-model="form.module" :items="moduleOptions" class="w-full" /></UFormField>
              <UFormField label="范围"><USelect v-model="form.scope" :items="scopeOptions" class="w-full" /></UFormField>
              <UFormField v-if="form.scope === 'school'" label="学校"><USelect v-model="form.schoolId" :items="dashboard?.schools?.map((school:any)=>({label:school.name,value:school.id})) || []" class="w-full" /></UFormField>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="版本号" help="真实发布版本号，x.y.z 格式（如 1.0.0）；不能与系统中已有版本重复">
                <UInput v-model="form.version" class="w-full" placeholder="1.0.0" :color="form.version && !versionValid ? 'error' : undefined" />
              </UFormField>
              <UFormField label="版本说明"><UInput v-model="form.notes" class="w-full" /></UFormField>
            </div>
            <div class="space-y-3">
              <p class="text-xs font-semibold text-slate-600">资源文件（5 个库必须全部上传）</p>
              <div v-for="option in libraryTypeOptions" :key="option.value" class="rounded-lg border border-slate-200 p-3">
                <div class="flex items-center gap-3">
                  <span class="w-20 shrink-0 text-sm font-medium text-slate-700">{{ option.label }}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.json,application/json"
                    class="block min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                    @change="onBatchFileChange($event, option.value)"
                  />
                  <UIcon v-if="batchFiles[option.value]?.file" name="i-lucide-file-check" class="size-4 shrink-0 text-emerald-500" />
                </div>
                <p v-if="batchFiles[option.value]?.file" class="mt-1.5 text-xs text-slate-500">
                  {{ batchFiles[option.value]!.file!.name }}
                  <a class="ml-2 text-primary-500 hover:underline" :href="`/templates/${option.value}.xlsx`" :download="`${option.label}_填写模板.xlsx`">下载模板</a>
                </p>
              </div>
            </div>
            <div class="flex flex-wrap gap-4">
              <UCheckbox v-model="form.confirmNoPersonalData" label="确认不含真实个人业务数据" />
              <UCheckbox v-model="form.publish" label="预检通过后直接发布" />
            </div>
            <div class="flex gap-3">
              <UButton type="submit" icon="i-lucide-shield-check" :disabled="!batchHasFile || !versionValid || !form.confirmNoPersonalData" :loading="pending">预检</UButton>
              <UButton color="primary" variant="soft" icon="i-lucide-upload-cloud" :disabled="!batchPreviewResult?.canImport" :loading="pending" @click="commitBatchImport">确认导入</UButton>
            </div>
          </form>

          <!-- 批量预检结果 -->
          <div v-if="batchPreviewResult" class="mt-6 space-y-4 border-t border-slate-100 pt-6">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-slate-700">整套预检结果</h3>
              <UBadge
                :color="batchPreviewResult.canImport ? (batchCrossRefWarnings.length || batchPreviewResult.entries.some((entry:any) => entry.validation.warnings?.length) ? 'warning' : 'success') : 'error'"
                variant="soft"
                size="xs"
              >{{ batchPreviewResult.canImport ? '通过' : '失败' }}</UBadge>
            </div>
            <!-- 版本号冲突：版本号是真实版本号，已被占用的不能再次使用 -->
            <div v-if="batchPreviewResult.versionConflicts?.length" class="rounded-lg border border-red-200 bg-red-50 p-3">
              <p class="text-xs font-semibold text-red-700">版本号 {{ form.version }} 已被使用，无法导入</p>
              <p v-for="(conflict, index) in batchPreviewResult.versionConflicts" :key="`vc-${index}`" class="mt-1.5 text-xs text-red-700">
                {{ conflict.libraryName }}（{{ conflict.status === 'published' ? '已发布' : conflict.status === 'retired' ? '已停用' : '草稿' }}）
              </p>
            </div>
            <div v-for="entry in batchPreviewResult.entries" :key="entry.libraryType" class="rounded-lg border border-slate-200 p-3">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-slate-700">{{ libraryTypeLabel(entry.libraryType) }}</span>
                <span class="min-w-0 flex-1 truncate text-xs text-slate-400">{{ entry.filename }}</span>
                <UBadge :color="entry.validation.ok ? (entry.validation.warnings?.length ? 'warning' : 'success') : 'error'" variant="soft" size="xs">
                  {{ entry.validation.ok ? (entry.validation.warnings?.length ? '有警告' : '通过') : '失败' }}
                </UBadge>
              </div>
              <div class="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span v-if="entry.projection.assessmentCount">量表 {{ entry.projection.assessmentCount }}</span>
                <span v-if="entry.projection.attributionRuleCount">规则 {{ entry.projection.attributionRuleCount }}</span>
                <span v-if="entry.projection.attributionItemCount">归因条目 {{ entry.projection.attributionItemCount }}</span>
                <span v-if="entry.projection.toolCount">工具 {{ entry.projection.toolCount }}</span>
                <span v-if="entry.projection.templateCount">输出模板 {{ entry.projection.templateCount }}</span>
                <span v-if="entry.projection.routeCount">关键词路由 {{ entry.projection.routeCount }}</span>
              </div>
              <div v-if="entry.validation.errors?.length" class="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
                <p v-for="issue in entry.validation.errors" :key="`be-${entry.libraryType}-${issue.path}-${issue.message}`" class="text-xs text-red-700">
                  {{ issue.path ? `${issue.path} · ` : '' }}{{ issue.message }}
                </p>
              </div>
              <div v-if="entry.validation.warnings?.length" class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                <p v-for="issue in entry.validation.warnings.slice(0, 6)" :key="`bw-${entry.libraryType}-${issue.path}-${issue.message}`" class="text-xs text-amber-700">
                  {{ issue.path ? `${issue.path} · ` : '' }}{{ issue.message }}
                </p>
              </div>
              <div v-if="entry.parseWarnings?.length" class="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-2">
                <p v-for="(text, index) in entry.parseWarnings" :key="`bpw-${entry.libraryType}-${index}`" class="text-xs leading-5 text-orange-700">{{ text }}</p>
              </div>
            </div>
            <div v-if="batchCrossRefErrors.length" class="rounded-lg border border-red-200 bg-red-50 p-3">
              <p class="text-xs font-semibold text-red-700">跨库引用错误（无法导入）</p>
              <p v-for="(issue, index) in batchCrossRefErrors.slice(0, 12)" :key="`bcre-${index}`" class="mt-1.5 text-xs text-red-700">
                <span class="font-medium">{{ issue.sourceLibraryType }} · {{ issue.sourceCode }}</span>
                <span v-if="issue.sourceField"> · {{ issue.sourceField }}</span> — {{ issue.message }}
              </p>
            </div>
            <div v-if="batchCrossRefWarnings.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p class="text-xs font-semibold text-amber-700">跨库引用警告</p>
              <p v-for="(issue, index) in batchCrossRefWarnings.slice(0, 8)" :key="`bcrw-${index}`" class="mt-1.5 text-xs text-amber-700">
                <span class="font-medium">{{ issue.sourceLibraryType }} · {{ issue.sourceCode }}</span> — {{ issue.message }}
              </p>
            </div>
            <div v-if="batchPreviewResult.crossRef && !batchCrossRefErrors.length" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              跨库引用校验通过（本次上传的库之间，未上传的库按现行已发布版本参与）
            </div>
          </div>
      </template>
    </USlideover>

    <!-- 发布被校验拦下时的逐条明细。之前只有一个泛泛的 toast，管理员看不出该改哪一行。 -->
    <div v-if="blockedIssues.length" class="mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-red-700">{{ blockedTitle }}</p>
          <p class="mt-1 text-xs text-red-600">发布是最后一道闸门。修正后重新发布即可。</p>
        </div>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="blockedIssues = []" />
      </div>
      <ul class="mt-3 space-y-1.5">
        <li v-for="(issue, index) in blockedIssues.slice(0, 15)" :key="`bi-${index}`" class="text-xs text-red-700">
          <span v-if="issue.source" class="font-medium">{{ issue.source }} — </span>{{ issue.message }}
        </li>
      </ul>
    </div>

    <!-- ===== 资源库与版本（合并表格） ===== -->
    <div class="rounded-xl border border-slate-100 bg-white">
      <div class="overflow-x-auto p-6 pt-4">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-100 text-xs font-medium text-slate-400">
            <tr>
              <th class="w-10 py-3" />
              <th class="py-3 pr-4">模块</th>
              <th class="pr-4">类型</th>
              <th class="pr-4">范围</th>
              <th class="pr-4 text-right">版本数</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="library in resourceData?.libraries || []" :key="library.id">
              <!-- 库行 -->
              <tr
                class="cursor-pointer border-b border-slate-50 transition hover:bg-slate-50/60"
                @click="Object.assign(form, { module: library.module, scope: library.scope, schoolId: library.schoolId || '' }); expandedLibrary = expandedLibrary === library.id ? null : library.id"
              >
                <td class="py-3 text-center text-slate-400">
                  <UIcon
                    :name="expandedLibrary === library.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-4 transition-transform"
                  />
                </td>
                <td class="py-3 pr-4"><strong class="text-slate-800">{{ moduleLabel(library.module) }}</strong></td>
                <td class="pr-4 text-slate-600">{{ libraryTypeLabel(library.libraryType) }}</td>
                <td class="pr-4 text-slate-600">{{ resourceScopeLabel(library.scope) }}</td>
                <td class="pr-4 text-right">
                  <UBadge color="neutral" variant="soft" size="sm">{{ allVersions.filter((v:any)=>v.libraryId===library.id).length }} 版</UBadge>
                </td>
              </tr>
              <!-- 版本子行 -->
              <template v-if="expandedLibrary === library.id">
                <tr v-for="version in allVersions.filter((v:any)=>v.libraryId===library.id)" :key="version.id" class="border-b border-slate-50 bg-slate-50/40">
                  <td class="py-2.5" />
                  <td class="py-2.5 pr-4 text-xs text-slate-500" colspan="4">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex items-center gap-4">
                        <div>
                          <span class="font-medium text-slate-700">{{ version.version }}</span>
                          <span class="ml-2 inline-flex">
                            <UBadge :color="resourceStatusColor(version.status)" variant="soft" size="sm">{{ resourceStatusLabel(version.status) }}</UBadge>
                          </span>
                        </div>
                        <span v-if="version.notes" class="max-w-xs truncate text-slate-400">{{ version.notes }}</span>
                        <span class="text-slate-400">{{ new Date(version.updatedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) }}</span>
                      </div>
                      <div class="flex shrink-0 gap-1">
                        <!-- 待验证版本只有向导输入，没有库文件，编辑器/预览/投影/发布都用不了 -->
                        <UButton v-if="version.status !== 'pending_review'" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" @click.stop="() => { navigateTo(`/platform-admin/resources/edit/${version.id}`) }">编辑</UButton>
                        <UButton v-if="version.status === 'draft' || version.status === 'retired'" size="xs" variant="soft" @click.stop="versionAction(version.id, 'publish')">发布</UButton>
                        <UButton v-if="version.status === 'published'" size="xs" color="neutral" variant="soft" @click.stop="versionAction(version.id, 'retire')">停用</UButton>
                        <UButton v-if="version.status === 'retired'" size="xs" color="neutral" variant="soft" @click.stop="versionAction(version.id, 'rollback')">回滚</UButton>
                        <!-- inspectPreview / inspectProjection 与它们的 modal 之前没有任何调用点，
                             两个接口因此一直是孤儿。这里把入口补上。 -->
                        <UButton v-if="version.status !== 'pending_review'" size="xs" color="neutral" variant="ghost" icon="i-lucide-eye" :loading="pending" @click.stop="inspectPreview(version.id)">预览</UButton>
                        <UButton v-if="version.status !== 'pending_review'" size="xs" color="neutral" variant="ghost" icon="i-lucide-layers" :loading="pending" @click.stop="inspectProjection(version.id)">投影</UButton>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-if="allVersions.filter((v:any)=>v.libraryId===library.id).length === 0">
                  <td class="py-6 text-center text-xs text-slate-400" colspan="5">暂无版本</td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
        <p v-if="!resourceData?.libraries?.length" class="py-12 text-center text-sm text-slate-400">暂无资源库。新版业务库导入后会显示在这里。</p>
      </div>
    </div>

    <UModal v-model:open="versionPreviewOpen" title="版本预览">
      <template #body>
        <pre class="max-h-[65vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{{ JSON.stringify(versionPreviewResult, null, 2) }}</code></pre>
      </template>
    </UModal>
    <UModal v-model:open="projectionOpen" title="结构化投影">
      <template #body>
        <div class="mb-4 flex divide-x divide-slate-100 rounded-lg bg-slate-50/70">
          <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">量表 <strong class="block text-lg text-slate-700">{{ projectionResult?.summary?.assessmentCount || 0 }}</strong></div>
          <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">规则 <strong class="block text-lg text-slate-700">{{ projectionResult?.summary?.attributionRuleCount || 0 }}</strong></div>
          <div class="flex-1 px-4 py-3 text-center text-sm text-slate-500">工具 <strong class="block text-lg text-slate-700">{{ projectionResult?.summary?.toolCount || 0 }}</strong></div>
        </div>
        <div v-if="projectionResult?.summary?.templateCount || projectionResult?.summary?.routeCount" class="mb-4 flex divide-x divide-slate-100 rounded-lg bg-slate-50/70">
          <div v-if="projectionResult?.summary?.templateCount" class="flex-1 px-4 py-3 text-center text-sm text-slate-500">输出模板 <strong class="block text-lg text-indigo-600">{{ projectionResult.summary.templateCount }}</strong></div>
          <div v-if="projectionResult?.summary?.routeCount" class="flex-1 px-4 py-3 text-center text-sm text-slate-500">关键词路由 <strong class="block text-lg text-sky-600">{{ projectionResult.summary.routeCount }}</strong></div>
        </div>
        <pre class="max-h-[60vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{{ JSON.stringify(projectionResult, null, 2) }}</code></pre>
      </template>
    </UModal>
  </ManagementPage>
</template>
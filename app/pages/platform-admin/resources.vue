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
const editOpen = ref(false)
const editPending = ref(false)
const editForm = reactive({
  libraryId: '',
  module: 'home_school',
  libraryType: 'assessment',
  sourceVersion: '',
  version: '',
  notes: '',
  publish: false
})
const editStructured = ref<any>({})

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
const editPayloadError = computed(() => validateVisualPayload())

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

function suggestNextVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return `${version}-rev`
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function splitList(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

function listText(value: unknown) {
  return Array.isArray(value) ? value.join('\n') : String(value || '')
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {}))
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

function openEditVersion(version: any) {
  const library = (resourceData.value?.libraries || []).find((item: any) => item.id === version.libraryId)
  Object.assign(editForm, {
    libraryId: version.libraryId,
    module: library?.module || form.module,
    libraryType: library?.libraryType || form.libraryType,
    sourceVersion: version.version,
    version: suggestNextVersion(version.version),
    notes: version.notes ? `基于 ${version.version} 修订：${version.notes}` : `基于 ${version.version} 修订`,
    publish: false
  })
  editStructured.value = normalizeVisualPayload(editForm.libraryType, editForm.module, version.payload || {})
  editOpen.value = true
}

function closeEditVersion() {
  editOpen.value = false
}

async function saveEditedVersion() {
  if (editPayloadError.value) {
    toast.add({ title: '资源内容不完整', description: editPayloadError.value, color: 'error' })
    return
  }
  editPending.value = true
  try {
    const payload = buildVisualPayload()
    const created: any = await $fetch('/api/v1/platform-admin/module-resources/versions', {
      method: 'POST',
      body: {
        libraryId: editForm.libraryId,
        version: editForm.version,
        notes: editForm.notes || undefined,
        payload
      }
    })
    if (editForm.publish) {
      await $fetch(`/api/v1/platform-admin/module-resources/versions/${created.id}`, {
        method: 'PATCH',
        body: { action: 'publish' }
      })
    }
    await refreshResources()
    await refreshResourceQuality()
    editOpen.value = false
    toast.add({ title: editForm.publish ? '修订版本已保存并发布' : '修订版本已保存为草稿', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请检查版本号和资源内容', color: 'error' })
  } finally {
    editPending.value = false
  }
}

function normalizeVisualPayload(libraryType: string, module: string, payload: Record<string, any>) {
  const source = deepClone(payload)
  if (libraryType === 'assessment') {
    const instruments = Array.isArray(source.instruments) ? source.instruments : [source]
    return {
      instruments: instruments.map((instrument: any) => ({
        code: instrument.code || instrument.instrumentCode || '',
        instrumentCode: instrument.instrumentCode || instrument.code || '',
        title: instrument.title || '',
        description: instrument.description || '',
        estimatedMinutes: instrument.estimatedMinutes || 3,
        version: instrument.version || editForm.version,
        module,
        questions: (instrument.questions || []).map((question: any) => ({
          id: question.id || '',
          text: question.text || '',
          dimension: question.dimension || '',
          reverse: Boolean(question.reverse),
          options: (question.options || []).map((option: any) => ({
            label: option.label || '',
            value: Number(option.value ?? 0)
          }))
        })),
        scoringRows: Object.entries(instrument.scoring || {}).map(([key, expression]) => ({
          key,
          expression: String(expression)
        }))
      }))
    }
  }

  if (libraryType === 'attribution') {
    return {
      module: source.module || module,
      version: source.version || editForm.version,
      computedRows: Object.entries(source.computed || {}).map(([key, expression]) => ({ key, expression })),
      branches: (source.branches || []).map((branch: any) => ({
        pri: Number(branch.pri ?? 100),
        when: branch.when || '',
        level: branch.level || 'stable',
        blocked: Boolean(branch.blocked),
        ruleId: branch.ruleId || '',
        primaryAttribution: branch.primaryAttribution || '',
        secondaryAttributionsText: listText(branch.secondaryAttributions),
        reasonsText: listText(branch.reasons),
        toolTagsText: listText(branch.toolTags)
      })),
      actions: (source.actions || []).map((action: any) => ({
        title: action.title || '',
        detail: action.detail || ''
      })),
      embeddedTools: (source.tools || []).map((tool: any) => ({
        title: tool.title || '',
        content: tool.content || ''
      })),
      crisisWhen: source.crisis?.when || '',
      crisisBlocked: Boolean(source.crisis?.blocked)
    }
  }

  return {
    tools: (source.tools || []).map((tool: any) => ({
      code: tool.code || '',
      name: tool.name || '',
      form: tool.form || '',
      symptoms: tool.symptoms || '',
      expectedEffect: tool.expectedEffect || '',
      severity: tool.severity || '',
      level: tool.level || '',
      attribution: tool.attribution || tool.primaryAttribution || '',
      attributionsText: listText(tool.attributions),
      tagsText: listText(tool.tags),
      toolTagsText: listText(tool.toolTags),
      duration: tool.duration || '',
      timePerSession: tool.timePerSession || '',
      stepsText: listText(tool.steps),
      scripts: tool.scripts || '',
      prohibitions: tool.prohibitions || '',
      targetUsers: tool.targetUsers || '',
      dimensionsText: listText(tool.dimensions)
    }))
  }
}

function buildVisualPayload() {
  if (editForm.libraryType === 'assessment') {
    return {
      instruments: (editStructured.value.instruments || []).map((instrument: any) => ({
        code: instrument.code,
        instrumentCode: instrument.instrumentCode || instrument.code,
        version: instrument.version || editForm.version,
        module: editForm.module,
        title: instrument.title,
        description: instrument.description,
        estimatedMinutes: Number(instrument.estimatedMinutes || 0),
        questions: (instrument.questions || []).map((question: any) => ({
          id: question.id,
          text: question.text,
          dimension: question.dimension,
          reverse: Boolean(question.reverse),
          options: (question.options || []).map((option: any) => ({
            label: option.label,
            value: Number(option.value)
          }))
        })),
        scoring: Object.fromEntries((instrument.scoringRows || [])
          .filter((row: any) => row.key && row.expression)
          .map((row: any) => [row.key, row.expression]))
      }))
    }
  }

  if (editForm.libraryType === 'attribution') {
    return {
      module: editForm.module,
      version: editForm.version,
      computed: Object.fromEntries((editStructured.value.computedRows || [])
        .filter((row: any) => row.key && row.expression)
        .map((row: any) => [row.key, row.expression])),
      branches: (editStructured.value.branches || []).map((branch: any) => ({
        pri: Number(branch.pri || 100),
        when: branch.when || undefined,
        level: branch.level,
        blocked: Boolean(branch.blocked),
        ruleId: branch.ruleId,
        primaryAttribution: branch.primaryAttribution,
        secondaryAttributions: splitList(branch.secondaryAttributionsText),
        reasons: splitList(branch.reasonsText),
        toolTags: splitList(branch.toolTagsText)
      })),
      actions: (editStructured.value.actions || []).filter((action: any) => action.title && action.detail)
        .map((action: any) => ({ title: action.title, detail: action.detail, status: 'pending' })),
      tools: (editStructured.value.embeddedTools || []).filter((tool: any) => tool.title && tool.content)
        .map((tool: any) => ({ title: tool.title, content: tool.content })),
      crisis: editStructured.value.crisisWhen
        ? { when: editStructured.value.crisisWhen, blocked: Boolean(editStructured.value.crisisBlocked) }
        : undefined
    }
  }

  return {
    tools: (editStructured.value.tools || []).map((tool: any) => ({
      code: tool.code,
      name: tool.name,
      form: tool.form,
      symptoms: tool.symptoms,
      expectedEffect: tool.expectedEffect,
      severity: tool.severity,
      level: tool.level,
      attribution: tool.attribution,
      attributions: splitList(tool.attributionsText),
      tags: splitList(tool.tagsText),
      toolTags: splitList(tool.toolTagsText),
      duration: tool.duration,
      timePerSession: tool.timePerSession,
      steps: splitList(tool.stepsText),
      scripts: tool.scripts,
      prohibitions: tool.prohibitions,
      targetUsers: tool.targetUsers,
      dimensions: splitList(tool.dimensionsText)
    }))
  }
}

function validateVisualPayload() {
  if (!editForm.version.trim()) return '新版本号不能为空'
  if (editForm.libraryType === 'assessment') {
    const instruments = editStructured.value.instruments || []
    if (!instruments.length) return '量表库至少需要一个量表'
    for (const instrument of instruments) {
      if (!instrument.code || !instrument.title) return '每个量表都需要编码和名称'
      if (!instrument.questions?.length) return `量表 ${instrument.code} 至少需要一个题项`
      for (const question of instrument.questions) {
        if (!question.id || !question.text) return `量表 ${instrument.code} 的题项需要题号和题干`
        if (!question.options?.length || question.options.length < 2) return `题项 ${question.id} 至少需要两个选项`
      }
    }
  }
  if (editForm.libraryType === 'attribution') {
    const branches = editStructured.value.branches || []
    if (!branches.length) return '归因库至少需要一条规则'
    if (!branches.some((branch: any) => !branch.when)) return '归因库必须保留一条兜底规则，条件留空即可'
    for (const branch of branches) {
      if (!branch.ruleId || !branch.level || !branch.primaryAttribution) return '每条归因规则都需要编码、等级和主归因'
      if (!splitList(branch.reasonsText).length) return `规则 ${branch.ruleId} 至少需要一条原因说明`
    }
  }
  if (editForm.libraryType === 'tool') {
    const tools = editStructured.value.tools || []
    if (!tools.length) return '工具库至少需要一个工具'
    for (const tool of tools) {
      if (!tool.code || !tool.name || !tool.form || !tool.symptoms) return '每个工具都需要编码、名称、形式和适用情形'
      if (!splitList(tool.stepsText).length) return `工具 ${tool.code} 至少需要一个步骤`
    }
  }
  return ''
}

function addInstrument() {
  editStructured.value.instruments.push({
    code: '',
    instrumentCode: '',
    title: '',
    description: '',
    estimatedMinutes: 3,
    version: editForm.version,
    module: editForm.module,
    questions: [],
    scoringRows: []
  })
}

function addQuestion(instrument: any) {
  instrument.questions.push({
    id: '',
    text: '',
    dimension: '',
    reverse: false,
    options: [
      { label: '完全不符合', value: 1 },
      { label: '比较不符合', value: 2 },
      { label: '一般', value: 3 },
      { label: '比较符合', value: 4 },
      { label: '非常符合', value: 5 }
    ]
  })
}

function addScoringRow(instrument: any) {
  instrument.scoringRows.push({ key: '', expression: '' })
}

function addBranch() {
  editStructured.value.branches.push({
    pri: 100,
    when: '',
    level: 'stable',
    blocked: false,
    ruleId: '',
    primaryAttribution: '',
    secondaryAttributionsText: '',
    reasonsText: '',
    toolTagsText: ''
  })
}

function addComputedRow() {
  editStructured.value.computedRows.push({ key: '', expression: '' })
}

function addAttributionAction() {
  editStructured.value.actions.push({ title: '', detail: '' })
}

function addEmbeddedTool() {
  editStructured.value.embeddedTools.push({ title: '', content: '' })
}

function addToolItem() {
  editStructured.value.tools.push({
    code: '',
    name: '',
    form: '',
    symptoms: '',
    expectedEffect: '',
    severity: '',
    level: '',
    attribution: '',
    attributionsText: '',
    tagsText: '',
    toolTagsText: '',
    duration: '',
    timePerSession: '',
    stepsText: '',
    scripts: '',
    prohibitions: '',
    targetUsers: '',
    dimensionsText: ''
  })
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
              <div><strong>{{ library.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ moduleLabel(library.module) }} · {{ libraryTypeLabel(library.libraryType) }} · {{ resourceScopeLabel(library.scope) }}</p></div>
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
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-eye" @click="inspectPreview(version.id)" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-database" @click="inspectProjection(version.id)" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" @click="openEditVersion(version)">编辑</UButton>
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
    <UModal v-model:open="editOpen" title="编辑资源版本">
      <template #body>
        <div class="max-h-[72vh] space-y-5 overflow-auto pr-1">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="来源版本"><UInput v-model="editForm.sourceVersion" disabled class="w-full" /></UFormField>
            <UFormField label="新版本号"><UInput v-model="editForm.version" class="w-full" /></UFormField>
          </div>
          <UFormField label="版本说明"><UInput v-model="editForm.notes" class="w-full" /></UFormField>

          <div v-if="editForm.libraryType === 'assessment'" class="space-y-5">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-base font-semibold">量表库表格</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addInstrument">新增量表行</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1040px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr><th class="p-2">量表编码</th><th class="p-2">量表名称</th><th class="p-2">版本</th><th class="p-2">分钟</th><th class="p-2">说明</th><th class="p-2">操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(instrument, instrumentIndex) in editStructured.instruments || []" :key="instrumentIndex" class="border-t border-slate-100">
                    <td class="p-2"><UInput v-model="instrument.code" size="xs" /></td>
                    <td class="p-2"><UInput v-model="instrument.title" size="xs" /></td>
                    <td class="p-2"><UInput v-model="instrument.version" size="xs" /></td>
                    <td class="p-2"><UInput v-model.number="instrument.estimatedMinutes" type="number" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="instrument.description" :rows="1" size="xs" /></td>
                    <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.instruments.splice(instrumentIndex, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-for="(instrument, instrumentIndex) in editStructured.instruments || []" :key="`detail-${instrumentIndex}`" class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <h4 class="text-sm font-semibold">{{ instrument.code || `量表 ${Number(instrumentIndex) + 1}` }} 题项表</h4>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addQuestion(instrument)">新增题项行</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[1320px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500">
                    <tr><th class="p-2">题号</th><th class="p-2">题干</th><th class="p-2">维度</th><th class="p-2">反向</th><th class="p-2">选项/分值</th><th class="p-2">操作</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(question, questionIndex) in instrument.questions" :key="questionIndex" class="border-t border-slate-100 align-top">
                      <td class="p-2"><UInput v-model="question.id" size="xs" /></td>
                      <td class="p-2"><UTextarea v-model="question.text" :rows="2" size="xs" /></td>
                      <td class="p-2"><UInput v-model="question.dimension" size="xs" /></td>
                      <td class="p-2"><UCheckbox v-model="question.reverse" /></td>
                      <td class="p-2">
                        <div class="space-y-1">
                          <div v-for="(option, optionIndex) in question.options" :key="optionIndex" class="grid grid-cols-[1fr_80px_32px] gap-1">
                            <UInput v-model="option.label" size="xs" placeholder="选项" />
                            <UInput v-model.number="option.value" type="number" size="xs" placeholder="分" />
                            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="question.options.splice(optionIndex, 1)" />
                          </div>
                          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" @click="question.options.push({ label: '', value: 0 })">加选项</UButton>
                        </div>
                      </td>
                      <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="instrument.questions.splice(questionIndex, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex items-center justify-between gap-3">
                <h4 class="text-sm font-semibold">{{ instrument.code || `量表 ${Number(instrumentIndex) + 1}` }} 计分表</h4>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addScoringRow(instrument)">新增计分行</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[720px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500">
                    <tr><th class="p-2">字段</th><th class="p-2">汇总方式/表达式</th><th class="p-2">操作</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, rowIndex) in instrument.scoringRows" :key="rowIndex" class="border-t border-slate-100">
                      <td class="p-2"><UInput v-model="row.key" size="xs" /></td>
                      <td class="p-2"><UInput v-model="row.expression" size="xs" /></td>
                      <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="instrument.scoringRows.splice(rowIndex, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div v-else-if="editForm.libraryType === 'attribution'" class="space-y-5">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-base font-semibold">计算变量表</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addComputedRow">新增变量行</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[720px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">变量名</th><th class="p-2">表达式</th><th class="p-2">操作</th></tr></thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in editStructured.computedRows || []" :key="rowIndex" class="border-t border-slate-100">
                    <td class="p-2"><UInput v-model="row.key" size="xs" /></td>
                    <td class="p-2"><UInput v-model="row.expression" size="xs" /></td>
                    <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.computedRows.splice(rowIndex, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between gap-3">
              <h3 class="text-base font-semibold">归因规则表</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addBranch">新增规则行</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1560px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr><th class="p-2">规则编码</th><th class="p-2">优先级</th><th class="p-2">触发条件</th><th class="p-2">等级</th><th class="p-2">主归因</th><th class="p-2">次归因</th><th class="p-2">原因说明</th><th class="p-2">工具标签</th><th class="p-2">阻断</th><th class="p-2">操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(branch, branchIndex) in editStructured.branches || []" :key="branchIndex" class="border-t border-slate-100 align-top">
                    <td class="p-2"><UInput v-model="branch.ruleId" size="xs" /></td>
                    <td class="p-2"><UInput v-model.number="branch.pri" type="number" size="xs" /></td>
                    <td class="p-2"><UInput v-model="branch.when" size="xs" placeholder="留空兜底" /></td>
                    <td class="p-2"><UInput v-model="branch.level" size="xs" /></td>
                    <td class="p-2"><UInput v-model="branch.primaryAttribution" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="branch.secondaryAttributionsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="branch.reasonsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="branch.toolTagsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UCheckbox v-model="branch.blocked" /></td>
                    <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.branches.splice(branchIndex, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[760px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">危机触发条件</th><th class="p-2">阻断</th></tr></thead>
                <tbody><tr class="border-t border-slate-100"><td class="p-2"><UInput v-model="editStructured.crisisWhen" size="xs" /></td><td class="p-2"><UCheckbox v-model="editStructured.crisisBlocked" /></td></tr></tbody>
              </table>
            </div>

            <div class="grid gap-5 xl:grid-cols-2">
              <div class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-base font-semibold">默认行动项表</h3>
                  <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addAttributionAction">新增行动行</UButton>
                </div>
                <div class="overflow-x-auto rounded-lg border border-slate-200">
                  <table class="min-w-[760px] w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">标题</th><th class="p-2">说明</th><th class="p-2">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(action, actionIndex) in editStructured.actions || []" :key="actionIndex" class="border-t border-slate-100">
                        <td class="p-2"><UInput v-model="action.title" size="xs" /></td>
                        <td class="p-2"><UTextarea v-model="action.detail" :rows="2" size="xs" /></td>
                        <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.actions.splice(actionIndex, 1)" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-base font-semibold">内置工具提示表</h3>
                  <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addEmbeddedTool">新增提示行</UButton>
                </div>
                <div class="overflow-x-auto rounded-lg border border-slate-200">
                  <table class="min-w-[760px] w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">标题</th><th class="p-2">内容</th><th class="p-2">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(tool, toolIndex) in editStructured.embeddedTools || []" :key="toolIndex" class="border-t border-slate-100">
                        <td class="p-2"><UInput v-model="tool.title" size="xs" /></td>
                        <td class="p-2"><UTextarea v-model="tool.content" :rows="2" size="xs" /></td>
                        <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.embeddedTools.splice(toolIndex, 1)" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-base font-semibold">工具库表格</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addToolItem">新增工具行</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[2600px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr><th class="p-2">编码</th><th class="p-2">名称</th><th class="p-2">形式</th><th class="p-2">等级</th><th class="p-2">严重度</th><th class="p-2">主归因</th><th class="p-2">适用归因</th><th class="p-2">场景标签</th><th class="p-2">工具标签</th><th class="p-2">维度</th><th class="p-2">适用情形</th><th class="p-2">预期效果</th><th class="p-2">步骤</th><th class="p-2">话术</th><th class="p-2">禁忌</th><th class="p-2">周期</th><th class="p-2">单次时长</th><th class="p-2">对象</th><th class="p-2">操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(tool, toolIndex) in editStructured.tools || []" :key="toolIndex" class="border-t border-slate-100 align-top">
                    <td class="p-2"><UInput v-model="tool.code" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.name" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.form" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.level" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.severity" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.attribution" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.attributionsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.tagsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.toolTagsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.dimensionsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.symptoms" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.expectedEffect" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.stepsText" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.scripts" :rows="2" size="xs" /></td>
                    <td class="p-2"><UTextarea v-model="tool.prohibitions" :rows="2" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.duration" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.timePerSession" size="xs" /></td>
                    <td class="p-2"><UInput v-model="tool.targetUsers" size="xs" /></td>
                    <td class="p-2"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.tools.splice(toolIndex, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <UCheckbox v-model="editForm.publish" label="保存后直接发布" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton color="neutral" variant="soft" @click="closeEditVersion">取消</UButton>
          <UButton icon="i-lucide-save" :disabled="Boolean(editPayloadError)" :loading="editPending" @click="saveEditedVersion">保存新版本</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

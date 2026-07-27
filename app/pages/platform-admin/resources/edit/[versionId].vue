<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute()
const versionId = String(route.params.versionId)
const toast = useToast()
const { moduleLabel, libraryTypeLabel, actionStatusLabel } = useDisplayLabels()

const { data: resourceData, refresh: refreshResources } = await useFetch<any>('/api/v1/platform-admin/module-resources')
const { refresh: refreshResourceQuality } = await useFetch<any>('/api/v1/platform-admin/resource-quality')

const levelOptions = ['green', 'blue', 'yellow', 'orange', 'red', 'purple', 'survival', 'norming', 'operating', 'mature', 'L1', 'L2', 'L3', 'E']
const actionStatusOptions = ['pending', 'in_progress', 'done'].map(value => ({ label: actionStatusLabel(value), value }))

// ---- 查找版本和库 ----
const version = computed(() => (resourceData.value?.versions || []).find((v: any) => v.id === versionId))
const library = computed(() => {
  if (!version.value) return null
  return (resourceData.value?.libraries || []).find((l: any) => l.id === version.value.libraryId)
})

// ---- 编辑表单 ----
const pending = ref(false)
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

// 初始化
const initialized = ref(false)
watch([version, library], ([v, l]) => {
  if (!v || !l || initialized.value) return
  Object.assign(editForm, {
    libraryId: v.libraryId,
    module: l.module,
    libraryType: l.libraryType,
    sourceVersion: v.version,
    version: suggestNextVersion(v.version),
    notes: v.notes ? `基于 ${v.version} 修订：${v.notes}` : `基于 ${v.version} 修订`,
    publish: false
  })
  editStructured.value = normalizeVisualPayload(l.libraryType, l.module, v.payload || {})
  initialized.value = true
}, { immediate: true })

const editPayloadError = computed(() => validateVisualPayload())

// ---- 工具函数 ----
function suggestNextVersion(ver: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(ver)
  if (!match) return `${ver}-rev`
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

// ---- normalize / build / validate ----
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

// ---- 增删操作 ----
function addInstrument() {
  editStructured.value.instruments.push({
    code: '', instrumentCode: '', title: '', description: '',
    estimatedMinutes: 3, version: editForm.version, module: editForm.module,
    questions: [], scoringRows: []
  })
}

function addQuestion(instrument: any) {
  instrument.questions.push({
    id: '', text: '', dimension: '', reverse: false,
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
    pri: 100, when: '', level: 'stable', blocked: false,
    ruleId: '', primaryAttribution: '',
    secondaryAttributionsText: '', reasonsText: '', toolTagsText: ''
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
    code: '', name: '', form: '', symptoms: '', expectedEffect: '',
    severity: '', level: '', attribution: '',
    attributionsText: '', tagsText: '', toolTagsText: '',
    duration: '', timePerSession: '', stepsText: '',
    scripts: '', prohibitions: '', targetUsers: '', dimensionsText: ''
  })
}

// ---- 保存 ----
async function saveEditedVersion() {
  if (editPayloadError.value) {
    toast.add({ title: '资源内容不完整', description: editPayloadError.value, color: 'error' })
    return
  }
  pending.value = true
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
    toast.add({ title: editForm.publish ? '修订版本已保存并发布' : '修订版本已保存为草稿', color: 'success' })
    await navigateTo('/platform-admin/resources')
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请检查版本号和资源内容', color: 'error' })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-full px-5 py-8">
    <!-- 页头 -->
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-indigo-700">三库运营台 · 编辑资源版本</p>
        <h1 class="mt-2 text-3xl font-semibold">
          {{ library ? `${library.name}` : '加载中...' }}
          <span class="text-base font-normal text-slate-400">· {{ libraryTypeLabel(editForm.libraryType) }}</span>
        </h1>
        <p class="mt-2 text-sm text-slate-500">
          基于版本 <strong>{{ editForm.sourceVersion }}</strong> 修订 · 模块 {{ moduleLabel(editForm.module) }}
        </p>
      </div>
      <UButton to="/platform-admin/resources" color="neutral" variant="soft" icon="i-lucide-arrow-left">
        返回资源列表
      </UButton>
    </div>

    <!-- 未找到版本 -->
    <div v-if="initialized && !version" class="panel mt-6 p-12 text-center">
      <UIcon name="i-lucide-file-question" class="mx-auto text-4xl text-slate-300" />
      <p class="mt-4 text-lg font-semibold text-slate-500">未找到该版本</p>
      <p class="mt-1 text-sm text-slate-400">版本可能已被删除，或链接无效。</p>
      <UButton to="/platform-admin/resources" class="mt-6" color="neutral" variant="soft">返回资源列表</UButton>
    </div>

    <!-- 编辑区 -->
    <template v-if="initialized && version">
      <!-- 版本信息 -->
      <div class="panel mt-6 p-6">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="来源版本">
            <UInput v-model="editForm.sourceVersion" disabled class="w-full" />
          </UFormField>
          <UFormField label="新版本号">
            <UInput v-model="editForm.version" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="版本说明" class="mt-4">
          <UInput v-model="editForm.notes" class="w-full" />
        </UFormField>
      </div>

      <!-- === 量表库 === -->
      <div v-if="editForm.libraryType === 'assessment'" class="mt-6 space-y-6">
        <div class="panel p-6">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 class="text-xl font-semibold">量表库表格</h2>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addInstrument">新增量表行</UButton>
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
        </div>

        <div v-for="(instrument, instrumentIndex) in editStructured.instruments || []" :key="`detail-${instrumentIndex}`" class="panel space-y-5 p-6">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-lg font-semibold">{{ instrument.code || `量表 ${Number(instrumentIndex) + 1}` }} 题项表</h3>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addQuestion(instrument)">新增题项行</UButton>
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

      <!-- === 归因库 === -->
      <div v-if="editForm.libraryType === 'attribution'" class="mt-6 space-y-6">
        <div class="panel p-6">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 class="text-xl font-semibold">计算变量表</h2>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addComputedRow">新增变量行</UButton>
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
        </div>

        <div class="panel p-6">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 class="text-xl font-semibold">归因规则表</h2>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addBranch">新增规则行</UButton>
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
        </div>

        <div class="panel p-6">
          <h2 class="text-xl font-semibold mb-4">危机条件</h2>
          <div class="overflow-x-auto rounded-lg border border-slate-200">
            <table class="min-w-[760px] w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">危机触发条件</th><th class="p-2">阻断</th></tr></thead>
              <tbody><tr class="border-t border-slate-100"><td class="p-2"><UInput v-model="editStructured.crisisWhen" size="xs" /></td><td class="p-2"><UCheckbox v-model="editStructured.crisisBlocked" /></td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-2">
          <div class="panel p-6">
            <div class="flex items-center justify-between gap-3 mb-4">
              <h2 class="text-xl font-semibold">默认行动项表</h2>
              <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addAttributionAction">新增行动行</UButton>
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

          <div class="panel p-6">
            <div class="flex items-center justify-between gap-3 mb-4">
              <h2 class="text-xl font-semibold">内置工具提示表</h2>
              <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addEmbeddedTool">新增提示行</UButton>
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

      <!-- === 工具库 === -->
      <div v-if="editForm.libraryType === 'tool'" class="panel mt-6 p-6">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h2 class="text-xl font-semibold">工具库表格</h2>
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addToolItem">新增工具行</UButton>
        </div>
        <div class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="min-w-[2600px] w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="p-2">编码</th><th class="p-2">名称</th><th class="p-2">形式</th>
                <th class="p-2">等级</th><th class="p-2">严重度</th><th class="p-2">主归因</th>
                <th class="p-2">适用归因</th><th class="p-2">场景标签</th><th class="p-2">工具标签</th>
                <th class="p-2">维度</th><th class="p-2">适用情形</th><th class="p-2">预期效果</th>
                <th class="p-2">步骤</th><th class="p-2">话术</th><th class="p-2">禁忌</th>
                <th class="p-2">周期</th><th class="p-2">单次时长</th><th class="p-2">对象</th>
                <th class="p-2">操作</th>
              </tr>
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

      <!-- 底部操作栏 -->
      <div class="panel sticky bottom-4 mt-6 flex items-center justify-between gap-4 p-6">
        <UCheckbox v-model="editForm.publish" label="保存后直接发布" />
        <div class="flex gap-3">
          <UButton to="/platform-admin/resources" color="neutral" variant="soft">取消</UButton>
          <UButton icon="i-lucide-save" :disabled="Boolean(editPayloadError)" :loading="pending" @click="saveEditedVersion">
            保存新版本
          </UButton>
        </div>
      </div>

      <p v-if="editPayloadError" class="mt-2 text-right text-xs text-red-500">{{ editPayloadError }}</p>
    </template>
  </div>
</template>
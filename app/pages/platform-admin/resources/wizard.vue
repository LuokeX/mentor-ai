<script setup lang="ts">
/**
 * 业务填写向导。
 *
 * 存在的理由：v4 模板三张主表合计 86 个必填列，其中 ③ 的 38 列运行时只读 12 列。
 * 让非技术人员逐列填 Excel 既慢又必然出错——编码要跨表对齐、条件要写表达式、权重要给数字。
 *
 * 这里只问业务真正需要决定的事，全中文、无编码、无表达式。
 * 编码/默认值/维度题号归属/选项组/优先级/严重度/条件表达式全部由服务端编译器生成。
 * 最后一步给出「回读稿」——把系统将会怎么判断用人话复述一遍，业务读它就能确认理解没跑偏。
 */
import {
  DEFAULT_WIZARD_DEFAULTS,
  WIZARD_OPTION_GROUPS, WIZARD_ROLES,
  type WizardCondition, type WizardInput
} from '#shared/business-wizard'

definePageMeta({ layout: 'default' })

const toast = useToast()
const moduleOptions = [
  { label: '自我成长赋能', value: 'self_growth' },
  { label: '班级系统建设', value: 'class_system' },
  { label: '家校沟通合作', value: 'home_school' },
  { label: '学生个体问题', value: 'student_case' },
  { label: '学生学习问题', value: 'learning_problem' }
]
/** 题目「选项」下拉：预置三组 + 业务自定义组（value 统一用组 id，预置组 id 即编码） */
const optionGroupOptions = computed(() => [
  ...Object.entries(WIZARD_OPTION_GROUPS).map(([value, def]) => ({ label: def.label, value })),
  ...(form.optionGroups as any[]).map((g: any) => ({ label: `自定义：${g.name || '未命名'}`, value: g.id }))
])
/** 选项组的完整说明：下拉只显示短名，hover 时看全部选项 */
const optionGroupHint = (id: string) => {
  const preset = (WIZARD_OPTION_GROUPS as any)[id]
  if (preset) return preset.hint
  const g = (form.optionGroups as any[]).find((x: any) => x.id === id)
  return g ? `${g.name}：${(g.options || []).map((o: any) => o.label).filter(Boolean).join(' / ')}` : ''
}
const addCustomGroup = () => form.optionGroups.push({
  id: `cg-${Date.now()}`, name: '', options: [{ label: '', score: undefined }, { label: '', score: undefined }]
})
const roleOptions = WIZARD_ROLES.map(r => ({ label: r, value: r }))
const comparatorOptions = ['达到或超过', '低于或等于', '正好等于'].map(v => ({ label: v, value: v }))

// 模板 ② 枚举字典里的取值，全部带中文说明
const schoolSectionOptions = [
  { label: '全学段', value: 'all' }, { label: '小学', value: 'primary' },
  { label: '初中', value: 'junior' }, { label: '高中', value: 'senior' },
  { label: '复读/毕业班', value: 'repeat' }
]
const targetAudienceOptions = [
  { label: '教师', value: 'teacher' }, { label: '学生', value: 'student' },
  { label: '家长', value: 'guardian' }, { label: '班级整体', value: 'class' }
]
const formTypeOptions = [
  { label: '自评量表', value: 'self_report' }, { label: '观察记录', value: 'observation' },
  { label: '访谈', value: 'interview' }, { label: '勾选清单', value: 'checklist' }
]
const triggerMethodOptions = [
  { label: '老师主动做', value: 'manual' }, { label: '系统自动触发', value: 'auto' },
  { label: '定时推送', value: 'scheduled' }
]
const frequencyOptions = [
  { label: '只做一次', value: 'once' }, { label: '每天', value: 'daily' },
  { label: '每周', value: 'weekly' }, { label: '每月', value: 'monthly' },
  { label: '按次（每次评估都做）', value: 'per_case' }
]
const resultVisibilityOptions = [
  { label: '只有老师自己看得到', value: 'teacher_only' },
  { label: '老师和学生都能看', value: 'teacher_and_student' },
  { label: '心理专员可见', value: 'psychologist' }
]
const dataSensitivityOptions = [
  { label: '内部一般', value: 'internal' }, { label: '敏感', value: 'sensitive' },
  { label: '高度敏感', value: 'highly_sensitive' }
]
const sourceTypeOptions = [
  { label: '自有内容', value: 'proprietary' }, { label: '外部引用', value: 'external' },
  { label: '改编自外部', value: 'adapted' }
]
const evidenceLevelOptions = [
  { label: 'A · 有直接实证研究', value: 'A' }, { label: 'B · 有间接/改编研究', value: 'B' },
  { label: 'C · 有实践总结', value: 'C' }, { label: 'D · 经验做法', value: 'D' }
]
const redLineScopeOptions = [
  { label: '单张量表熔断', value: 'instrument' }, { label: '整个模块熔断', value: 'module' },
  { label: '全系统熔断', value: 'system' }
]
const toolFormOptions = [
  { label: '练习/操作', value: 'exercise' }, { label: '话术脚本', value: 'script' },
  { label: '检查清单', value: 'checklist' }, { label: '沟通框架', value: 'framework' },
  { label: '工作单/表格', value: 'worksheet' }
]
const severityOptions = [
  { label: '低', value: 'low' }, { label: '中', value: 'medium' },
  { label: '高', value: 'high' }, { label: '危机级', value: 'crisis' }
]
const calcMethodOptions = [
  { label: '平均分', value: 'mean' }, { label: '求和', value: 'sum' },
  { label: '加权', value: 'weighted' }
]
const matchModeOptions = [
  { label: '模糊匹配（推荐常规词）', value: 'fuzzy' },
  { label: '精确匹配（危机词建议用）', value: 'exact' }
]

const STEPS = [
  { key: 'module', title: '选模块', hint: '这次要整理哪个模块的内容，以及全局默认设置' },
  { key: 'scales', title: '有哪几张量表', hint: '老师进来先做哪张，什么时候才做下一张' },
  { key: 'questions', title: '每张量表问什么', hint: '题目、测哪个方面、选项类型、维度怎么算分' },
  { key: 'attributions', title: '可能的原因', hint: '这个模块的问题通常出在哪几个地方' },
  { key: 'evidences', title: '什么算命中', hint: '答成什么样，就算命中某个原因；可先定义组合指标' },
  { key: 'levels', title: '分几级', hint: '从最严重的往下排，以及跟老师怎么说' },
  { key: 'tools', title: '有哪些工具', hint: '每个工具解决哪个原因、怎么做' },
  { key: 'keywords', title: '关键词（可跳过）', hint: '老师说到哪些词时直接引导进这个模块' },
  { key: 'review', title: '确认并生成', hint: '读一遍系统将会怎么判断' }
]
const stepIndex = ref(0)
const step = computed(() => STEPS[stepIndex.value]!)

// ---------- 表单状态 ----------
function resetAll() {
  localStorage.removeItem(STORAGE_KEY)
  window.location.reload()
}

const emptyCondition = (): WizardCondition => ({
  targetType: 'total', target: '', comparator: '达到或超过', value: 3, join: '且'
})
const form = reactive<any>({
  module: 'home_school',
  version: '1.0.0',
  sourceRef: '',
  defaults: { ...DEFAULT_WIZARD_DEFAULTS },
  computedVariables: [],
  optionGroups: [],
  defaultLevelName: '暂无明显信号',
  defaultMessage: '',
  scales: [] as any[],
  attributions: [] as any[],
  evidences: [] as any[],
  levels: [] as any[],
  tools: [] as any[],
  keywords: [] as any[]
})

const STORAGE_KEY = 'business-wizard-draft'
onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try { Object.assign(form, JSON.parse(saved)) } catch { localStorage.removeItem(STORAGE_KEY) }
  }
})
// 填写量很大，中途关掉页面不能白填
watch(form, () => localStorage.setItem(STORAGE_KEY, JSON.stringify(form)), { deep: true })

// 题目维度名变化（输入/改名/删题）时把维度属性行对齐，避免输入过程中的中间态残留成多行
watch(
  () => (form.scales as any[]).map(s => (s.questions || []).map((q: any) => q.dimension || '').join('|')).join('~'),
  () => { for (const s of form.scales as any[]) syncDimensionDefs(s) },
  { immediate: true }
)

const scaleNames = computed<string[]>(() => form.scales.map((s: any) => s.name).filter(Boolean))
const attributionNames = computed<string[]>(() => form.attributions.map((a: any) => a.name).filter(Boolean))
const toolNames = computed<string[]>(() => form.tools.map((t: any) => t.name).filter(Boolean))
/** 工具的前置/替代/进阶是单选但 schema 存数组，这里做单向转换 */
const setToolRef = (t: any, key: string, v: string | undefined) => { t[key] = v ? [v] : [] }
function dimensionsOf(scaleName: string): string[] {
  const scale = form.scales.find((s: any) => s.name === scaleName)
  return [...new Set((scale?.questions || []).map((q: any) => q.dimension).filter(Boolean))] as string[]
}
function questionCountOf(scaleName: string): number {
  return (form.scales.find((s: any) => s.name === scaleName)?.questions || []).length
}

function addScale() {
  form.scales.push({
    name: '', role: form.scales.length ? '深度诊断' : '入口筛查', shortName: '', description: '',
    minutes: 5, prerequisites: [], exclusives: [], triggerConditions: [], triggerNote: '',
    usageTiming: '', timeLimitMinutes: undefined, minQuestions: undefined,
    reAssessmentIntervalDays: undefined, applicableGrades: [], applicableSubjects: [],
    normReference: '', reliabilityNote: '', validityNote: '', privacyNotice: '',
    applicabilityPreconditions: '', contraindications: '', postAssessmentActions: '',
    dimensionDefs: [], questions: []
  })
}
function addQuestion(scale: any) {
  scale.questions.push({ text: '', dimension: '', optionGroup: 'FREQ_5', reverse: false, help: '' })
}

/** 维度属性行的默认值 */
function defaultDimensionDef(name: string) {
  return { name, calcMethod: 'mean', weight: 1, description: '', highInterpretation: '', lowInterpretation: '', normMean: undefined, normStd: undefined }
}
/** 渲染视图：只显示题目里当前出现的维度，属性复用已填条目（纯函数，渲染期调用不能有副作用） */
function dimensionDefsView(scale: any): any[] {
  const names = [...new Set((scale.questions || []).map((q: any) => q.dimension).filter(Boolean))] as string[]
  const defs = Array.isArray(scale.dimensionDefs) ? scale.dimensionDefs : []
  return names.map(name => defs.find((d: any) => d.name === name) ?? defaultDimensionDef(name))
}
/** 把维度属性行与题目对齐：补缺，并清掉输入过程中留下的残留维度名（如 n → ni 时残留的 n） */
function syncDimensionDefs(scale: any): void {
  scale.dimensionDefs = dimensionDefsView(scale)
}

const addComputedVariable = () => form.computedVariables.push({ name: '', scale: form.scales[0]?.name || '', expression: '' })
const addAttribution = () => form.attributions.push({ name: '', description: '', highSign: '', typicalTrigger: '', action: '', weight: 1, tags: [] })
const addEvidence = () => form.evidences.push({
  attribution: attributionNames.value[0] || '', scale: scaleNames.value[0] || '',
  conditions: [emptyCondition()], weight: 2, description: ''
})
const addLevel = () => form.levels.push({
  name: '', scale: '', conditions: [emptyCondition()], redLine: false,
  redLineAction: '', teacherMessage: '', resultNote: '', notificationTemplate: '',
  escalationCondition: '', escalationTarget: '', reAssessTrigger: '',
  interventionTools: [], interventionActions: []
})
const addTool = () => form.tools.push({
  name: '', attributions: [], whenToUse: '', steps: [''], stepDetails: [], form: 'framework',
  severity: 'medium', script: '', prohibition: '', timePerSession: '', duration: '',
  expectedEffect: '', effectNote: '', outputArtifact: '', contraindicationNote: '',
  collaborativeTools: [], dimensions: [], reAssessmentIntervalDays: undefined,
  evidenceSource: '', crossModuleTags: [], prerequisiteTools: [], alternativeTools: [],
  advancedTools: [], preparation: '', materials: '', outcomeIndicator: '', failureCriteria: '',
  contraindications: []
})
const addStep = (tool: any) => { tool.steps.push(''); tool.stepDetails.push({}) }
const removeStep = (tool: any, i: number) => { tool.steps.splice(i, 1); tool.stepDetails.splice(i, 1) }
/** 步骤细节按下标安全访问：示例/载入数据里 stepDetails 可能比 steps 短，缺位就地补空对象 */
function stepDetailOf(tool: any, si: number) {
  if (!tool.stepDetails) tool.stepDetails = []
  return tool.stepDetails[si] || (tool.stepDetails[si] = {})
}
const addKeyword = () => form.keywords.push({ core: [], expanded: [], exclude: [], category: '', scale: '', tool: '', matchMode: 'fuzzy', risk: 'yellow', contextConstraint: '', description: '' })

/** 条件行：业务选「看哪里 + 达到什么程度」，不写表达式。
 *  计算变量只能用于归因/等级条件（引擎里能取到变量值）；
 *  触发条件只看前一张量表的结果，运行期算不出变量，不暴露变量选项。 */
function targetOptions(scaleName: string, withComputed = true) {
  return [
    ...(withComputed ? form.computedVariables.map((v: any) => ({ label: `变量：${v.name}`, value: `computed::${v.name}` })) : []),
    { label: '总分', value: 'total::' },
    { label: '平均分', value: 'average::' },
    ...dimensionsOf(scaleName).map(d => ({ label: `维度：${d}`, value: `dimension::${d}` })),
    ...Array.from({ length: questionCountOf(scaleName) }, (_, i) => ({ label: `第 ${i + 1} 题`, value: `question::${i + 1}` }))
  ]
}
const conditionKey = (c: WizardCondition) => `${c.targetType}::${c.target}`
function setConditionTarget(c: WizardCondition, value: string) {
  const [type, target] = value.split('::')
  c.targetType = type as WizardCondition['targetType']
  c.target = target || ''
}

// ---------- 预检 ----------
const pending = ref(false)
const preview = ref<any>(null)
const importing = ref(false)

async function runPreview() {
  pending.value = true
  preview.value = null
  try {
    preview.value = await $fetch('/api/v1/platform-admin/module-resources/wizard-preview', {
      method: 'POST', body: cleanPayload()
    })
    toast.add({
      title: preview.value.canImport ? '检查通过，可以导入' : '还有问题需要处理',
      color: preview.value.canImport ? 'success' : 'error'
    })
  } catch (error: any) {
    toast.add({ title: '检查失败', description: error?.data?.message || '请检查填写内容', color: 'error' })
  } finally {
    pending.value = false
  }
}

/** 去掉空行再提交，业务留了空白行不该算错 */
function cleanPayload(): WizardInput {
  return {
    ...form,
    optionGroups: form.optionGroups.filter((g: any) => g.name && g.options.some((o: any) => o.label))
      .map((g: any) => ({ ...g, options: g.options.filter((o: any) => o.label) })),
    scales: form.scales.filter((s: any) => s.name && s.questions.some((q: any) => q.text))
      .map((s: any) => {
        const kept: any = { ...s, questions: s.questions.filter((q: any) => q.text && q.dimension) }
        // 提交前按保留的题目对齐维度属性行，残留的中间态维度不能带进库
        syncDimensionDefs(kept)
        return kept
      }),
    attributions: form.attributions.filter((a: any) => a.name),
    evidences: form.evidences.filter((e: any) => e.attribution && e.scale && e.conditions.length),
    levels: form.levels.filter((l: any) => l.name && l.conditions.length),
    tools: form.tools.filter((t: any) => t.name && t.attributions.length && t.steps.some((x: string) => x))
      .map((t: any) => {
        // 步骤过滤后 stepDetails 要按下标对齐，否则附加信息会挂到错的步骤上
        const kept = t.steps.map((s: string, i: number) => (s ? i : -1)).filter((i: number) => i >= 0)
        return {
          ...t,
          steps: kept.map((i: number) => t.steps[i]),
          stepDetails: kept.map((i: number) => t.stepDetails[i] || {}).filter((d: any) => Object.keys(d).some(k => d[k]))
        }
      }),
    keywords: form.keywords.filter((k: any) => k.core.length)
  }
}

/**
 * 整套导入。走专用端点而不是逐个调 /import——
 * 那个端点会拿新文件和库里的旧对侧资源校验，而向导产出的是一整套替换，
 * 逐个导入必然在中间态撞上「新量表 vs 旧归因」的循环冲突。
 */
async function importAll(publish: boolean) {
  if (!preview.value?.canImport) return
  importing.value = true
  try {
    const res = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-import', {
      method: 'POST',
      body: { input: cleanPayload(), publish, confirmNoPersonalData: true }
    })
    toast.add({
      title: publish ? `5 个库已导入并发布（版本 ${form.version}）` : `5 个库已存为草稿（版本 ${form.version}）`,
      description: res.warnings?.length ? `有 ${res.warnings.length} 条建议改进的地方，可在上方查看` : undefined,
      color: 'success'
    })
    localStorage.removeItem(STORAGE_KEY)
  } catch (error: any) {
    toast.add({
      title: '导入失败，没有写入任何内容',
      description: error?.data?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    importing.value = false
  }
}

/** 版本号自动进一位，避免连续保存撞上版本唯一约束 */
const bumpVersion = (v: string) => {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/)
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.1'
}

/** 检查未通过时把当前填写内容留档成「待验证」版本：不生成库文件、不能发布，可载入继续改 */
const savingPending = ref(false)
async function saveAsPendingReview() {
  savingPending.value = true
  try {
    const res = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-import', {
      method: 'POST',
      body: { input: cleanPayload(), saveAsPending: true, confirmNoPersonalData: true }
    })
    form.version = bumpVersion(form.version)
    toast.add({
      title: `已保存为待验证版本（${res.written?.length || 0} 个库留档）`,
      description: '这份内容保存时检查未通过，不能直接发布；可随时通过「载入现有内容」重新载入继续修改。草稿已保留，可继续填写。',
      color: 'info'
    })
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    savingPending.value = false
  }
}

function download(lib: any) {
  const bytes = Uint8Array.from(atob(lib.contentBase64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${form.module}_${lib.libraryType}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- 第 2 步：编排自检（v4 模板 ③d 自检表的交互版） ----------
const orchestrationChecks = computed(() => {
  const named = (form.scales as any[]).filter((s: any) => s.name)
  const entry = named.filter((s: any) => s.role === '入口筛查')
  const checks: Array<{ ok: boolean, warn?: boolean, text: string }> = []
  checks.push({
    ok: entry.length === 1,
    text: entry.length === 1
      ? `有且只有一张「入口筛查」（${entry[0].name}）`
      : entry.length === 0
        ? '还没有「入口筛查」——老师进来不知道该先做哪张'
        : `「入口筛查」有 ${entry.length} 张，只能保留一张`
  })
  if (named.length > 1) {
    const noPrereq = named.filter((s: any) => s.role !== '入口筛查' && !(s.prerequisites || []).length)
    checks.push({
      ok: noPrereq.length === 0, warn: noPrereq.length > 0,
      text: noPrereq.length === 0
        ? '所有深度量表都说明了前置量表'
        : `${noPrereq.map((s: any) => `《${s.name}》`).join('、')}没设前置，老师可能没做入口就直接做它`
    })
    const noTrigger = named.filter((s: any) => s.role !== '入口筛查' && !(s.triggerConditions || []).length)
    checks.push({
      ok: noTrigger.length === 0, warn: noTrigger.length > 0,
      text: noTrigger.length === 0
        ? '深度量表都有触发条件，不会对所有人都「随时可做」'
        : `${noTrigger.map((s: any) => `《${s.name}》`).join('、')}没设触发条件，会显示「随时可做」，深度量表失去意义`
    })
    const noDeep = !named.some((s: any) => s.role === '深度诊断')
    checks.push({
      ok: !noDeep, warn: noDeep,
      text: noDeep ? '没有「深度诊断」——入口做完后没有后续步骤' : '有深度诊断承接入口筛查的结果'
    })
  }
  const emptyScales = named.filter((s: any) => !(s.questions || []).length)
  checks.push({
    ok: emptyScales.length === 0, warn: emptyScales.length > 0,
    text: emptyScales.length === 0 ? '每张量表都安排了题目' : `${emptyScales.map((s: any) => `《${s.name}》`).join('、')}还没有题目，下一步记得补`
  })
  return checks
})

// ---------- 第 2 步：路径图（v4 模板 ③c 路径示意的交互版） ----------
interface FlowNode { name: string, role: string, col: number, row: number, x: number, y: number }
const FLOW_COL_W = 200
const FLOW_GAP = 130
const FLOW_ROW_H = 84
/** 把量表按「前置链」分层：入口筛查在第 0 列，前置在第 k 列的进第 k+1 列 */
const flowLayout = computed(() => {
  const named = (form.scales as any[]).filter((s: any) => s.name)
  const colOf = new Map<string, number>()
  const entry = named.find((s: any) => s.role === '入口筛查')
  if (entry) colOf.set(entry.name, 0)
  // 迭代分配：所有前置都已分层时，本表进「最大前置列 + 1」
  let changed = true
  while (changed) {
    changed = false
    for (const s of named) {
      if (colOf.has(s.name)) continue
      const pres = (s.prerequisites || []).filter((p: string) => colOf.has(p))
      if (pres.length) {
        colOf.set(s.name, Math.max(...pres.map((p: string) => colOf.get(p)!)) + 1)
        changed = true
      }
    }
  }
  // 剩下的（无前置的非入口表）依次排到最后一列之后
  const maxCol = Math.max(0, ...colOf.values())
  let leftover = 0
  for (const s of named) {
    if (!colOf.has(s.name)) { colOf.set(s.name, maxCol + 1 + leftover); leftover++ }
  }
  // 每列内垂直排布
  const rowsInCol = new Map<number, number>()
  const nodes: FlowNode[] = []
  for (const s of named) {
    const col = colOf.get(s.name)!
    const row = rowsInCol.get(col) ?? 0
    rowsInCol.set(col, row + 1)
    nodes.push({ name: s.name, role: s.role, col, row, x: col * (FLOW_COL_W + FLOW_GAP), y: row * FLOW_ROW_H })
  }
  return { nodes, width: (Math.max(0, ...nodes.map(n => n.col)) + 1) * (FLOW_COL_W + FLOW_GAP) - FLOW_GAP + 24, height: Math.max(1, ...rowsInCol.values()) * FLOW_ROW_H + 12 }
})
/** 相邻列之间的前置关系连线（实线箭头） */
const flowPrereqEdges = computed(() => {
  const layout = flowLayout.value
  const edges: Array<{ x1: number, y1: number, x2: number, y2: number }> = []
  for (const n of layout.nodes) {
    const scale = (form.scales as any[]).find((s: any) => s.name === n.name)
    for (const pre of (scale?.prerequisites || [])) {
      const src = layout.nodes.find((m: any) => m.name === pre)
      if (src && src.col + 1 === n.col) {
        edges.push({
          x1: src.x + FLOW_COL_W, y1: src.y + 22,
          x2: n.x, y2: n.y + 22
        })
      }
    }
  }
  return edges
})
/** 跨列关系：互斥（红色虚线）与触发条件（蓝色点线，源 = 前置[0] 或入口量表，与编译端一致） */
const flowCrossEdges = computed(() => {
  const layout = flowLayout.value
  const edges: Array<{ x1: number, y1: number, x2: number, y2: number, kind: 'exclusive' | 'trigger', label?: string }> = []
  for (const n of layout.nodes) {
    const scale = (form.scales as any[]).find((s: any) => s.name === n.name)
    for (const ex of (scale?.exclusives || [])) {
      const tgt = layout.nodes.find((m: any) => m.name === ex)
      if (tgt) edges.push({
        x1: n.x + FLOW_COL_W, y1: n.y + 22, x2: tgt.x, y2: tgt.y + 22, kind: 'exclusive'
      })
    }
    if (scale?.role !== '入口筛查' && (scale?.triggerConditions || []).length) {
      const srcName = scale.prerequisites?.[0] || layout.nodes.find((m: any) => m.role === '入口筛查')?.name
      const src = layout.nodes.find((m: any) => m.name === srcName)
      if (src && src !== n) edges.push({
        x1: src.x + FLOW_COL_W, y1: src.y + 38, x2: n.x, y2: n.y + 38,
        kind: 'trigger', label: scale.triggerNote || '触发条件'
      })
    }
  }
  return edges
})

// ---------- 第 9 步：代入试算（v4 模板 ⑪ 推演算例的交互版） ----------
/** 量表名 → 维度名 → 1..5 强度。维度来自已填的题目，第 9 步时必然已定义。 */
const simAnswers = reactive<Record<string, Record<string, number>>>({})
/** 逐题覆盖：量表名 → 题号(qN) → 选项原始分值。覆盖维度强度，未覆盖的题仍按维度强度展开。 */
const simPerQuestion = reactive<Record<string, Record<string, number | undefined>>>({})
const simRunning = ref(false)
const simResult = ref<Record<string, any>>({})
/** 维度名列表（某张量表） */
function simDimensionsOf(scaleName: string): string[] {
  const scale = form.scales.find((s: any) => s.name === scaleName)
  return [...new Set((scale?.questions || []).map((q: any) => q.dimension).filter(Boolean))] as string[]
}
/** 滑块变化时先保证每个维度都有值，再防抖重算 */
function simAnswersOf(scaleName: string): Record<string, number> {
  if (!simAnswers[scaleName]) simAnswers[scaleName] = {}
  return simAnswers[scaleName]!
}
function simEnsure(scaleName: string) {
  const a = simAnswersOf(scaleName)
  for (const dim of simDimensionsOf(scaleName)) {
    if (a[dim] === undefined) a[dim] = 3
  }
}
function setSimValue(scaleName: string, dim: string, v: number) {
  simEnsure(scaleName)
  simAnswersOf(scaleName)[dim] = v
  runSimulate()
}
function setSimPreset(v: number) {
  // 预设是维度语义：清空逐题覆盖，让维度强度统一接管
  for (const k of Object.keys(simPerQuestion)) delete simPerQuestion[k]
  for (const s of (form.scales as any[]).filter((s: any) => s.name)) {
    simEnsure(s.name)
    for (const dim of simDimensionsOf(s.name)) simAnswersOf(s.name)[dim] = v
  }
  runSimulate()
}
/** 某题的选项（label + value），与编译端同源：预置组 base+idx，自定义组 score ?? idx+1 */
function simOptionsOf(q: any): Array<{ label: string, value: number }> {
  const preset = (WIZARD_OPTION_GROUPS as any)[q.optionGroup]
  if (preset) return preset.options.map((label: string, i: number) => ({ label, value: preset.base + i }))
  const g = (form.optionGroups as any[]).find((x: any) => x.id === q.optionGroup)
  return (g?.options || []).map((o: any, i: number) => ({ label: o.label, value: o.score ?? i + 1 }))
}
function simPerQuestionOf(scaleName: string): Record<string, number | undefined> {
  if (!simPerQuestion[scaleName]) simPerQuestion[scaleName] = {}
  return simPerQuestion[scaleName]!
}
/** 逐题覆盖：只保留当前题目集合里的 qN（题目增删后 qid 会错位，残留的覆盖必须丢弃） */
function cleanSimPerQuestion(scale: any): Record<string, number> {
  const valid = new Set(scale.questions.map((_: any, i: number) => `q${i + 1}`))
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(simPerQuestionOf(scale.name))) {
    if (v !== undefined && valid.has(k)) out[k] = v
  }
  return out
}
function setSimQuestionValue(scaleName: string, qid: string, v: number) {
  simPerQuestionOf(scaleName)[qid] = v
  runSimulate()
}
function resetSimQuestionValue(scaleName: string, qid: string) {
  delete simPerQuestionOf(scaleName)[qid]
  runSimulate()
}
async function runSimulate() {
  const payload = cleanPayload()
  if (!payload.scales.length) return
  simRunning.value = true
  try {
    const perQuestion: Record<string, Record<string, number>> = {}
    for (const s of payload.scales) {
      const cleaned = cleanSimPerQuestion(s)
      if (Object.keys(cleaned).length) perQuestion[s.name] = cleaned
    }
    const res = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-simulate', {
      method: 'POST', body: { input: payload, answers: simAnswers, perQuestion }
    })
    simResult.value = Object.fromEntries((res.scales || []).map((s: any) => [s.name, s]))
  } catch (error: any) {
    toast.add({ title: '试算失败', description: error?.data?.message || '请先通过「检查并生成」', color: 'error' })
  } finally {
    simRunning.value = false
  }
}
// 量表名或题目结构变化（增删题、维度/选项组改名）时结果与作答全部失效：
// qid 按题目顺序生成（q1..qn），题目变了之后残留的逐题覆盖会挂到错误的题上；
// 维度强度按维度名索引，维度改名后同样错位。结构变了，作答作废重来。
watch(() =>
  (form.scales as any[]).map(s =>
    `${s.name}:${(s.questions || []).map((q: any) => `${q.dimension}|${q.optionGroup}`).join(',')}`
  ).join('~'),
() => {
  simResult.value = {}
  for (const k of Object.keys(simPerQuestion)) delete simPerQuestion[k]
  for (const k of Object.keys(simAnswers)) delete simAnswers[k]
})


/**
 * 载入系统里已发布的内容继续改。
 *
 * 载入会覆盖当前表单（含未保存的草稿），所以必须经过弹窗确认：
 *   1. 打开弹窗时拉取该模块已发布的版本列表
 *   2. 业务选版本（默认最新）
 *   3. 确认后才真正载入，载入前明确提示会清空当前填写内容
 *
 * unsupported 必须硬性展示：库里的内容可能是手工填 Excel 来的，
 * 含有向导表达不了的部分，在这里保存会把它们丢掉。
 */
const loading = ref(false)
const loadedInfo = ref<any>(null)
const loadModalOpen = ref(false)
const loadVersions = ref<Array<{ version: string, statuses: string[], publishedAt: string | null }>>([])
const loadVersion = ref<string | undefined>(undefined)

const VERSION_STATUS_LABEL: Record<string, string> = {
  published: '已发布', draft: '草稿', pending_review: '待验证', retired: '已停用'
}

async function openLoadModal() {
  loadModalOpen.value = true
  loadVersions.value = []
  loadVersion.value = undefined
  try {
    // 打开时先拿版本列表；载入本身等确认后再按所选版本执行
    const res = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-load', {
      query: { module: form.module }
    })
    loadVersions.value = res.availableVersions || []
    loadVersion.value = res.selectedVersion || undefined
  } catch (error: any) {
    loadModalOpen.value = false
    toast.add({ title: '载入失败', description: error?.data?.message || '这个模块还没有可载入的内容', color: 'error' })
  }
}

async function confirmLoad() {
  if (!loadVersion.value) return
  loading.value = true
  try {
    const res = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-load', {
      query: { module: form.module, version: loadVersion.value }
    })
    Object.assign(form, res.input)
    loadedInfo.value = res
    preview.value = null
    stepIndex.value = 1
    loadModalOpen.value = false
    const notes = res.notes?.length ? res.notes.join(' ') : ''
    toast.add({
      title: `已载入${moduleOptions.find(m => m.value === form.module)?.label}的 ${res.selectedVersion} 版本内容`,
      description: [
        res.unsupported.length ? `有 ${res.unsupported.length} 处向导表达不了，保存会丢失，请看页面上的提示` : '',
        notes,
        res.unsupported.length ? '' : `版本号已自动进位到 ${res.input.version}`
      ].filter(Boolean).join('　'),
      color: res.unsupported.length ? 'warning' : notes ? 'info' : 'success'
    })
  } catch (error: any) {
    toast.add({ title: '载入失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadSample() {
  const sample = await $fetch<any>('/api/v1/platform-admin/module-resources/wizard-sample').catch(() => null)
  if (!sample) return toast.add({ title: '示例加载失败', color: 'error' })
  Object.assign(form, sample)
  toast.add({ title: '已填入家校沟通示例，可直接改成你自己的内容', color: 'success' })
}

const canNext = computed(() => {
  if (step.value.key === 'scales') return form.scales.some((s: any) => s.name)
  if (step.value.key === 'questions') return form.scales.every((s: any) => s.questions.some((q: any) => q.text && q.dimension))
  if (step.value.key === 'attributions') return form.attributions.some((a: any) => a.name)
  if (step.value.key === 'evidences') return form.evidences.some((e: any) => e.attribution)
  if (step.value.key === 'levels') return form.levels.some((l: any) => l.name)
  if (step.value.key === 'tools') return form.tools.some((t: any) => t.name)
  return true
})
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <UButton to="/platform-admin/resources" variant="ghost" color="neutral" icon="i-lucide-arrow-left" size="sm">返回三库运营台</UButton>
        <h1 class="mt-3 text-2xl font-semibold text-slate-800">业务填写向导</h1>
        <p class="mt-1 text-sm text-slate-500">
          一步一步问，全程中文。编码、条件表达式、权重这些由系统生成，你不用管。
        </p>
      </div>
      <div class="flex gap-2">
        <UButton size="xs" color="primary" variant="soft" icon="i-lucide-folder-open" :loading="loading"
          @click="openLoadModal">载入现有内容</UButton>
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-sparkles" @click="() => { void loadSample() }">填入示例</UButton>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-trash-2"
          @click="resetAll">清空重来</UButton>
      </div>
    </div>

    <!-- 载入现有内容：选版本 + 清空警告（紧凑弹层，Teleport 到 body 居中显示） -->
    <Teleport to="body">
      <div v-if="loadModalOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-24"
        @click.self="() => { loadModalOpen = false }">
        <div class="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-semibold text-slate-800">载入现有内容</h3>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="() => { loadModalOpen = false }" />
          </div>
          <p class="mt-1 text-xs leading-5 text-slate-500">
            选择 {{ moduleOptions.find(m => m.value === form.module)?.label }} 的版本载入，已发布、草稿、待验证、已停用都可以。
            <span class="text-amber-700">载入会清空当前填写的内容（含未保存草稿）</span>，修改后存成新版本。
          </p>
          <UFormField class="mt-3" label="版本">
            <!-- 弹层是手写 fixed z-50；reka 浮层 wrapper 的 z-index 取自 content 的计算样式。
                 必须用 main.css 里的固定类（select-content-over-modal）而不是 Tailwind 任意值类：
                 production 构建会漏掉 :ui 里传入的 z-[60] 之类，导致下拉被弹层遮住。 -->
            <USelect v-model="loadVersion"
              :items="(loadVersions || []).map(v => ({ label: `${v.version} · ${(v.statuses || []).map(s => VERSION_STATUS_LABEL[s] || s).join(' / ')}`, value: v.version }))"
              :ui="{ content: 'select-content-over-modal' }"
              class="w-full" />
          </UFormField>
          <p v-if="loadVersions.length === 0" class="mt-1 text-xs text-slate-400">正在读取版本列表…</p>
          <div class="mt-4 flex justify-end gap-2">
            <UButton size="sm" color="neutral" variant="soft" @click="() => { loadModalOpen = false }">取消</UButton>
            <UButton size="sm" color="primary" :disabled="!loadVersion" :loading="loading" @click="confirmLoad">确认载入</UButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 步骤条 -->
    <div class="mt-6 flex flex-wrap gap-1.5">
      <button
        v-for="(s, i) in STEPS" :key="s.key" type="button"
        class="rounded-full px-3 py-1 text-xs transition"
        :class="i === stepIndex ? 'bg-emerald-600 text-white'
          : i < stepIndex ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'"
        @click="stepIndex = i"
      >{{ i + 1 }}. {{ s.title }}</button>
    </div>

    <section class="mt-5 rounded-xl border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-800">{{ stepIndex + 1 }}. {{ step.title }}</h2>
      <p class="mt-1 text-sm text-slate-500">{{ step.hint }}</p>

      <!-- 载入现有内容后的提示。unsupported 必须一直显示，
           否则业务点一次保存就会丢掉手工填的部分且毫无察觉。 -->
      <div v-if="loadedInfo" class="mt-4 space-y-3">
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          已载入现行内容：{{ loadedInfo.sources.map((s: any) => `${s.libraryType} ${s.version}`).join('　') }}
          <span class="ml-2 text-slate-400">保存时会存成新版本 {{ form.version }}，不覆盖现有版本</span>
        </div>
        <div v-if="loadedInfo.unsupported.length" class="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <p class="text-sm font-semibold text-red-700">
            以下内容向导表达不了，如果你在这里保存，它们会丢失（共 {{ loadedInfo.unsupported.length }} 处）
          </p>
          <p class="mt-1 text-xs text-red-600">
            这些多半是当初直接填 Excel 加进去的。只想改向导能表达的部分的话，建议改完后请管理员用「导出」比对一下。
          </p>
          <ul class="mt-2 space-y-1">
            <li v-for="(u, i) in loadedInfo.unsupported" :key="i" class="text-xs leading-5 text-red-700">
              <span class="font-medium">{{ u.where }}</span> —— {{ u.detail }}
            </li>
          </ul>
        </div>
        <div v-if="loadedInfo.notes.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p v-for="(n, i) in loadedInfo.notes" :key="i" class="text-xs text-amber-700">{{ n }}</p>
        </div>
      </div>

      <!-- 1 模块 -->
      <div v-if="step.key === 'module'" class="mt-5 grid gap-4 sm:grid-cols-2">
        <UFormField label="模块"><USelect v-model="form.module" :items="moduleOptions" class="w-full" /></UFormField>
        <UFormField label="版本号" hint="每次导入要换一个新号（最多 40 字）"><UInput v-model="form.version" maxlength="40" class="w-full" /></UFormField>
        <UFormField label="内容出处" hint="写清楚这批内容来自哪份材料，方便日后追溯（最多 160 字）">
          <UInput v-model="form.sourceRef" maxlength="160" placeholder="如：家校沟通业务手册 v2" class="w-full" />
        </UFormField>
        <div class="sm:col-span-2">
          <UAlert color="info" variant="soft" title="想改系统里已有的内容？"
            description="点右上角「载入现有内容」，会把这个模块当前发布的 5 个库读回来变成中文，改完再存成新版本。" />
        </div>
        <div class="sm:col-span-2">
          <details class="group rounded-lg border border-slate-200 bg-slate-50/60">
            <summary class="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-slate-700">
              模块通用设置（只设一次，所有量表/工具共用）
              <UIcon name="i-lucide-chevron-down" class="size-4 transition group-open:rotate-180" />
            </summary>
            <div class="grid gap-3 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
              <UFormField label="适用学部"><USelect v-model="form.defaults.schoolSection" :items="schoolSectionOptions" class="w-full" /></UFormField>
              <UFormField label="施测对象"><USelect v-model="form.defaults.targetAudience" :items="targetAudienceOptions" class="w-full" /></UFormField>
              <UFormField label="施测形式"><USelect v-model="form.defaults.formType" :items="formTypeOptions" class="w-full" /></UFormField>
              <UFormField label="触发方式"><USelect v-model="form.defaults.triggerMethod" :items="triggerMethodOptions" class="w-full" /></UFormField>
              <UFormField label="作答频次"><USelect v-model="form.defaults.frequency" :items="frequencyOptions" class="w-full" /></UFormField>
              <UFormField label="结果可见性"><USelect v-model="form.defaults.resultVisibility" :items="resultVisibilityOptions" class="w-full" /></UFormField>
              <UFormField label="责任角色" hint="量表/禁忌规则的责任人（最多 40 字）"><UInput v-model="form.defaults.responsibleRole" maxlength="40" class="w-full" /></UFormField>
              <UFormField label="数据敏感级"><USelect v-model="form.defaults.dataSensitivity" :items="dataSensitivityOptions" class="w-full" /></UFormField>
              <UFormField label="来源属性"><USelect v-model="form.defaults.sourceType" :items="sourceTypeOptions" class="w-full" /></UFormField>
              <UFormField label="工具证据等级"><USelect v-model="form.defaults.evidenceLevel" :items="evidenceLevelOptions" class="w-full" /></UFormField>
              <UFormField label="红线熔断范围"><USelect v-model="form.defaults.redLineScope" :items="redLineScopeOptions" class="w-full" /></UFormField>
              <UFormField label="红线责任人" hint="最多 40 字"><UInput v-model="form.defaults.redLineOwner" maxlength="40" class="w-full" /></UFormField>
              <UFormField label="熔断后动作" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="form.defaults.redLineActions" maxlength="300" class="w-full" /></UFormField>
              <UFormField label="恢复条件" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="form.defaults.redLineRecovery" maxlength="300" class="w-full" /></UFormField>
            </div>
          </details>
        </div>
      </div>

      <!-- 2 量表 -->
      <div v-else-if="step.key === 'scales'" class="mt-5 space-y-4">
        <UAlert color="info" variant="soft" title="先想清楚顺序"
          description="每个模块只能有一张「入口筛查」——老师进来先做的那张。其余量表要说明「做完哪张之后、满足什么条件」才建议做，否则老师会看到一堆并列的量表不知道从哪开始。" />

        <template v-if="(form.scales as any[]).some((s: any) => s.name)">
          <!-- ③c 路径示意：量表怎么串起来 -->
          <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <p class="text-xs font-medium text-slate-600">老师会走的路径（实时更新）</p>
            <div class="mt-3 overflow-x-auto">
              <div class="relative" :style="{ width: flowLayout.width + 'px', height: flowLayout.height + 'px' }">
                <!-- 相邻列前置连线（实线箭头） -->
                <svg class="absolute inset-0" :width="flowLayout.width" :height="flowLayout.height">
                  <defs>
                    <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                    </marker>
                  </defs>
                  <line v-for="(e, i) in flowPrereqEdges" :key="'p' + i"
                    :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
                    stroke="#94a3b8" stroke-width="1.5" marker-end="url(#flow-arrow)" />
                  <line v-for="(e, i) in flowCrossEdges" :key="'c' + i"
                    :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
                    :stroke="e.kind === 'exclusive' ? '#f87171' : '#60a5fa'" stroke-width="1.5"
                    :stroke-dasharray="e.kind === 'exclusive' ? '5 3' : '2 4'" />
                  <text v-for="(e, i) in flowCrossEdges.filter((e: any) => e.kind === 'trigger')" :key="'t' + i"
                    :x="(e.x1 + e.x2) / 2" :y="((e.y1 + e.y2) / 2) - 6" text-anchor="middle"
                    class="text-[10px] fill-sky-600">{{ e.label }}</text>
                </svg>
                <!-- 量表节点 -->
                <div v-for="n in flowLayout.nodes" :key="n.name"
                  class="absolute w-[190px] rounded-lg border bg-white px-3 py-2 shadow-sm"
                  :class="n.role === '入口筛查' ? 'border-emerald-300' : n.role === '红线检查' ? 'border-red-300' : 'border-slate-300'"
                  :style="{ left: n.x + 'px', top: n.y + 'px' }">
                  <p class="truncate text-sm font-medium text-slate-700">{{ n.name }}</p>
                  <p class="mt-0.5 text-[11px] text-slate-400">{{ n.role }}</p>
                </div>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span class="inline-flex items-center gap-1"><span class="inline-block h-px w-4 bg-slate-400" />先做完哪张才能做</span>
              <span class="inline-flex items-center gap-1"><span class="inline-block h-px w-4 border-t-2 border-dashed border-red-400" />互斥（做了就不建议做对方）</span>
              <span class="inline-flex items-center gap-1"><span class="inline-block h-px w-4 border-t-2 border-dotted border-sky-400" />触发条件（满足才建议做）</span>
            </div>
          </div>

          <!-- ③d 编排自检：实时清单 -->
          <div class="rounded-lg border border-slate-200 p-4">
            <p class="text-xs font-medium text-slate-600">编排自检（③d）</p>
            <ul class="mt-2 space-y-1.5">
              <li v-for="(c, i) in orchestrationChecks" :key="i" class="flex items-start gap-2 text-xs leading-5">
                <UIcon v-if="c.ok" name="i-lucide-circle-check" class="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                <UIcon v-else-if="c.warn" name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <UIcon v-else name="i-lucide-circle-x" class="mt-0.5 size-3.5 shrink-0 text-red-500" />
                <span :class="c.ok ? 'text-slate-500' : c.warn ? 'text-amber-700' : 'text-red-700'">{{ c.text }}</span>
              </li>
            </ul>
          </div>
        </template>

        <div v-for="(scale, si) in (form.scales as any[])" :key="si" class="rounded-lg border border-slate-200 p-4">
          <div class="flex items-start justify-between gap-3">
            <span class="text-xs font-medium text-slate-400">第 {{ si + 1 }} 张</span>
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="form.scales.splice(si, 1)" />
          </div>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <UFormField label="量表名称" hint="2-120 字"><UInput v-model="scale.name" maxlength="120" placeholder="如：家校沟通双维速查" class="w-full" /></UFormField>
            <UFormField label="它是什么角色"><USelect v-model="scale.role" :items="roleOptions" class="w-full" /></UFormField>
            <UFormField label="预计几分钟" hint="1-120 分钟"><UInput v-model.number="scale.minutes" type="number" min="1" max="120" class="w-full" /></UFormField>
            <UFormField label="一句话说明它测什么" hint="最多 400 字"><UInput v-model="scale.description" maxlength="400" class="w-full" /></UFormField>
          </div>
          <template v-if="scale.role !== '入口筛查'">
            <div class="mt-3 rounded-lg bg-slate-50 p-3">
              <UFormField label="要先做完哪张" hint="没做完的话，这张在老师端点不动">
                <USelectMenu v-model="scale.prerequisites" multiple :items="scaleNames.filter(n => n !== scale.name)" class="w-full" />
              </UFormField>
              <UFormField class="mt-3" label="什么情况下才建议做这张" hint="按前一张量表的结果判断；不满足只标「当前不需要做」，老师仍可手动选">
                <div v-for="(c, ci) in (scale.triggerConditions as any[])" :key="ci" class="mt-2 flex flex-wrap items-center gap-2">
                  <USelect v-if="ci > 0" v-model="c.join" :items="[{label:'并且',value:'且'},{label:'或者',value:'或'}]" class="w-20" />
                  <USelect :model-value="conditionKey(c)" :items="targetOptions(scale.prerequisites[0] || scaleNames[0], false)"
                    class="w-44" @update:model-value="(v: string) => setConditionTarget(c, v)" />
                  <USelect v-model="c.comparator" :items="comparatorOptions" class="w-32" />
                  <UInput v-model.number="c.value" type="number" step="0.5" min="0" class="w-24" />
                  <span class="text-xs text-slate-400">分</span>
                  <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="scale.triggerConditions.splice(ci, 1)" />
                </div>
                <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus" @click="scale.triggerConditions.push(emptyCondition())">加一个条件</UButton>
              </UFormField>
              <UFormField class="mt-3" label="用人话说明这个条件" hint="老师会在量表卡片上看到这句（最多 200 字）">
                <UInput v-model="scale.triggerNote" maxlength="200" placeholder="如：沟通态度维度偏高时才需要判断家长类型" class="w-full" />
              </UFormField>
            </div>
          </template>
          <details class="group mt-3 rounded-lg border border-slate-200 bg-slate-50/50">
            <summary class="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium text-slate-500">
              更多设置（不填也有合理默认）
              <UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
            </summary>
            <div class="grid gap-3 border-t border-slate-200 px-3 py-3 sm:grid-cols-2">
              <UFormField label="量表简称" hint="教师端显示用，不填自动取名字前 8 个字（最多 40 字）"><UInput v-model="scale.shortName" maxlength="40" class="w-full" /></UFormField>
              <UFormField label="使用时机" hint="如：每次家校沟通前（最多 120 字）"><UInput v-model="scale.usageTiming" maxlength="120" class="w-full" /></UFormField>
              <UFormField label="作答时限（分钟）" hint="1-120"><UInput v-model.number="scale.timeLimitMinutes" type="number" min="1" max="120" class="w-full" /></UFormField>
              <UFormField label="最低题数" hint="1-200"><UInput v-model.number="scale.minQuestions" type="number" min="1" max="200" class="w-full" /></UFormField>
              <UFormField label="重评间隔天数" hint="如 30 表示 30 天后提醒重做（1-3650）"><UInput v-model.number="scale.reAssessmentIntervalDays" type="number" min="1" max="3650" class="w-full" /></UFormField>
              <UFormField label="适用年级" hint="回车分隔，如 7、8、9"><UInputTags v-model="scale.applicableGrades" class="w-full" /></UFormField>
              <UFormField label="适用学科" hint="回车分隔，留空表示不限"><UInputTags v-model="scale.applicableSubjects" class="w-full" /></UFormField>
              <UFormField label="与哪几张量表互斥" hint="做了这张就不建议做那些"><USelectMenu v-model="scale.exclusives" multiple :items="scaleNames.filter(n => n !== scale.name)" class="w-full" /></UFormField>
              <UFormField label="常模参照" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="scale.normReference" maxlength="300" placeholder="如：全国中小学班主任常模 N=3200" class="w-full" /></UFormField>
              <UFormField label="外部授权说明" hint="引用外部量表/工具时的授权备注（最多 300 字）"><UInput v-model="scale.externalAuthorizationNote" maxlength="300" class="w-full" /></UFormField>
              <UFormField label="信度说明" hint="最多 300 字"><UInput v-model="scale.reliabilityNote" maxlength="300" placeholder="如：Cronbach α=0.87" class="w-full" /></UFormField>
              <UFormField label="效度说明" hint="最多 300 字"><UInput v-model="scale.validityNote" maxlength="300" class="w-full" /></UFormField>
              <UFormField label="隐私声明" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="scale.privacyNotice" maxlength="300" class="w-full" /></UFormField>
              <UFormField label="适用前提" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="scale.applicabilityPreconditions" maxlength="300" placeholder="如：适用于在职班主任" class="w-full" /></UFormField>
              <UFormField label="不适合情况" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="scale.contraindications" maxlength="300" class="w-full" /></UFormField>
              <UFormField label="后续建议动作" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="scale.postAssessmentActions" maxlength="300" class="w-full" /></UFormField>
              <div class="sm:col-span-2 mt-1 rounded-lg bg-white/70 p-3">
                <p class="text-xs font-medium text-slate-600">覆盖模块通用设置（可选）—— 留空即用模块默认</p>
                <div class="mt-2 grid gap-3 sm:grid-cols-3">
                  <UFormField label="适用学部"><USelect v-model="scale.schoolSection" :items="schoolSectionOptions" class="w-full" /></UFormField>
                  <UFormField label="施测对象"><USelect v-model="scale.targetAudience" :items="targetAudienceOptions" class="w-full" /></UFormField>
                  <UFormField label="施测形式"><USelect v-model="scale.formType" :items="formTypeOptions" class="w-full" /></UFormField>
                  <UFormField label="触发方式"><USelect v-model="scale.triggerMethod" :items="triggerMethodOptions" class="w-full" /></UFormField>
                  <UFormField label="作答频次"><USelect v-model="scale.frequency" :items="frequencyOptions" class="w-full" /></UFormField>
                  <UFormField label="结果可见性"><USelect v-model="scale.resultVisibility" :items="resultVisibilityOptions" class="w-full" /></UFormField>
                  <UFormField label="责任角色" hint="最多 40 字"><UInput v-model="scale.responsibleRole" maxlength="40" class="w-full" /></UFormField>
                  <UFormField label="数据敏感级"><USelect v-model="scale.dataSensitivity" :items="dataSensitivityOptions" class="w-full" /></UFormField>
                  <UFormField label="来源属性"><USelect v-model="scale.sourceType" :items="sourceTypeOptions" class="w-full" /></UFormField>
                </div>
              </div>
            </div>
          </details>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addScale">加一张量表</UButton>
      </div>

      <!-- 3 题目 -->
      <div v-else-if="step.key === 'questions'" class="mt-5 space-y-5">
        <UAlert color="warning" variant="soft" title="「方向」这一栏最容易出错"
          description="如果题目是「状态越好、老师越会选高分」（比如「我觉得这份工作值得」），要勾上「反向」。勾错了系统会把状态好的老师判成高风险，而且没有任何校验能发现。" />
        <div v-for="(scale, si) in (form.scales as any[])" :key="si" class="rounded-lg border border-slate-200 p-4">
          <h3 class="font-medium text-slate-700">《{{ scale.name || '未命名量表' }}》</h3>
          <div v-for="(q, qi) in (scale.questions as any[])" :key="qi" class="mt-3 rounded-lg bg-slate-50 p-3">
            <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
              <UFormField :label="qi === 0 ? '题目' : ''" :hint="qi === 0 ? '最多 400 字' : ''">
                <UInput v-model="q.text" maxlength="400" :placeholder="`第 ${qi + 1} 题`" class="w-full" />
              </UFormField>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="self-end" @click="scale.questions.splice(qi, 1)" />
            </div>
            <div class="mt-2 grid gap-2 sm:grid-cols-[1.5fr_1.2fr_auto]">
              <UFormField :label="qi === 0 ? '测哪个方面' : ''" :hint="qi === 0 ? '同名的会归成一个维度（最多 60 字）' : ''">
                <UInput v-model="q.dimension" maxlength="60" placeholder="如：配合度" class="w-full" />
              </UFormField>
              <UFormField :label="qi === 0 ? '选项' : ''">
                <UTooltip :text="optionGroupHint(q.optionGroup)">
                  <USelect v-model="q.optionGroup" :items="optionGroupOptions" class="w-full" />
                </UTooltip>
              </UFormField>
              <UFormField :label="qi === 0 ? '反向' : ''">
                <UCheckbox v-model="q.reverse" label="反向题" />
              </UFormField>
            </div>
            <UFormField class="mt-2" :label="qi === 0 ? '答题提示（可选）' : ''" :hint="qi === 0 ? '最多 200 字' : ''">
              <UInput v-model="q.help" maxlength="200" placeholder="老师作答时会看到这句说明，如：按最近 7 天的实际感受作答" class="w-full" />
            </UFormField>
          </div>
          <UButton class="mt-3" size="xs" variant="soft" icon="i-lucide-plus" @click="addQuestion(scale)">加一道题</UButton>
          <div v-if="dimensionDefsView(scale).length" class="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">每个方面怎么算分、高分低分怎么看（可折叠可不填）</p>
            <div v-for="def in dimensionDefsView(scale)" :key="def.name" class="mt-2 rounded bg-slate-50 p-3">
              <div class="grid gap-2 sm:grid-cols-[1fr_1.2fr_1fr]">
                <span class="self-center text-sm font-medium text-slate-700">{{ def.name }}</span>
                <UFormField label="计算方式"><USelect v-model="def.calcMethod" :items="calcMethodOptions" class="w-full" /></UFormField>
                <UFormField label="权重系数" hint="0.1-10"><UInput v-model.number="def.weight" type="number" step="0.1" min="0.1" max="10" class="w-full" /></UFormField>
                <UFormField label="维度说明" class="sm:col-span-3" hint="最多 300 字"><UInput v-model="def.description" maxlength="300" class="w-full" /></UFormField>
                <UFormField label="高分解释" hint="如：≥4 分表示风险高（最多 300 字）"><UInput v-model="def.highInterpretation" maxlength="300" class="w-full" /></UFormField>
                <UFormField label="低分解释" hint="最多 300 字"><UInput v-model="def.lowInterpretation" maxlength="300" class="w-full" /></UFormField>
                <UFormField label="常模均值" hint="0-100"><UInput v-model.number="def.normMean" type="number" step="0.1" min="0" max="100" class="w-full" /></UFormField>
                <UFormField label="常模标准差" hint="0-100"><UInput v-model.number="def.normStd" type="number" step="0.1" min="0" max="100" class="w-full" /></UFormField>
              </div>
            </div>
          </div>
        </div>

        <!-- 自定义选项组：预置三组之外，业务自己定义（对应 v4 ④b） -->
        <details class="rounded-lg border border-slate-200 bg-white p-3">
          <summary class="flex cursor-pointer items-center justify-between text-sm font-medium text-slate-700">
            自定义选项组（可跳过）
            <UIcon name="i-lucide-chevron-down" class="size-4 transition group-open:rotate-180" />
          </summary>
          <p class="mt-1 text-xs text-slate-500">
            预置的频率五点 / 认同五点 / 是否两点不够用时，在这里定义自己的选项组（如四点量表、自定义选项文本），
            然后在题目的「选项」下拉里选它。每项的分值默认从 1 起递增，也可以自己指定。
          </p>
          <div v-for="(g, gi) in (form.optionGroups as any[])" :key="gi" class="mt-3 rounded-lg border border-slate-200 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <UInput v-model="g.name" maxlength="40" placeholder="组名，如：频率四点" class="w-56" />
              <span class="text-xs text-slate-400">显示在题目「选项」下拉里</span>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="ml-auto" @click="form.optionGroups.splice(gi, 1)">删除</UButton>
            </div>
            <div v-for="(o, oi) in (g.options as any[])" :key="oi" class="mt-2 flex items-center gap-2">
              <UInput v-model="o.label" maxlength="60" :placeholder="`选项 ${oi + 1}，如：几乎没有`" class="flex-1" />
              <UInput v-model.number="o.score" type="number" min="0" max="100" class="w-20" placeholder="分值" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="g.options.splice(oi, 1)" />
            </div>
            <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus" @click="g.options.push({ label: '', score: undefined })">加一个选项</UButton>
          </div>
          <UButton class="mt-3" size="xs" variant="soft" icon="i-lucide-plus" @click="addCustomGroup">加一个选项组</UButton>
        </details>
      </div>

      <!-- 4 原因 -->
      <div v-else-if="step.key === 'attributions'" class="mt-5 space-y-3">
        <UAlert color="info" variant="soft" title="这是整套系统的主干"
          description="后面的工具、话术都要挂到这里的某个原因上。措辞定下来之后尽量别改——改了要同步改工具那一步。" />
        <div v-for="(a, ai) in (form.attributions as any[])" :key="ai" class="rounded-lg border border-slate-200 p-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="原因名称" hint="2-80 字"><UInput v-model="a.name" maxlength="80" placeholder="如：家长配合度低" class="w-full" /></UFormField>
            <UFormField label="重要程度" hint="默认 1。填 1.5 表示这个原因比别的更值得优先处理（0.1-10）">
              <UInput v-model.number="a.weight" type="number" step="0.1" min="0.1" max="10" class="w-full" />
            </UFormField>
            <UFormField label="出现这个问题时通常什么表现" hint="最多 300 字"><UInput v-model="a.highSign" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="通常由什么引起" hint="最多 300 字"><UInput v-model="a.typicalTrigger" maxlength="300" placeholder="如：家长工作繁忙，缺少固定沟通时间" class="w-full" /></UFormField>
            <UFormField label="命中后给老师的建议动作" hint="最多 300 字"><UInput v-model="a.action" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="匹配标签" hint="回车分隔，用于跨库匹配（如 emotion、pressure）">
              <UInputTags v-model="a.tags" class="w-full" />
            </UFormField>
          </div>
          <UButton class="mt-2" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="form.attributions.splice(ai, 1)">删除</UButton>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addAttribution">加一个原因</UButton>
      </div>

      <!-- 5 证据 -->
      <div v-else-if="step.key === 'evidences'" class="mt-5 space-y-3">
        <UAlert color="info" variant="soft" title="每个原因至少要有一条"
          description="没填的原因永远算不出来，等于白填。一个原因可以有多条——命中越多、分量越大，这个原因排得越靠前。" />
        <div v-for="(e, ei) in (form.evidences as any[])" :key="ei" class="rounded-lg border border-slate-200 p-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="哪个原因"><USelect v-model="e.attribution" :items="attributionNames" class="w-full" /></UFormField>
            <UFormField label="看哪张量表"><USelect v-model="e.scale" :items="scaleNames" class="w-full" /></UFormField>
            <UFormField label="分量" hint="默认 2，关键信号可以给 3（0.1-10）"><UInput v-model.number="e.weight" type="number" step="0.5" min="0.1" max="10" class="w-full" /></UFormField>
          </div>
          <div class="mt-3">
            <p class="text-xs font-medium text-slate-500">答成什么样算命中</p>
            <div v-for="(c, ci) in (e.conditions as any[])" :key="ci" class="mt-2 flex flex-wrap items-center gap-2">
              <USelect v-if="ci > 0" v-model="c.join" :items="[{label:'并且',value:'且'},{label:'或者',value:'或'}]" class="w-20" />
              <USelect :model-value="conditionKey(c)" :items="targetOptions(e.scale)" class="w-44"
                @update:model-value="(v: string) => setConditionTarget(c, v)" />
              <USelect v-model="c.comparator" :items="comparatorOptions" class="w-32" />
              <UInput v-model.number="c.value" type="number" step="0.5" min="0" class="w-24" />
              <span class="text-xs text-slate-400">分</span>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="e.conditions.splice(ci, 1)" />
            </div>
            <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus" @click="e.conditions.push(emptyCondition())">加一个条件</UButton>
          </div>
          <UFormField class="mt-3" label="这条依据怎么描述给老师看" hint="最多 300 字">
            <UInput v-model="e.description" maxlength="300" placeholder="如：消息长期不回，配合度已到需要干预的程度" class="w-full" />
          </UFormField>
          <UButton class="mt-2" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="form.evidences.splice(ei, 1)">删除</UButton>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addEvidence">加一条</UButton>

        <div class="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <p class="text-sm font-medium text-slate-700">补充指标（可跳过）</p>
          <p class="mt-1 text-xs text-slate-500">
            归因条件里只认「总分 / 平均分 / 某个方面 / 某道题」。如果你想表达「沟通态度 + 配合度」这种组合指标，
            在这里定义一个计算变量，之后它就能出现在条件里。表达式用中文写，支持 维度[方面名]、题[第几题]、总分、均分和 + - * /。
          </p>
          <div v-for="(v, vi) in (form.computedVariables as any[])" :key="vi" class="mt-3 rounded-lg bg-white p-3">
            <div class="grid gap-2 sm:grid-cols-[1fr_1.4fr_2fr_auto]">
              <UFormField label="指标名" hint="最多 60 字"><UInput v-model="v.name" maxlength="60" placeholder="如：沟通压力指数" class="w-full" /></UFormField>
              <UFormField label="按哪张量表算"><USelect v-model="v.scale" :items="scaleNames" class="w-full" /></UFormField>
              <UFormField label="怎么算" hint="最多 300 字">
                <UInput v-model="v.expression" maxlength="300" placeholder="如：维度[沟通态度] + 维度[配合度]" class="w-full" />
              </UFormField>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="self-center" @click="form.computedVariables.splice(vi, 1)" />
            </div>
          </div>
          <UButton class="mt-3" size="xs" variant="soft" icon="i-lucide-plus" @click="addComputedVariable">加一个指标</UButton>
        </div>
      </div>

      <!-- 6 分级 -->
      <div v-else-if="step.key === 'levels'" class="mt-5 space-y-3">
        <UAlert color="info" variant="soft" title="从最严重的往下排"
          description="系统从上往下匹配，第一条命中就停。严重程度和优先级由顺序自动决定，等级颜色按五色分级（红=危机、橙=警告、黄=预警、蓝=关注、绿=正常），最后会自动补一条「都不满足」的兜底，你不用管。" />
        <div v-for="(lv, li) in (form.levels as any[])" :key="li" class="rounded-lg border p-4"
          :class="lv.redLine ? 'border-red-200 bg-red-50/40' : 'border-slate-200'">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="等级名称" hint="最多 40 字"><UInput v-model="lv.name" maxlength="40" placeholder="如：C 级需谨慎" class="w-full" /></UFormField>
            <UFormField label="按哪张量表判"><USelect v-model="lv.scale" :items="scaleNames" class="w-full" /></UFormField>
          </div>
          <div class="mt-3">
            <p class="text-xs font-medium text-slate-500">什么条件判为这一级</p>
            <div v-for="(c, ci) in (lv.conditions as any[])" :key="ci" class="mt-2 flex flex-wrap items-center gap-2">
              <USelect v-if="ci > 0" v-model="c.join" :items="[{label:'并且',value:'且'},{label:'或者',value:'或'}]" class="w-20" />
              <USelect :model-value="conditionKey(c)" :items="targetOptions(lv.scale || scaleNames[0])" class="w-44"
                @update:model-value="(v: string) => setConditionTarget(c, v)" />
              <USelect v-model="c.comparator" :items="comparatorOptions" class="w-32" />
              <UInput v-model.number="c.value" type="number" step="0.5" min="0" class="w-24" />
              <span class="text-xs text-slate-400">分</span>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="lv.conditions.splice(ci, 1)" />
            </div>
            <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus" @click="lv.conditions.push(emptyCondition())">加一个条件</UButton>
          </div>
          <UFormField class="mt-3" label="判到这一级时，系统跟老师说什么"
            hint="最多 800 字；可以用 ${主要归因} 代表算出来的主要原因">
            <UTextarea v-model="lv.teacherMessage" maxlength="800" :rows="2" class="w-full" />
          </UFormField>
          <div class="mt-3 grid gap-3 sm:grid-cols-3">
            <UFormField label="什么情况要往上升一级" hint="留空表示不设升级（最多 300 字）">
              <UInput v-model="lv.escalationCondition" maxlength="300" placeholder="如：两周内无改善" class="w-full" />
            </UFormField>
            <UFormField label="升级后交给谁" hint="最多 120 字">
              <UInput v-model="lv.escalationTarget" maxlength="120" placeholder="如：年级组 / 心理专员" class="w-full" />
            </UFormField>
            <UFormField label="多久后重新评一次" hint="最多 200 字">
              <UInput v-model="lv.reAssessTrigger" maxlength="200" placeholder="如：14 天后复评" class="w-full" />
            </UFormField>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <UFormField label="这一级直接推哪些工具（可选）"
              hint="判到这一级时无条件进方案，和归因匹配出的工具并存去重；不选就只靠归因推工具">
              <USelectMenu v-model="lv.interventionTools" multiple :items="toolNames" class="w-full" />
            </UFormField>
            <UFormField label="这一级直接让老师做什么（可选）" hint="判到这一级时直接进方案的干预动作，和归因建议并存">
              <UTextarea :model-value="(lv.interventionActions || []).join('\n')" :rows="2" class="w-full"
                placeholder="每行一条动作，如：&#10;本周内完成一次一对一沟通并记录反馈"
                @update:model-value="(v: string) => lv.interventionActions = v.split('\n').map((s: string) => s.trim()).filter(Boolean)" />
            </UFormField>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-4">
            <UCheckbox v-model="lv.redLine" label="这一级触发红线（不出方案，直接转安全流程）" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="form.levels.splice(li, 1)">删除</UButton>
          </div>
          <UFormField v-if="lv.redLine" class="mt-3" label="触发后要求老师立即做什么" hint="最多 300 字">
            <UInput v-model="lv.redLineAction" maxlength="300" placeholder="如：暂停单独沟通，立即上报年级组" class="w-full" />
          </UFormField>
          <UFormField v-if="lv.redLine" class="mt-3" label="发给责任人的通知文案"
            hint="触发红线时系统会按这个模板通知责任人（模块设置里的「红线责任人」）（最多 500 字）">
            <UInput v-model="lv.notificationTemplate" maxlength="500" placeholder="如：[教师姓名]老师触发红线，请尽快登录系统查看" class="w-full" />
          </UFormField>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addLevel">加一个等级</UButton>
        <div class="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
          <UFormField label="都不满足时叫什么" hint="最多 40 字"><UInput v-model="form.defaultLevelName" maxlength="40" class="w-full" /></UFormField>
          <UFormField label="都不满足时跟老师说什么" hint="最多 800 字"><UInput v-model="form.defaultMessage" maxlength="800" class="w-full" /></UFormField>
        </div>
      </div>

      <!-- 7 工具 -->
      <div v-else-if="step.key === 'tools'" class="mt-5 space-y-3">
        <UAlert color="info" variant="soft" title="工具可以挂原因，也可以只被等级引用"
          description="挂原因的工具由归因匹配推出来；不挂原因的工具只能在「分级」步骤里被某一级直接引用（干预工具）。两种方式任一命中就会进方案。" />
        <div v-for="(t, ti) in (form.tools as any[])" :key="ti" class="rounded-lg border border-slate-200 p-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="工具名称" hint="2-120 字"><UInput v-model="t.name" maxlength="120" placeholder="如：三步共情沟通法" class="w-full" /></UFormField>
            <UFormField label="解决哪些原因"><USelectMenu v-model="t.attributions" multiple :items="attributionNames" class="w-full" /></UFormField>
            <UFormField label="形式"><USelect v-model="t.form" :items="toolFormOptions" class="w-full" /></UFormField>
            <UFormField label="适用严重度" hint="越低越常用，越高越紧急"><USelect v-model="t.severity" :items="severityOptions" class="w-full" /></UFormField>
            <UFormField label="什么时候用" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="t.whenToUse" maxlength="300" placeholder="如：家长情绪明显、一开口就对立时" class="w-full" /></UFormField>
          </div>
          <UFormField class="mt-3" label="怎么做（一行一步）">
            <div v-for="(_, si) in (t.steps as any[])" :key="si" class="mt-2">
              <div class="flex items-center gap-2">
                <span class="w-6 text-center text-xs text-slate-400">{{ si + 1 }}</span>
                <UInput v-model="t.steps[si]" class="flex-1" />
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="removeStep(t, si)" />
              </div>
              <details class="ml-8 mt-1 rounded bg-slate-50 px-2 py-1">
                <summary class="cursor-pointer text-xs text-slate-400">这步的耗时/话术/注意事项（可选）</summary>
                <div class="grid gap-2 py-2 sm:grid-cols-2">
                  <UFormField label="预计耗时" hint="最多 80 字"><UInput v-model="stepDetailOf(t, si).estimatedTime" maxlength="80" placeholder="如：2 分钟" class="w-full" /></UFormField>
                  <UFormField label="所需材料" hint="最多 200 字"><UInput v-model="stepDetailOf(t, si).materials" maxlength="200" class="w-full" /></UFormField>
                  <UFormField label="关键提示" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="stepDetailOf(t, si).keyTip" maxlength="300" class="w-full" /></UFormField>
                  <UFormField label="话术模板" class="sm:col-span-2" hint="最多 300 字"><UInput v-model="stepDetailOf(t, si).scriptTemplate" maxlength="300" class="w-full" /></UFormField>
                  <UFormField label="成功标准" hint="最多 300 字"><UInput v-model="stepDetailOf(t, si).successCriteria" maxlength="300" class="w-full" /></UFormField>
                  <UFormField label="常见问题" hint="最多 300 字"><UInput v-model="stepDetailOf(t, si).commonIssues" maxlength="300" class="w-full" /></UFormField>
                </div>
              </details>
            </div>
            <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus" @click="addStep(t)">加一步</UButton>
          </UFormField>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <UFormField label="关键话术" hint="最多 500 字"><UInput v-model="t.script" maxlength="500" class="w-full" /></UFormField>
            <UFormField label="不能做什么" hint="最多 300 字"><UInput v-model="t.prohibition" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="单次耗时" hint="最多 80 字"><UInput v-model="t.timePerSession" maxlength="80" placeholder="如：一次 15 分钟" class="w-full" /></UFormField>
            <UFormField label="疗程与频次" hint="最多 80 字"><UInput v-model="t.duration" maxlength="80" placeholder="如：每日 1-2 次，连续 7 天" class="w-full" /></UFormField>
            <UFormField label="预期效果" hint="用可观察的结果描述，如「单次可下降 1-2 分主观压力值」（最多 300 字）"><UInput v-model="t.expectedEffect" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="效果说明" hint="最多 300 字"><UInput v-model="t.effectNote" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="作用在哪些方面" hint="对应量表的「测哪个方面」，回车分隔"><UInputTags v-model="t.dimensions" class="w-full" /></UFormField>
            <UFormField label="证据来源" hint="如：某研究 / 校内实践总结（最多 300 字）"><UInput v-model="t.evidenceSource" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="重评间隔天数" hint="1-3650"><UInput v-model.number="t.reAssessmentIntervalDays" type="number" min="1" max="3650" class="w-full" /></UFormField>
            <UFormField label="跨模块标签" hint="其他模块也能引用这个工具时用"><UInputTags v-model="t.crossModuleTags" class="w-full" /></UFormField>
            <UFormField label="输出物" hint="做完这个工具会得到什么，如「一次执行记录」（最多 80 字）"><UInput v-model="t.outputArtifact" maxlength="80" class="w-full" /></UFormField>
            <UFormField label="禁忌说明" hint="整个工具层面的禁用说明（区别于下方逐条禁忌）（最多 300 字）"><UInput v-model="t.contraindicationNote" maxlength="300" class="w-full" /></UFormField>
            <UFormField label="协同工具" hint="这个工具常与其他工具配合使用"><USelectMenu v-model="t.collaborativeTools" multiple :items="toolNames.filter(n => n !== t.name)" class="w-full" /></UFormField>
            <UFormField label="适用学部" hint="留空用模块通用设置"><USelect v-model="t.schoolSection" :items="schoolSectionOptions" class="w-full" /></UFormField>
            <UFormField label="适用对象" hint="留空用模块通用设置的施测对象"><USelect v-model="t.targetUsers" :items="targetAudienceOptions" class="w-full" /></UFormField>
            <UFormField label="证据等级" hint="留空用模块通用设置"><USelect v-model="t.evidenceLevel" :items="evidenceLevelOptions" class="w-full" /></UFormField>
            <UFormField label="前置工具" hint="用之前最好先做哪个">
              <USelect :model-value="t.prerequisiteTools?.[0] || undefined" :items="toolNames.filter(n => n !== t.name)"
                @update:model-value="(v: string) => setToolRef(t, 'prerequisiteTools', v)" class="w-full" />
            </UFormField>
            <UFormField label="替代工具" hint="这个工具做不了时换哪个">
              <USelect :model-value="t.alternativeTools?.[0] || undefined" :items="toolNames.filter(n => n !== t.name)"
                @update:model-value="(v: string) => setToolRef(t, 'alternativeTools', v)" class="w-full" />
            </UFormField>
            <UFormField label="进阶工具" hint="熟练之后升级用哪个">
              <USelect :model-value="t.advancedTools?.[0] || undefined" :items="toolNames.filter(n => n !== t.name)"
                @update:model-value="(v: string) => setToolRef(t, 'advancedTools', v)" class="w-full" />
            </UFormField>
            <UFormField label="做之前要准备什么" hint="最多 300 字"><UInput v-model="t.preparation" maxlength="300" placeholder="如：提前调出近两周的记录" class="w-full" /></UFormField>
            <UFormField label="需要哪些材料" hint="最多 300 字"><UInput v-model="t.materials" maxlength="300" placeholder="如：观察记录表" class="w-full" /></UFormField>
            <UFormField label="怎么算做到位了" hint="最多 300 字"><UInput v-model="t.outcomeIndicator" maxlength="300" placeholder="如：一周内主动沟通 2 次" class="w-full" /></UFormField>
            <UFormField label="怎么算没做成，该换别的" hint="最多 300 字"><UInput v-model="t.failureCriteria" maxlength="300" placeholder="如：连续两次家长拒绝沟通" class="w-full" /></UFormField>
          </div>
          <UFormField class="mt-3" label="什么情况下这个工具不能用"
            hint="选「直接排除」的话，命中时系统绝不会推荐这个工具">
            <div v-for="(c, ci) in (t.contraindications as any[])" :key="ci" class="mt-2 flex flex-wrap items-center gap-2">
              <UInput v-model="c.condition" maxlength="200" placeholder="如：家长已提出投诉" class="flex-1" />
              <USelect v-model="c.type" :items="[{label:'直接排除',value:'block'},{label:'仅提示',value:'warn'}]" class="w-28" />
              <UInput v-model="c.alternative" maxlength="300" placeholder="改用什么" class="w-44" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="t.contraindications.splice(ci, 1)" />
            </div>
            <UButton class="mt-2" size="xs" variant="soft" icon="i-lucide-plus"
              @click="t.contraindications.push({ condition: '', type: 'warn', description: '', alternative: '' })">加一条</UButton>
          </UFormField>
          <UButton class="mt-2" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="form.tools.splice(ti, 1)">删除工具</UButton>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addTool">加一个工具</UButton>
      </div>

      <!-- 8 关键词 -->
      <div v-else-if="step.key === 'keywords'" class="mt-5 space-y-3">
        <UAlert color="neutral" variant="soft" title="这一步可以跳过"
          description="填了的话，老师在对话里说到这些词时，系统会直接引导他进这个模块。" />
        <div v-for="(k, ki) in (form.keywords as any[])" :key="ki" class="rounded-lg border border-slate-200 p-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="核心词" hint="回车分隔"><UInputTags v-model="k.core" class="w-full" /></UFormField>
            <UFormField label="近义说法"><UInputTags v-model="k.expanded" class="w-full" /></UFormField>
            <UFormField label="排除词" hint="说到这些词时不触发"><UInputTags v-model="k.exclude" class="w-full" /></UFormField>
            <UFormField label="匹配模式" hint="危机词建议用精确匹配"><USelect v-model="k.matchMode" :items="matchModeOptions" class="w-full" /></UFormField>
            <UFormField label="命中后建议做哪张量表"><USelect v-model="k.scale" :items="scaleNames" class="w-full" /></UFormField>
            <UFormField label="命中后推荐哪个工具"><USelect v-model="k.tool" :items="toolNames" class="w-full" /></UFormField>
            <UFormField label="风险等级">
              <USelect v-model="k.risk" :items="[{label:'红·立即',value:'red'},{label:'橙·尽快',value:'orange'},{label:'黄·关注',value:'yellow'},{label:'无·普通',value:'none'}]" class="w-full" />
            </UFormField>
            <UFormField label="语义分类" hint="最多 60 字"><UInput v-model="k.category" maxlength="60" placeholder="如：情绪耗竭" class="w-full" /></UFormField>
            <UFormField label="情境限定" hint="什么场景下这条路由生效（最多 120 字）"><UInput v-model="k.contextConstraint" maxlength="120" placeholder="如：教师自述状态时" class="w-full" /></UFormField>
            <UFormField label="场景描述" hint="最多 200 字"><UInput v-model="k.description" maxlength="200" class="w-full" /></UFormField>
          </div>
          <UButton class="mt-2" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="form.keywords.splice(ki, 1)">删除</UButton>
        </div>
        <UButton variant="soft" icon="i-lucide-plus" @click="addKeyword">加一组关键词</UButton>
      </div>

      <!-- 9 确认 -->
      <div v-else class="mt-5 space-y-4">
        <UButton icon="i-lucide-shield-check" :loading="pending" @click="runPreview">检查并生成</UButton>

        <template v-if="preview">
          <!-- 回读稿：业务只需要读懂这一段 -->
          <div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
            <h3 class="font-semibold text-emerald-800">系统将会这样判断 —— 请确认理解没跑偏</h3>
            <p class="mt-1 text-xs text-emerald-700">这是把你刚才填的内容翻译成人话。看着不对就回到对应步骤改。</p>
            <pre class="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{{ preview.readback.join('\n') }}</pre>
          </div>

          <!-- ⑪ 全链路推演：代入试算 -->
          <div v-if="(form.scales as any[]).some((s: any) => s.name)" class="rounded-lg border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-700">代入试算 —— 把维度拉到某个强度，看系统会怎么判</h3>
                <p class="mt-0.5 text-xs text-slate-400">模拟一位老师作答后的判定结果，走的是和线上完全相同的规则引擎。</p>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-slate-400">一键预设：</span>
                <UButton size="xs" variant="soft" @click="setSimPreset(1)">全部低分 1</UButton>
                <UButton size="xs" variant="soft" @click="setSimPreset(3)">全部正常 3</UButton>
                <UButton size="xs" variant="soft" @click="setSimPreset(5)">全部高分 5</UButton>
              </div>
            </div>
            <div class="mt-3 space-y-3">
              <div v-for="(s, si) in (form.scales as any[]).filter((s: any) => s.name)" :key="si"
                class="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-sm font-medium text-slate-700">{{ s.name }}</p>
                  <p v-if="simResult[s.name]" class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700"
                      :class="simResult[s.name].redLine ? '!bg-red-100 !text-red-700' : ''">
                      {{ simResult[s.name].redLine ? '红线熔断 · ' : '判为：' }}{{ simResult[s.name].levelName }}
                    </span>
                    <span v-if="simResult[s.name].primaryAttribution" class="text-slate-500">
                      主要归因：{{ simResult[s.name].primaryAttribution }}
                    </span>
                    <span v-if="simResult[s.name].toolTags?.length" class="text-slate-400">
                      推荐工具标签：{{ simResult[s.name].toolTags.join('、') }}
                    </span>
                  </p>
                  <span v-if="simRunning" class="text-xs text-slate-400">计算中…</span>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div v-for="dim in simDimensionsOf(s.name)" :key="dim" class="flex items-center gap-2">
                    <span class="text-xs text-slate-500">{{ dim }}</span>
                    <div class="flex overflow-hidden rounded-md border border-slate-200">
                      <button v-for="v in [1, 2, 3, 4, 5]" :key="v" type="button"
                        class="h-6 w-6 text-[11px] transition"
                        :class="simAnswers[s.name]?.[dim] === v ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'"
                        @click="setSimValue(s.name, dim, v)">{{ v }}</button>
                    </div>
                  </div>
                  <div v-if="!simDimensionsOf(s.name).length" class="text-xs text-slate-400">这张量表还没有题目，无法试算</div>
                </div>
                <details class="group mt-2 rounded-lg border border-slate-200 bg-white/70">
                  <summary class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-500">
                    逐题调整（可选）—— 单独改某道题的选项，可验证「第 N 题」这类条件
                    <UIcon name="i-lucide-chevron-down" class="size-3 transition group-open:rotate-180" />
                  </summary>
                  <div class="space-y-2 px-3 py-2">
                    <div v-for="(q, qi) in (s.questions as any[])" :key="qi" class="flex flex-wrap items-center gap-2">
                      <span class="w-14 shrink-0 text-[11px] text-slate-400">第 {{ qi + 1 }} 题</span>
                      <div class="flex flex-wrap gap-1">
                        <button v-for="opt in simOptionsOf(q)" :key="opt.value" type="button"
                          class="rounded border px-2 py-0.5 text-[11px] transition"
                          :class="simPerQuestion[s.name]?.[`q${qi + 1}`] === opt.value
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'"
                          @click="setSimQuestionValue(s.name, `q${qi + 1}`, opt.value)">{{ opt.label }}</button>
                      </div>
                      <button v-if="simPerQuestion[s.name]?.[`q${qi + 1}`] !== undefined" type="button"
                        class="text-[11px] text-slate-400 hover:text-slate-600"
                        @click="resetSimQuestionValue(s.name, `q${qi + 1}`)">恢复维度值</button>
                    </div>
                  </div>
                </details>
                <div v-if="simResult[s.name]?.redLine" class="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  红线触发：{{ simResult[s.name].redLineAction || '按模块设置执行熔断动作' }}
                </div>
                <div v-if="simResult[s.name]?.trigger" class="mt-2 text-xs"
                  :class="simResult[s.name].trigger.met ? 'text-emerald-700' : 'text-slate-400'">
                  建议做：{{ simResult[s.name].trigger.met ? '满足（按前面量表的作答，这张需要做）' : '不满足（按前面量表的作答，暂不需要做）' }}
                  <span v-if="simResult[s.name].trigger.error" class="text-amber-600">（触发条件求值失败：{{ simResult[s.name].trigger.error }}）</span>
                </div>
                <div v-if="simResult[s.name]?.unavailableVariables?.length" class="mt-2 text-xs text-amber-600">
                  计算变量算不出（引用了其他量表的数据）：{{ simResult[s.name].unavailableVariables.join('、') }}
                </div>
                <div v-if="Object.keys(simResult[s.name]?.computedValues || {}).length" class="mt-2 text-xs text-slate-400">
                  计算变量：{{ Object.entries(simResult[s.name].computedValues).map(([k, v]: any) => `${k} = ${v}`).join('、') }}
                </div>
                <div v-if="simResult[s.name]?.missingAnswerScales?.length" class="mt-2 text-xs text-amber-600">
                  以下计算变量引用的量表还没作答：{{ simResult[s.name].missingAnswerScales.join('、') }}（给对应量表设定作答后即可算出）
                </div>
                <div v-if="simResult[s.name]?.error" class="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
                  试算失败：{{ simResult[s.name].error }}
                </div>
                <div v-if="simResult[s.name]?.attributions?.length" class="mt-2 text-xs text-slate-400">
                  命中明细：{{ simResult[s.name].attributions.map((a: any) => `${a.name}（${Math.round(a.share * 100)}%）`).join('、') }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="preview.issues.length" class="rounded-lg border p-4"
            :class="preview.issues.some((i: any) => i.severity === 'error') ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'">
            <p class="text-sm font-semibold" :class="preview.issues.some((i: any) => i.severity === 'error') ? 'text-red-700' : 'text-amber-700'">需要处理</p>
            <p v-for="(i, idx) in preview.issues" :key="idx" class="mt-1.5 text-xs leading-5"
              :class="i.severity === 'error' ? 'text-red-700' : 'text-amber-700'">
              {{ i.severity === 'error' ? '必须改：' : '建议改：' }}{{ i.message }}
            </p>
          </div>

          <div class="rounded-lg border border-slate-200">
            <div v-for="lib in preview.results" :key="lib.libraryType"
              class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
              <div class="flex items-center gap-2">
                <UIcon :name="lib.ok ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
                  :class="lib.ok ? 'text-emerald-600' : 'text-red-600'" class="size-4" />
                <span class="text-sm font-medium">{{ lib.label }}</span>
                <span class="text-xs text-slate-400">
                  {{ Object.entries(lib.counts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') }}
                </span>
              </div>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-download" @click="download(lib)">下载</UButton>
              <p v-for="(e, idx) in lib.errors" :key="idx" class="w-full text-xs text-red-600">{{ e.message }}</p>
            </div>
          </div>

          <div v-if="preview.crossRef.issues.length" class="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p class="text-xs font-semibold text-amber-700">跨库检查</p>
            <p v-for="(i, idx) in preview.crossRef.issues" :key="idx" class="mt-1 text-xs text-amber-700">{{ i.message }}</p>
          </div>

          <div class="flex flex-wrap gap-3">
            <UButton :disabled="!preview.canImport" :loading="importing" icon="i-lucide-upload-cloud"
              @click="importAll(false)">导入为草稿</UButton>
            <UButton :disabled="!preview.canImport" :loading="importing" color="primary" variant="soft"
              icon="i-lucide-rocket" @click="importAll(true)">导入并发布</UButton>
            <UButton v-if="!preview.canImport" :loading="savingPending" color="warning" variant="soft"
              icon="i-lucide-save" @click="saveAsPendingReview">保存为待验证版本</UButton>
          </div>
          <p v-if="preview && !preview.canImport" class="text-xs leading-5 text-slate-500">
            检查没通过也可以先把内容「保存为待验证版本」留档：它不能发布，但随时可以通过右上角「载入现有内容」重新载入继续填写修改。
          </p>
        </template>
      </div>

      <div class="mt-6 flex justify-between border-t border-slate-100 pt-4">
        <UButton color="neutral" variant="soft" :disabled="stepIndex === 0" @click="() => { stepIndex-- }">上一步</UButton>
        <UButton v-if="stepIndex < STEPS.length - 1" :disabled="!canNext" @click="() => { stepIndex++ }">下一步</UButton>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

type PlanAction = {
  id: string; sequence: number; title: string; detail: string;
  decision: 'pending' | 'included' | 'rejected';
  decisionReason?: string | null; decisionNote?: string | null; decidedAt?: string | null;
  status: string; dueAt: string | null; completedAt: string | null;
  executedAt: string | null; executionNote: string | null;
  startedAt?: string | null; blockedAt?: string | null; blockReason?: string | null;
  blockNote?: string | null; evidenceType?: string | null; evidenceSummary?: string | null;
  teacherConfidence?: number | null;
  /** 深度诊断建议行动项：附带建议完成的量表编码，渲染「去完成」跳转 */
  suggestion?: { instrumentCode: string } | null;
  evidenceFiles?: Array<{
    id: string; kind: string; filename: string; mimeType: string; byteSize: number; createdAt: string;
  }>;
}

type RecommendationAudience = 'teacher' | 'student' | 'guardian' | 'school'
type RecommendationGroupDecision = 'pending' | 'included' | 'rejected' | 'mixed'
type RecommendationGroup = {
  key: RecommendationAudience
  audience: RecommendationAudience
  actions: PlanAction[]
  decision: RecommendationGroupDecision
}

const route = useRoute()
const id = String(route.params.id)
const { data, error: loadError, refresh } = await useFetch<any>(`/api/v1/plans/${id}`)
const pending = ref(false)
const actionPendingId = ref<string | null>(null)
const sourceExpanded = ref(true)
const expandedActionId = ref<string | null>(null)
const acceptancePending = ref(false)
const decisionPendingGroupKey = ref<RecommendationAudience | null>(null)
const rejectGroup = ref<RecommendationGroup | null>(null)
const rejectModalOpen = ref(false)
const addActionOpen = ref(false)
const addActionPending = ref(false)
const execEvidenceFiles = ref<File[]>([])
const evidencePending = ref(false)
const toast = useToast()

const acceptanceForm = reactive({
  reason: ''
})
const rejectForm = reactive({ reason: '', note: '' })
const addActionForm = reactive({ title: '', detail: '', dueAt: '' })

// 执行反馈表单状态
const execForm = reactive({
  executedAt: '',
  executionNote: '',
  blockReason: '',
  blockNote: '',
  evidenceType: 'none',
  evidenceSummary: '',
  teacherConfidence: 3,
})

const reviewForm = reactive({
  effectScore: 3,
  progressNote: '',
  nextAction: '',
  decision: 'continue_plan',
  completedActionIds: [] as string[],
})
const feedbackForm = reactive({
  attributionAccuracy: 3,
  toolUsability: 3,
  scriptNaturalness: 3,
  actionDifficulty: 3,
  tags: [] as string[],
  note: '',
})
const feedbackPending = ref(false)
const feedbackTags = ['归因准确', '工具可用', '话术自然', '行动过难', '需要人工协同', '场景不匹配']
const blockReasonOptions = [
  { label: '时间不足', value: 'time_limited' },
  { label: '学生暂不可用', value: 'student_unavailable' },
  { label: '家长不配合', value: 'guardian_uncooperative' },
  { label: '工具不适用', value: 'tool_not_applicable' },
  { label: '行动过难', value: 'action_too_hard' },
  { label: '风险升级', value: 'risk_escalated' },
  { label: '需要协同', value: 'need_collaboration' },
  { label: '其他', value: 'other' }
]
const rejectReasonOptions = [
  { label: '模糊、不够具体', value: 'vague' },
  { label: '场景不适配', value: 'scene_mismatch' },
  { label: '话术不自然', value: 'unnatural_script' },
  { label: '不实际、行动过难', value: 'impractical_or_hard' },
  { label: '其他原因', value: 'other' }
]
const reviewDecisionOptions = [
  { label: '继续原方案', value: 'continue_plan' },
  { label: '调整动作', value: 'adjust_actions' },
  { label: '需要协同', value: 'need_collaboration' },
  { label: '目标达成并关闭', value: 'close_success' },
  { label: '场景变化关闭', value: 'close_no_longer_needed' }
]

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

/** 量表名称：优先取方案快照中的名称（历史迁移可能有 name=code 的回填），否则显示编码。 */
function instrumentName(code?: string) {
  const snap = (data.value?.instrumentSnapshots || []).find((item: { code: string }) => item.code === code)
  return snap?.name || code || '-'
}

/**
 * 按严重度取色，不能按等级码取色：等级码是业务在 ⑤e 自定义的
 * （green / L1 / LP2 / norming…），映射表里一个都对不上，徽章会恒为灰。
 * severity 是 low/medium/high/crisis 固定枚举，才是稳定的取色依据。
 */
function riskVariant(severity?: string): 'error' | 'warning' | 'success' | 'neutral' {
  const map: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
    crisis: 'error', high: 'error', medium: 'warning', low: 'success',
  }
  return map[severity || ''] || 'neutral'
}

function statusText(status: string) {
  const map: Record<string, string> = {
    pending_acceptance: '待确认',
    accepted: '已接受',
    in_progress: '进行中',
    review_due: '待复盘',
    adjustment_needed: '需调整',
    escalated: '需协同',
    completed: '已完成',
    closed: '已关闭',
    archived: '已归档'
  }
  return map[status] || status
}

function statusVariant(status: string): 'info' | 'success' | 'neutral' | 'warning' | 'error' {
  const map: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'error'> = {
    pending_acceptance: 'warning',
    accepted: 'info',
    in_progress: 'info',
    review_due: 'warning',
    adjustment_needed: 'warning',
    escalated: 'error',
    completed: 'success',
    closed: 'neutral',
    archived: 'neutral',
  }
  return map[status] || 'neutral'
}

function actionStatusText(status: string) {
  const map: Record<string, string> = {
    pending: '未开始',
    in_progress: '进行中',
    completed: '已完成',
    blocked: '受阻',
    skipped: '已跳过',
    cancelled: '已取消'
  }
  return map[status] || status
}

/** 工具动作由工具库匹配生成，正文是完整结构化步骤；建议区标题独占一行展开步骤，执行区同样展示正文。 */
function isToolAction(action: PlanAction) {
  return action.title.startsWith('使用工具「')
}

const activeActions = computed<PlanAction[]>(() => {
  return data.value?.actions || []
})

const executableActions = computed(() =>
  activeActions.value.filter(action => action.decision === 'included')
)

const completedActionCount = computed(() =>
  executableActions.value.filter(a => a.status === 'completed').length
)
const needsAcceptance = computed(() => data.value?.status === 'pending_acceptance'
  || (data.value?.status === 'adjustment_needed' && !data.value?.acceptedAt))
const canExecute = computed(() => ['accepted', 'in_progress', 'review_due'].includes(data.value?.status)
  || (['adjustment_needed', 'escalated'].includes(data.value?.status) && Boolean(data.value?.acceptedAt)))
const canReview = computed(() => canExecute.value)
/** 需协同状态：行动项只读展示（服务端禁止更新行动），等待学校处理 */
const planIsEscalated = computed(() => data.value?.status === 'escalated' && Boolean(data.value?.acceptedAt))
const showReviewForm = computed(() => canReview.value && (
  data.value?.status === 'review_due'
  || Boolean(data.value?.reviews?.length)
  || executableActions.value.some(action => ['in_progress', 'completed', 'blocked', 'skipped'].includes(action.status))
))
const report = computed(() => data.value?.report || {})
const planStructure = computed(() => report.value?.planStructure || {})
/** 归因构成。优先取报告里的，旧方案快照没有时回退到 planStructure.attribution.items。 */
const attributions = computed<Array<{ name: string, strength: 'primary' | 'secondary' | 'reference', description?: string, reasons?: string[] }>>(() =>
  report.value?.attributions?.length ? report.value.attributions : (planStructure.value?.attribution?.items || [])
)
/** 深度诊断建议（待办行动）：由服务端按该模块量表触发条件动态计算，完成对应量表后自动消失。 */
const nextInstrumentSuggestion = computed<{ code: string, title: string, note: string | null } | null>(() =>
  data.value?.nextInstrumentSuggestion || null
)
/** 只呈现强弱分组，不呈现占比小数——占比是规则匹配强度，不是测量精度。 */
function attributionStrengthLabel(strength: 'primary' | 'secondary' | 'reference') {
  return { primary: '主要', secondary: '次要', reference: '参考' }[strength] || '参考'
}

/**
 * 行动项分组：按「谁执行」划分，而不是「内容关于谁」。
 * 工具名能直接点明执行对象的场景（家长会/学生自评/学校流程…）优先用标题信号；
 * 标题无信号时看正文。家校模块正文几乎必提「家长」且多数是教师与家长的沟通对象，
 * 只有「家长」后接执行性表述（签署/承诺/每日/定期/配合…）才判为家长配合。
 * 最后用模块业务白名单过滤：白名单之外的判定一律回落教师行动。
 */
function recommendationAudience(action: PlanAction, module?: string): RecommendationAudience {
  const title = action.title
  const titleAudience: RecommendationAudience | null =
    /学校|校方|德育|心理专员/.test(title) ? 'school'
      : /家长|父母|亲子|家庭|家校|监护人/.test(title) ? 'guardian'
        : /学生|孩子|同伴|班委|课堂|作业|学习/.test(title) ? 'student'
          : null
  let guess: RecommendationAudience
  if (titleAudience) {
    guess = titleAudience
  } else {
    const text = `${title} ${action.detail}`
    if (module === 'home_school') {
      if (/学校|年级组|德育|心理专员|校方|校内协同|管理层/.test(text)) guess = 'school'
      else if (/家长(签署|承诺|每天|每日|每周|定期|需要|应该|应当|配合|完成|练习|反馈|填写|承担|打卡)/.test(text)) guess = 'guardian'
      else guess = 'teacher'
    } else {
      if (/学校|年级组|德育|心理专员|校方|校内协同|管理层/.test(text)) guess = 'school'
      else if (/家长|父母|家庭|家校|监护人/.test(text)) guess = 'guardian'
      else if (/学生|孩子|小组|同伴|班委|课堂|作业|学习/.test(text)) guess = 'student'
      else guess = 'teacher'
    }
  }
  const allowed = (moduleMeta as Record<string, { planAudiences?: RecommendationAudience[] }>)[module || '']?.planAudiences
  if (allowed && !allowed.includes(guess)) return 'teacher'
  return guess
}

function recommendationMeta(audience: RecommendationAudience) {
  const studentName = data.value?.student?.name || '学生'
  const map = {
    teacher: { title: '教师行动计划', executor: '负责教师', icon: 'i-lucide-user-round' },
    student: { title: '学生行动计划（学生辅导技术与学习/生活落地方案）', executor: `${studentName}、负责教师`, icon: 'i-lucide-graduation-cap' },
    guardian: { title: '家长配合部分', executor: '家长配合；由负责教师发起沟通并跟进', icon: 'i-lucide-house' },
    school: { title: '学校配合部分', executor: '学校相关人员协同；由负责教师发起申请并跟进', icon: 'i-lucide-school' }
  } as const
  return map[audience]
}

function recommendationGroupPeriod(group: RecommendationGroup) {
  const dates = group.actions
    .map(action => action.dueAt ? new Date(action.dueAt) : null)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())
  if (!dates.length) return '接受方案后协商确定'
  const start = dates[0]!
  const end = dates[dates.length - 1]!
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
  return `${days}天（${start.toLocaleDateString('zh-CN')} ～ ${end.toLocaleDateString('zh-CN')}）`
}

/** 方案块内动作标题用中文序号，与工具步骤的阿拉伯序号区分层级 */
const CN_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function recommendationImplementation(group: RecommendationGroup) {
  return group.actions
    .map((action, index) => {
      const numbered = group.actions.length > 1
      const ordinal = CN_ORDINALS[index] || String(index + 1)
      const head = numbered ? `${ordinal}、${action.title}` : action.title
      if (!action.detail) return head
      // 工具动作的正文是结构化步骤（自带序号），标题独占一行，步骤换行展开
      if (isToolAction(action)) return `${head}\n${action.detail}`
      return numbered ? `${head}：${action.detail}` : action.detail
    })
    .join('\n\n')
}

function recommendationGroupOutcome() {
  return supportGoal.value.observableChange
}
const supportGoal = computed(() => report.value?.supportGoal || {
  weeklyGoal: planStructure.value?.summary || data.value?.summary || '围绕当前问题先完成一个可观察、可复盘的小目标。',
  observableChange: report.value?.sevenDayFollowUp?.observationPoints?.[0] || '一周内能观察到行为、沟通或状态上的具体变化。',
  avoidGoal: '不要把目标设成一次性解决所有问题。'
})

const recommendationGroups = computed<RecommendationGroup[]>(() => {
  const byAudience = new Map<RecommendationAudience, PlanAction[]>()
  for (const action of activeActions.value) {
    const audience = recommendationAudience(action, data.value?.module)
    byAudience.set(audience, [...(byAudience.get(audience) || []), action])
  }
  const order: RecommendationAudience[] = ['student', 'guardian', 'school', 'teacher']
  return order.flatMap((audience) => {
    const actions = byAudience.get(audience) || []
    if (!actions.length) return []
    const decisions = new Set(actions.map(action => action.decision))
    const decision: RecommendationGroupDecision = decisions.size === 1
      ? (actions[0]!.decision || 'pending')
      : 'mixed'
    return [{ key: audience, audience, actions, decision }]
  })
})

const pendingRecommendationCount = computed(() =>
  recommendationGroups.value.filter(group => ['pending', 'mixed'].includes(group.decision)).length
)
const includedRecommendationCount = computed(() =>
  recommendationGroups.value.filter(group => group.decision === 'included').length
)
const rejectedRecommendationCount = computed(() =>
  recommendationGroups.value.filter(group => group.decision === 'rejected').length
)

function rejectReasonLabel(reason?: string | null) {
  return rejectReasonOptions.find(item => item.value === reason)?.label || reason || '未填写'
}

/** 方案块内是否存在深度诊断建议行动项（供「去完成」跳转） */
function groupSuggestion(group: RecommendationGroup) {
  return group.actions.find(action => action.suggestion)?.suggestion || null
}

function recommendationRejectSummary(group: RecommendationGroup) {
  const summaries = group.actions.map((action) => {
    const reason = rejectReasonLabel(action.decisionReason)
    return action.decisionNote ? `${reason}：${action.decisionNote}` : reason
  })
  return [...new Set(summaries)].join('；')
}

// 展开/折叠某个动作的反馈区域
function toggleExpand(actionId: string) {
  const action = activeActions.value.find(a => a.id === actionId)
  if (!action || action.status === 'completed') {
    expandedActionId.value = expandedActionId.value === actionId ? null : actionId
    return
  }
  // 展开未完成的动作时，初始化反馈表单
  if (expandedActionId.value !== actionId) {
    expandedActionId.value = actionId
    execForm.executedAt = new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    execForm.executionNote = ''
    execForm.blockReason = ''
    execForm.blockNote = ''
    execForm.evidenceType = 'none'
    execForm.evidenceSummary = ''
    execForm.teacherConfidence = 3
    execEvidenceFiles.value = []
  } else {
    expandedActionId.value = null
  }
}

async function updateAcceptance(decision: 'accepted' | 'deferred' | 'not_applicable') {
  if (!data.value) return
  acceptancePending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/acceptance`, {
      method: 'PATCH',
      body: {
        decision,
        reason: decision === 'accepted' ? undefined : acceptanceForm.reason.trim()
      }
    })
    acceptanceForm.reason = ''
    await refresh()
  } finally {
    acceptancePending.value = false
  }
}

async function saveRecommendationGroupDecision(group: RecommendationGroup, decision: 'included' | 'rejected', input?: { reason?: string, note?: string }) {
  decisionPendingGroupKey.value = group.key
  try {
    for (const action of group.actions) {
      await $fetch(`/api/v1/plans/${data.value!.id}/actions/${action.id}/decision`, {
        method: 'PATCH',
        body: {
          decision,
          reason: decision === 'rejected' ? input?.reason : undefined,
          note: decision === 'rejected' ? input?.note?.trim() || undefined : undefined
        }
      })
    }
    await refresh()
  } catch (error: any) {
    await refresh()
    toast.add({
      title: '方案确认状态保存失败',
      description: error?.data?.message || error?.message || '请稍后重试',
      color: 'error'
    })
    throw error
  } finally {
    decisionPendingGroupKey.value = null
  }
}

function openRejectModal(group: RecommendationGroup) {
  rejectGroup.value = group
  const firstRejected = group.actions.find(action => action.decision === 'rejected')
  rejectForm.reason = firstRejected?.decisionReason || ''
  rejectForm.note = firstRejected?.decisionNote || ''
  rejectModalOpen.value = true
}

async function submitRecommendationRejection() {
  if (!rejectGroup.value) return
  await saveRecommendationGroupDecision(rejectGroup.value, 'rejected', rejectForm)
  rejectModalOpen.value = false
  rejectGroup.value = null
  Object.assign(rejectForm, { reason: '', note: '' })
}

async function finalizeRecommendations() {
  if (pendingRecommendationCount.value > 0) return
  if (includedRecommendationCount.value > 0) {
    await updateAcceptance('accepted')
    return
  }
  acceptanceForm.reason = '所有行动方案建议均暂不接受'
  await updateAcceptance('deferred')
}

async function updateActionStatus(actionId: string, status: string, extra: Record<string, unknown> = {}) {
  actionPendingId.value = actionId
  try {
    await $fetch(`/api/v1/plans/${data.value!.id}/actions`, {
      method: 'PATCH',
      body: { actionId, status, ...extra },
    })
    expandedActionId.value = null
    await refresh()
  } finally {
    actionPendingId.value = null
  }
}

async function createAction() {
  if (!data.value) return
  addActionPending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/actions`, {
      method: 'POST',
      body: {
        title: addActionForm.title.trim(),
        detail: addActionForm.detail.trim(),
        dueAt: addActionForm.dueAt ? new Date(addActionForm.dueAt).toISOString() : undefined
      }
    })
    Object.assign(addActionForm, { title: '', detail: '', dueAt: '' })
    addActionOpen.value = false
    await refresh()
  } finally {
    addActionPending.value = false
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

function onEvidenceFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files || [])]
  const accepted = selected.filter(file => {
    const max = file.type.startsWith('image/') ? 5 * 1024 * 1024 : 15 * 1024 * 1024
    return ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(file.type) && file.size <= max
  }).slice(0, 5)
  if (accepted.length !== selected.length) {
    toast.add({ title: '部分文件未加入', description: '支持 JPG、PNG、WebP（5 MB）和 MP4、WebM（15 MB），每次最多 5 个。', color: 'warning' })
  }
  execEvidenceFiles.value = accepted
}

async function uploadEvidence(actionId: string) {
  while (execEvidenceFiles.value.length) {
    const file = execEvidenceFiles.value[0]!
    await $fetch(`/api/v1/plans/${data.value!.id}/actions/${actionId}/evidence`, {
      method: 'POST',
      body: { filename: file.name, mimeType: file.type, contentBase64: await fileToBase64(file) }
    })
    execEvidenceFiles.value = execEvidenceFiles.value.slice(1)
  }
}

function evidenceUrl(actionId: string, evidenceId: string) {
  return `/api/v1/plans/${data.value!.id}/actions/${actionId}/evidence/${evidenceId}`
}

async function deleteEvidence(actionId: string, evidenceId: string) {
  if (!window.confirm('确定删除这份执行证据吗？删除后文件内容不可恢复。')) return
  await $fetch(evidenceUrl(actionId, evidenceId), { method: 'DELETE' })
  await refresh()
}

// 提交执行反馈并标记完成
async function submitExecution(actionId: string) {
  evidencePending.value = true
  try {
    const hasVideoEvidence = execEvidenceFiles.value.some(file => file.type.startsWith('video/'))
    if (execEvidenceFiles.value.length) await uploadEvidence(actionId)
    await updateActionStatus(actionId, 'completed', {
      executedAt: execForm.executedAt ? new Date(execForm.executedAt).toISOString() : undefined,
      executionNote: execForm.executionNote.trim() || undefined,
      evidenceType: hasVideoEvidence ? 'artifact' : execForm.evidenceType,
      evidenceSummary: execForm.evidenceSummary.trim() || undefined,
      teacherConfidence: Number(execForm.teacherConfidence)
    })
  } catch (error: any) {
    await refresh()
    toast.add({ title: '执行记录未完整保存', description: error?.data?.message || error?.message || '请稍后重试', color: 'error' })
  } finally {
    evidencePending.value = false
  }
}

async function submitBlocked(actionId: string) {
  await updateActionStatus(actionId, 'blocked', {
    blockReason: execForm.blockReason,
    blockNote: execForm.blockNote.trim() || undefined,
    evidenceType: execForm.evidenceType,
    evidenceSummary: execForm.evidenceSummary.trim() || undefined,
    teacherConfidence: Number(execForm.teacherConfidence)
  })
}

// 简单 toggle（撤销完成或标记未完成时直接切换）
async function toggleAction(actionId: string, currentStatus: string) {
  const next = currentStatus === 'completed' ? 'pending' : 'completed'

  // 标记完成 → 展开反馈表单，由 submitExecution 完成提交
  if (next === 'completed') {
    toggleExpand(actionId)
    return
  }

  await updateActionStatus(actionId, next)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatInputDate(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 16) // YYYY-MM-DDTHH:mm
}

function scoreOutOfFive(value: unknown) {
  const score = Number(value)
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : '-'
}

function exportPdf() {
  const previousTitle = document.title
  document.title = `${data.value?.title || '方案报告'}.pdf`
  window.print()
  window.setTimeout(() => { document.title = previousTitle }, 500)
}

async function createReview() {
  if (!data.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/reviews`, {
      method: 'POST',
      body: {
        effectScore: Number(reviewForm.effectScore),
        progressNote: reviewForm.progressNote,
        nextAction: reviewForm.nextAction,
        decision: reviewForm.decision,
        completedActionIds:
          reviewForm.completedActionIds.length ? reviewForm.completedActionIds : undefined,
      },
    })
    Object.assign(reviewForm, {
      effectScore: 3, progressNote: '', nextAction: '', decision: 'continue_plan', completedActionIds: [],
    })
    await refresh()
  } finally {
    pending.value = false
  }
}

async function submitFeedback() {
  if (!data.value) return
  feedbackPending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/feedback`, {
      method: 'POST',
      body: {
        attributionAccuracy: Number(feedbackForm.attributionAccuracy),
        toolUsability: Number(feedbackForm.toolUsability),
        scriptNaturalness: Number(feedbackForm.scriptNaturalness),
        actionDifficulty: Number(feedbackForm.actionDifficulty),
        tags: feedbackForm.tags,
        note: feedbackForm.note.trim() || undefined,
      },
    })
    Object.assign(feedbackForm, {
      attributionAccuracy: 3,
      toolUsability: 3,
      scriptNaturalness: 3,
      actionDifficulty: 3,
      tags: [],
      note: '',
    })
    await refresh()
  } finally {
    feedbackPending.value = false
  }
}

function toggleFeedbackTag(tag: string, checked: boolean | string) {
  if (checked) {
    if (!feedbackForm.tags.includes(tag)) feedbackForm.tags.push(tag)
  } else {
    feedbackForm.tags = feedbackForm.tags.filter(item => item !== tag)
  }
}

useHead({ title: () => data.value?.title || '方案详情' })
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 py-10">
    <!-- 返回 -->
    <div class="mb-6 flex items-center justify-between gap-3 print:hidden">
      <UButton to="/plans" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">返回方案列表</UButton>
      <UButton color="neutral" variant="soft" icon="i-lucide-file-down" size="sm" @click="exportPdf">下载 PDF</UButton>
    </div>

    <!-- 失败态。之前这里没有分支，拉取失败时 data 恒为 null，页面会永远转圈。 -->
    <UAlert
      v-if="loadError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="方案加载失败"
      :description="(loadError as any)?.data?.message || '请检查网络后重试；若方案已被删除，请返回方案列表。'"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" @click="() => refresh()">重试</UButton>
        <UButton size="xs" color="neutral" variant="ghost" to="/plans">返回列表</UButton>
      </template>
    </UAlert>

    <!-- 加载态 -->
    <div
      v-else-if="!data"
      class="grid min-h-64 place-items-center text-sm text-slate-400"
    >
      <div class="text-center">
        <UIcon name="i-lucide-loader" class="mx-auto mb-3 size-8 animate-spin" />
        <p>加载中...</p>
      </div>
    </div>

    <div v-else class="flex flex-col gap-6">
      <!-- ══════════ 1. 头部 ══════════ -->
      <section class="order-1 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-xl font-semibold text-slate-900">{{ data.title }}</h1>
            <p v-if="(data.attributionKeywords?.length)" class="mt-1 break-words text-xs text-slate-400">
              归因关键词：{{ (data.attributionKeywords || []).join('、') }}
            </p>
            <p v-if="(data.instrumentSnapshots?.length)" class="mt-1 break-words text-xs text-slate-400">
              测评量表：{{ (data.instrumentSnapshots || []).map((item: { name?: string; code?: string }) => item.name || item.code).join('、') }}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span v-if="data.student">
                <span class="text-slate-400">学生</span>
                {{ data.student.name }}
                <span v-if="data.student.gender" class="text-slate-400">({{ data.student.gender }})</span>
              </span>
              <span v-if="data.class">
                <span class="text-slate-400">班级</span>
                {{ data.class.name }}
                <template v-if="data.class.grade">({{ data.class.grade }}年级)</template>
              </span>
              <span class="text-slate-400">{{ moduleTitle(data.module) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :color="riskVariant(data.report?.risk?.severity)"
              variant="soft"
              size="md"
            >
              {{ data.report?.risk?.label || data.report?.risk?.level || '未知' }}
            </UBadge>
            <UBadge :color="statusVariant(data.status)" variant="soft" size="md">
              {{ statusText(data.status) }}
            </UBadge>
          </div>
        </div>
      </section>

      <!-- ══════════ 2. 来源对话卡片（仅 AI 来源展示） ══════════ -->
      <section
        v-if="data.sourceConversation"
        class="order-3 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-message-circle" class="size-4 text-emerald-600" />
            <h3 class="font-semibold text-slate-800">我与助手的对话</h3>
          </div>
          <a
            :href="`/?sessionId=${data.sourceConversation.sessionId}`"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition hover:text-emerald-900"
          >
            查看完整对话
            <UIcon name="i-lucide-external-link" class="size-3.5" />
          </a>
        </div>
        <p v-if="data.sourceConversation.questionSummary" class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
          {{ data.sourceConversation.questionSummary }}
        </p>
        <p class="mt-1 text-xs text-slate-400">
          {{ new Date(data.sourceConversation.createdAt).toLocaleString('zh-CN') }}
        </p>
      </section>

      <!-- ══════════ 3. 来源评估卡片（多量表按提交顺序） ══════════ -->
      <section
        v-if="data.assessments?.length"
        class="order-4 rounded-2xl border border-slate-200 bg-white"
      >
        <button
          class="flex w-full items-center justify-between p-5 text-left font-semibold text-slate-800"
          @click="sourceExpanded = !sourceExpanded"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-clipboard-check" class="size-4 text-emerald-600" />
            测评量表（{{ data.assessments.length }} 份，按测试顺序）
          </span>
          <UIcon
            :name="sourceExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-slate-400"
          />
        </button>
        <div v-if="sourceExpanded" class="space-y-3 border-t border-slate-100 px-5 pb-5 pt-4">
          <div
            v-for="(assessment, index) in data.assessments"
            :key="assessment.attemptId"
            class="grid gap-3 rounded-xl border border-slate-100 p-3 text-sm md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div class="grid size-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {{ Number(index) + 1 }}
            </div>
            <div>
              <span class="text-slate-400">评估模块</span>
              <p class="mt-1 font-medium">{{ moduleTitle(assessment.module) }}</p>
            </div>
            <div>
              <span class="text-slate-400">量表</span>
              <p class="mt-1 font-medium">{{ instrumentName(assessment.code) }}</p>
            </div>
            <div>
              <span class="text-slate-400">结果</span>
              <p class="mt-1 font-medium">
                {{ assessment.result?.levelName || assessment.result?.report?.risk?.label || assessment.result?.report?.profile?.title || '-' }}
              </p>
            </div>
            <div>
              <span class="text-slate-400">提交时间</span>
              <p class="mt-1 font-medium">
                {{ assessment.submittedAt
                  ? new Date(assessment.submittedAt).toLocaleString('zh-CN')
                  : '-' }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ══════════ 4. 方案执行表单（跟踪动作 + 反馈） ══════════
           待确认/需调整时只展示报告与接受决策，接受后才进入执行态。 -->
      <section
        v-if="canExecute"
        class="order-8 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold text-slate-800">
            <UIcon name="i-lucide-list-checks" class="size-4 text-indigo-600" />
            方案执行
          </h3>
          <div class="flex items-center gap-2">
            <span v-if="executableActions.length" class="text-xs text-slate-400">{{ completedActionCount }}/{{ executableActions.length }} 项完成</span>
            <span v-else class="text-xs text-slate-400">尚未添加行动</span>
            <UButton icon="i-lucide-plus" size="xs" variant="soft" :disabled="planIsEscalated" @click="addActionOpen = true">新增行动</UButton>
          </div>
        </div>

        <UAlert
          v-if="planIsEscalated"
          color="warning"
          variant="soft"
          icon="i-lucide-life-buoy"
          title="方案已标记需协同"
          description="部分行动受阻原因涉及风险升级或需要学校协同，方案已进入协同处理状态；处理完成前行动项只读，可在下方查看行动进展，或填写复盘反馈。"
          class="mt-4"
        />

        <div v-if="!executableActions.length" class="mt-4 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">
          当前方案尚未生成跟踪动作，可点击“新增行动”补充一项可执行、可复盘的行动。
        </div>

        <div class="mt-4 space-y-2">
          <div
            v-for="action in executableActions"
            :key="action.id"
          >
            <!-- 动作主行 -->
            <div
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
              :class="[
                action.status === 'completed'
                  ? 'border-emerald-100 bg-emerald-50/50'
                  : 'border-slate-100 bg-white hover:border-slate-200',
                actionPendingId === action.id ? 'pointer-events-none opacity-60' : '',
              ]"
              @click="toggleExpand(action.id)"
            >
              <UCheckbox
                :model-value="action.status === 'completed'"
                :disabled="actionPendingId === action.id || planIsEscalated"
                @click.stop
                @update:model-value="toggleAction(action.id, action.status)"
              />
              <div class="min-w-0 flex-1">
                <p
                  class="text-sm font-medium"
                  :class="action.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-800'"
                >
                  {{ action.title }}
                </p>
                <!-- 工具动作与普通动作一致展示正文（结构化步骤），与建议区排版同步 -->
                <p v-if="action.detail" class="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{{ action.detail }}</p>
                <!-- 截止日期 -->
                <p v-if="action.dueAt" class="mt-1 text-xs text-amber-600">
                  截止：{{ formatDate(action.dueAt) }}
                </p>
                <p v-if="action.blockReason" class="mt-1 text-xs text-red-600">
                  受阻原因：{{ blockReasonOptions.find(item => item.value === action.blockReason)?.label || action.blockReason }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <UBadge
                  :color="action.status === 'completed' ? 'success' : action.status === 'blocked' ? 'error' : action.status === 'in_progress' ? 'info' : action.status === 'skipped' ? 'neutral' : 'warning'"
                  variant="soft"
                  size="xs"
                >
                  {{ actionStatusText(action.status) }}
                </UBadge>
                <!-- 已完成且有反馈: 显示反馈摘要 -->
                <span
                  v-if="action.status === 'completed' && action.executionNote"
                  class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                >
                  已反馈
                </span>
                <!-- 已完成但无反馈: 提示可补充 -->
                <span
                  v-else-if="action.status === 'completed'"
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                >
                  未反馈
                </span>
                <UIcon
                  v-if="actionPendingId === action.id"
                  name="i-lucide-loader"
                  class="size-4 animate-spin text-slate-400"
                />
                <UIcon
                  v-else
                  :name="expandedActionId === action.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="size-4 text-slate-400"
                />
              </div>
            </div>

            <!-- 展开区域：执行反馈表单 或 已记录反馈 -->
            <div
              v-if="expandedActionId === action.id"
              class="-mt-px rounded-b-xl border border-t-0 border-slate-100 bg-slate-50 p-4"
            >
              <!-- 已完成/受阻/跳过动作 → 展示已记录的反馈 -->
              <template v-if="['completed', 'blocked', 'skipped'].includes(action.status)">
                <div class="grid gap-3 text-sm">
                  <div>
                    <span class="text-xs text-slate-400">状态</span>
                    <p class="mt-0.5 font-medium text-slate-700">{{ actionStatusText(action.status) }}</p>
                  </div>
                  <div v-if="action.executedAt">
                    <span class="text-xs text-slate-400">行动日期</span>
                    <p class="mt-0.5 font-medium text-slate-700">{{ formatDate(action.executedAt) }}</p>
                  </div>
                  <div v-if="action.blockReason">
                    <span class="text-xs text-slate-400">受阻原因</span>
                    <p class="mt-0.5 text-red-700">{{ blockReasonOptions.find(item => item.value === action.blockReason)?.label || action.blockReason }}</p>
                  </div>
                  <div v-if="action.blockNote">
                    <span class="text-xs text-slate-400">受阻说明</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.blockNote }}</p>
                  </div>
                  <div v-if="action.executionNote">
                    <span class="text-xs text-slate-400">行动结果</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.executionNote }}</p>
                  </div>
                  <div v-if="action.evidenceSummary">
                    <span class="text-xs text-slate-400">证据摘要</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.evidenceSummary }}</p>
                  </div>
                  <div v-if="action.evidenceFiles?.length">
                    <span class="text-xs text-slate-400">图片/视频证据</span>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <div v-for="file in action.evidenceFiles" :key="file.id" class="flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                        <UButton
                          :to="evidenceUrl(action.id, file.id)"
                          target="_blank"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          :icon="file.kind === 'video' ? 'i-lucide-video' : 'i-lucide-image'"
                          class="min-w-0 max-w-64"
                        >
                          <span class="truncate">{{ file.filename }}</span>
                        </UButton>
                        <UTooltip text="删除证据">
                          <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" square aria-label="删除证据" @click="deleteEvidence(action.id, file.id)" />
                        </UTooltip>
                      </div>
                    </div>
                  </div>
                  <div v-if="action.status === 'completed' && !action.executionNote">
                    <p class="text-xs text-amber-600">
                      <UIcon name="i-lucide-info" class="mr-1 inline size-3" />
                      尚未记录执行反馈，可点击勾选框撤销后重新标记完成。
                    </p>
                  </div>
                </div>
              </template>

              <!-- 需协同：行动只读，不提供反馈表单 -->
              <template v-else-if="planIsEscalated">
                <p class="rounded-lg bg-white p-3 text-xs leading-5 text-slate-500">
                  方案处于需协同状态，行动项暂不可操作；可等待学校处理结果，或在下方完成复盘。
                </p>
              </template>

              <!-- 未完成动作 → 反馈表单 -->
              <template v-else>
                <div class="grid gap-4 md:grid-cols-2">
                  <UFormField label="行动日期">
                    <UInput
                      v-model="execForm.executedAt"
                      type="datetime-local"
                      class="w-full"
                    />
                  </UFormField>
                  <div />
                </div>
                <UFormField class="mt-3" label="行动结果">
                  <UTextarea
                    v-model="execForm.executionNote"
                    :rows="2"
                    class="w-full"
                    placeholder="这次行动的具体执行情况和结果（如观察到的变化、遇到的困难等）"
                  />
                </UFormField>
                <div class="mt-3 grid gap-3 md:grid-cols-2">
                  <UFormField label="证据类型">
                    <USelect
                      v-model="execForm.evidenceType"
                      :items="[
                        { label: '无', value: 'none' },
                        { label: '观察记录', value: 'observation' },
                        { label: '沟通纪要', value: 'communication' },
                        { label: '执行产物', value: 'artifact' }
                      ]"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="把握度">
                    <USelect v-model="execForm.teacherConfidence" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v} / 5`, value: v }))" class="w-full" />
                  </UFormField>
                </div>
                <div v-if="action.evidenceFiles?.length" class="mt-3">
                  <span class="text-xs text-slate-500">已上传证据</span>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <div v-for="file in action.evidenceFiles" :key="file.id" class="flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                      <UButton
                        :to="evidenceUrl(action.id, file.id)"
                        target="_blank"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :icon="file.kind === 'video' ? 'i-lucide-video' : 'i-lucide-image'"
                        class="min-w-0 max-w-64"
                      >
                        <span class="truncate">{{ file.filename }}</span>
                      </UButton>
                      <UTooltip text="删除证据">
                        <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" square aria-label="删除证据" @click="deleteEvidence(action.id, file.id)" />
                      </UTooltip>
                    </div>
                  </div>
                </div>
                <UFormField class="mt-3" label="图片或视频证据">
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    class="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-emerald-700"
                    @change="onEvidenceFiles"
                  >
                  <template #hint>图片不超过 5 MB，视频不超过 15 MB；最多选择 5 个。</template>
                </UFormField>
                <div v-if="execEvidenceFiles.length" class="mt-2 flex flex-wrap gap-1.5">
                  <UBadge v-for="file in execEvidenceFiles" :key="`${file.name}-${file.size}`" color="neutral" variant="soft">
                    {{ file.name }} · {{ (file.size / 1024 / 1024).toFixed(1) }} MB
                  </UBadge>
                </div>
                <UFormField class="mt-3" label="证据摘要">
                  <UInput v-model="execForm.evidenceSummary" class="w-full" placeholder="例如：已完成一次观察记录；不要填写完整敏感正文" />
                </UFormField>
                <div class="mt-4 rounded-xl border border-red-100 bg-white p-3">
                  <div class="grid gap-3 md:grid-cols-[12rem_1fr]">
                    <UFormField label="受阻原因">
                      <USelect v-model="execForm.blockReason" :items="blockReasonOptions" class="w-full" />
                    </UFormField>
                    <UFormField label="受阻说明">
                      <UInput v-model="execForm.blockNote" class="w-full" placeholder="说明卡点，便于学校后台协同" />
                    </UFormField>
                  </div>
                  <div class="mt-3 flex justify-end">
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      :disabled="!execForm.blockReason || (execForm.blockReason === 'other' && execForm.blockNote.trim().length < 2)"
                      :loading="actionPendingId === action.id"
                      @click="submitBlocked(action.id)"
                    >
                      标记受阻
                    </UButton>
                  </div>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="() => { expandedActionId = null }"
                  >
                    取消
                  </UButton>
                  <UButton color="neutral" variant="soft" size="sm" :loading="actionPendingId === action.id" @click="updateActionStatus(action.id, 'skipped')">
                    跳过
                  </UButton>
                  <UButton
                    color="success"
                    size="sm"
                    :loading="actionPendingId === action.id || evidencePending"
                    @click="submitExecution(action.id)"
                  >
                    保存并标记完成
                  </UButton>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- ══════════ 4. 专业方案工作单 ══════════ -->
      <section v-if="data.report?.profile" class="order-5 rounded-2xl bg-slate-50 p-6">
        <p class="text-xs font-semibold text-emerald-700">问题画像</p>
        <h3 class="mt-1 text-lg font-semibold">{{ data.report.profile.title }}</h3>
        <p class="mt-3 text-sm leading-7 text-slate-600">{{ data.report.profile.summary }}</p>

        <div class="mt-5 rounded-xl border border-emerald-100 bg-white p-4">
          <p class="text-xs font-semibold text-emerald-700">归因构成</p>
          <!-- 有完整归因构成时按强弱分组呈现，否则回退到旧的主/次归因文本 -->
          <template v-if="attributions.length">
            <div v-for="attribution in attributions" :key="attribution.name" class="mt-2 flex items-start gap-2">
              <UBadge
                size="xs"
                :color="attribution.strength === 'primary' ? 'primary' : 'neutral'"
                :variant="attribution.strength === 'primary' ? 'solid' : 'soft'"
              >
                {{ attributionStrengthLabel(attribution.strength) }}
              </UBadge>
              <div class="min-w-0">
                <p class="text-sm leading-5" :class="attribution.strength === 'primary' ? 'font-semibold text-slate-800' : 'text-slate-600'">
                  {{ attribution.name }}
                </p>
                <p v-if="attribution.description" class="mt-0.5 text-xs leading-5 text-slate-500">{{ attribution.description }}</p>
                <p v-if="attribution.reasons?.length" class="mt-0.5 text-xs leading-5 text-slate-400">
                  证据：{{ attribution.reasons.join('；') }}
                </p>
              </div>
            </div>
          </template>
          <template v-else>
            <p class="mt-2 text-sm font-semibold text-slate-800">{{ planStructure?.attribution?.primary || data.report.profile.primaryConcern }}</p>
            <p v-if="planStructure?.attribution?.secondary?.length" class="mt-2 text-xs leading-5 text-slate-500">
              次归因：{{ planStructure.attribution.secondary.join('、') }}
            </p>
          </template>
        </div>

        <!-- 深度诊断建议（待办行动）：基于本次测量结果提示更深入诊断的可能性。
             服务端按触发条件动态计算，完成对应量表后自动消失。 -->
        <div v-if="nextInstrumentSuggestion" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold text-amber-700">待办 · 建议深度诊断</p>
              <p class="mt-1 text-sm font-medium text-slate-800">建议进一步完成「{{ nextInstrumentSuggestion.title }}」</p>
              <p class="mt-1 text-xs leading-5 text-slate-600">
                本建议基于本次测量结果生成；完成深度诊断后将获得更精确的归因判断，此待办会自动消除。
              </p>
              <p v-if="nextInstrumentSuggestion.note" class="mt-1 text-xs leading-5 text-slate-500">{{ nextInstrumentSuggestion.note }}</p>
            </div>
            <UButton size="sm" color="warning" icon="i-lucide-arrow-right" trailing :to="`/module/${data.module}`">去完成</UButton>
          </div>
        </div>

      </section>

      <!-- ══════════ 5. 行动方案建议（按方案块确认） ══════════ -->
      <section v-if="activeActions.length || needsAcceptance" class="order-6 rounded-2xl border border-slate-200 bg-white p-5">
        <!-- 深度诊断待办（工具项形态）：基于本次测量结果的进一步诊断建议，完成对应量表后自动消失 -->
        <div v-if="nextInstrumentSuggestion" class="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-amber-700">待办 · 建议深度诊断</p>
            <p class="mt-1 text-sm font-medium text-slate-800">建议进一步完成「{{ nextInstrumentSuggestion.title }}」</p>
            <p v-if="nextInstrumentSuggestion.note" class="mt-1 text-xs leading-5 text-slate-500">{{ nextInstrumentSuggestion.note }}</p>
          </div>
          <UButton size="sm" color="warning" icon="i-lucide-arrow-right" trailing :to="`/module/${data.module}`">去完成</UButton>
        </div>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="flex items-center gap-2 font-semibold text-slate-800">
              <UIcon name="i-lucide-clipboard-check" class="size-4 text-indigo-600" />
              行动方案建议
            </h3>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              请结合实际情况按方案块确认。接受家长或学校配合部分，表示教师同意发起协同，不代表替对方承诺执行。
            </p>
          </div>
          <div class="flex flex-wrap gap-2 text-xs">
            <UBadge color="success" variant="soft">已接受 {{ includedRecommendationCount }}</UBadge>
            <UBadge color="neutral" variant="soft">暂不接受 {{ rejectedRecommendationCount }}</UBadge>
            <UBadge v-if="pendingRecommendationCount" color="warning" variant="soft">待处理 {{ pendingRecommendationCount }}</UBadge>
          </div>
        </div>

        <div v-if="!activeActions.length" class="mt-5 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          当前未生成可执行的行动建议，建议暂不进入执行阶段，并将该情况提交为调整反馈。
        </div>

        <div class="mt-5 space-y-5">
          <article
            v-for="group in recommendationGroups"
            :key="`recommendation-${group.key}`"
            class="overflow-hidden rounded-xl border"
            :class="group.decision === 'included'
              ? 'border-emerald-200'
              : group.decision === 'rejected'
                ? 'border-slate-200 bg-slate-50/50'
                : 'border-indigo-100'"
          >
            <header class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div class="flex min-w-0 items-start gap-3">
                <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <UIcon :name="recommendationMeta(group.audience).icon" class="size-4" />
                </span>
                <h4 class="min-w-0 font-semibold leading-7 text-slate-800">{{ recommendationMeta(group.audience).title }}</h4>
              </div>
              <UBadge
                :color="group.decision === 'included' ? 'success' : group.decision === 'rejected' ? 'neutral' : 'warning'"
                variant="soft"
              >
                {{ group.decision === 'included' ? '已接受' : group.decision === 'rejected' ? '暂不接受' : group.decision === 'mixed' ? '部分已确认' : '待确认' }}
              </UBadge>
              <UButton
                v-if="groupSuggestion(group)"
                size="xs"
                color="warning"
                icon="i-lucide-arrow-right"
                trailing
                :to="`/module/${data.module}`"
              >
                去完成
              </UButton>
            </header>

            <dl class="divide-y divide-slate-100 text-sm md:grid md:grid-cols-[9rem_1fr] md:divide-y-0">
              <dt class="bg-slate-50 px-4 py-3 font-medium text-slate-600 md:border-b md:border-r md:border-slate-100">具体实施方案</dt>
              <dd class="whitespace-pre-line px-4 py-3 leading-7 text-slate-700 md:border-b md:border-slate-100">{{ recommendationImplementation(group) }}</dd>
              <dt class="bg-slate-50 px-4 py-3 font-medium text-slate-600 md:border-b md:border-r md:border-slate-100">执行人</dt>
              <dd class="px-4 py-3 text-slate-700 md:border-b md:border-slate-100">{{ recommendationMeta(group.audience).executor }}</dd>
              <dt class="bg-slate-50 px-4 py-3 font-medium text-slate-600 md:border-b md:border-r md:border-slate-100">时间周期</dt>
              <dd class="px-4 py-3 text-slate-700 md:border-b md:border-slate-100">{{ recommendationGroupPeriod(group) }}</dd>
              <dt class="bg-slate-50 px-4 py-3 font-medium text-slate-600 md:border-r md:border-slate-100">达成效果</dt>
              <dd class="px-4 py-3 leading-6 text-slate-700">{{ recommendationGroupOutcome() }}</dd>
            </dl>

            <div v-if="group.decision === 'rejected'" class="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              <span class="font-medium text-slate-700">暂不接受原因：</span>{{ recommendationRejectSummary(group) }}
            </div>

            <footer v-if="needsAcceptance" class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 print:hidden">
              <UButton
                v-if="group.decision !== 'included'"
                size="sm"
                :loading="decisionPendingGroupKey === group.key"
                @click="saveRecommendationGroupDecision(group, 'included')"
              >
                接受
              </UButton>
              <UButton
                v-if="group.decision !== 'rejected'"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="decisionPendingGroupKey === group.key"
                @click="openRejectModal(group)"
              >
                暂不接受
              </UButton>
              <UButton
                v-else
                color="neutral"
                variant="ghost"
                size="sm"
                @click="openRejectModal(group)"
              >
                修改原因
              </UButton>
            </footer>
          </article>
        </div>

        <div v-if="needsAcceptance" class="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-slate-800">
                {{ pendingRecommendationCount ? `还有 ${pendingRecommendationCount} 个方案块待处理` : '全部方案块已处理，可以提交确认' }}
              </p>
              <p class="mt-1 text-xs leading-5 text-slate-500">
                {{ includedRecommendationCount
                  ? `确认后进入执行阶段，共接受 ${includedRecommendationCount} 个方案块。`
                  : '若全部暂不接受，将提交反馈并保持方案待调整，不会进入执行阶段。' }}
              </p>
            </div>
            <UButton
              :color="includedRecommendationCount ? 'primary' : 'neutral'"
              :variant="includedRecommendationCount ? 'solid' : 'outline'"
              :loading="acceptancePending"
              :disabled="pendingRecommendationCount > 0"
              @click="finalizeRecommendations"
            >
              {{ includedRecommendationCount ? '确认方案并开始执行' : '提交暂不接受反馈' }}
            </UButton>
          </div>
        </div>
      </section>

      <!-- AI 合规声明（《生成式人工智能服务管理暂行办法》） -->
      <p class="order-7 mt-3 text-center text-xs text-slate-400">AI 辅助建议，需人工专业判断</p>

      <!-- ══════════ 6. 复盘时间线 ══════════ -->
      <section v-if="canReview && data.reviews?.length" class="order-9 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-clock" class="size-4 text-slate-600" />
          复盘时间线
        </h3>

        <div class="mt-4 space-y-3">
          <div
            v-for="review in data.reviews"
            :key="review.id"
            class="rounded-xl border border-slate-100 p-4"
          >
            <div class="flex justify-between gap-3">
              <strong class="text-sm">效果 {{ scoreOutOfFive(review.effectScore) }}/5</strong>
              <span class="text-xs text-slate-400">
                {{ new Date(review.reviewAt).toLocaleString('zh-CN') }}
              </span>
            </div>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ review.progressNote }}</p>
            <p class="mt-2 text-xs text-emerald-700">下一步：{{ review.nextAction }}</p>
          </div>
        </div>
      </section>

      <!-- ══════════ 7. 新增复盘 ══════════ -->
      <section v-if="showReviewForm" class="order-10 rounded-2xl border border-slate-200 bg-white p-5 print:hidden">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-plus-circle" class="size-4 text-emerald-600" />
          新增复盘
        </h3>

        <div class="mt-4 grid gap-4 md:grid-cols-[8rem_1fr_12rem]">
          <UFormField label="效果评分">
            <USelect
              v-model="reviewForm.effectScore"
              :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v} / 5`, value: v }))"
              class="w-full"
            />
          </UFormField>
          <UFormField label="下一步动作">
            <UInput v-model="reviewForm.nextAction" class="w-full" placeholder="后续跟进计划" />
          </UFormField>
          <UFormField label="复盘决策">
            <USelect v-model="reviewForm.decision" :items="reviewDecisionOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField class="mt-4" label="进展说明">
          <UTextarea
            v-model="reviewForm.progressNote"
            :rows="3"
            class="w-full"
            placeholder="描述本阶段的进展、观察和反思"
          />
        </UFormField>

        <!-- 本次完成动作多选 -->
        <div v-if="executableActions.filter(a => a.status !== 'completed').length" class="mt-4">
          <p class="mb-2 text-xs font-medium text-slate-500">本次完成了哪些动作？（勾选后自动标记为已完成）</p>
          <div class="space-y-1 rounded-xl border border-slate-100 p-3">
            <label
              v-for="action in executableActions.filter(a => a.status !== 'completed')"
              :key="action.id"
              class="flex cursor-pointer items-center gap-2.5 py-1 text-sm"
            >
              <UCheckbox
                :model-value="reviewForm.completedActionIds.includes(action.id)"
                @update:model-value="(checked: boolean | string) => {
                  if (checked) {
                    reviewForm.completedActionIds.push(action.id)
                  } else {
                    reviewForm.completedActionIds = reviewForm.completedActionIds.filter(id => id !== action.id)
                  }
                }"
              />
              <span class="text-slate-700">{{ action.title }}</span>
            </label>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <UButton
            :loading="pending"
            :disabled="
              reviewForm.progressNote.trim().length < 4 ||
              reviewForm.nextAction.trim().length < 2
            "
            @click="createReview"
          >
            保存复盘
          </UButton>
        </div>
      </section>

      <!-- ══════════ 8. 方案质量反馈 ══════════ -->
      <section v-if="canReview" class="order-11 rounded-2xl border border-slate-200 bg-white p-5 print:hidden">
        <div class="flex flex-wrap items-center gap-3">
          <h3 class="flex items-center gap-2 font-semibold text-slate-800">
            <UIcon name="i-lucide-message-square-check" class="size-4 text-sky-600" />
            方案质量反馈
          </h3>
        </div>

        <div v-if="data.feedback?.length" class="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-900">
          最近反馈：归因 {{ scoreOutOfFive(data.feedback[0].attributionAccuracy) }}/5 · 工具 {{ scoreOutOfFive(data.feedback[0].toolUsability) }}/5
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-4">
          <UFormField label="归因准确">
            <USelect v-model="feedbackForm.attributionAccuracy" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="工具可用">
            <USelect v-model="feedbackForm.toolUsability" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="话术自然">
            <USelect v-model="feedbackForm.scriptNaturalness" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="行动难度">
            <USelect v-model="feedbackForm.actionDifficulty" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
        </div>

        <div class="mt-4">
          <p class="mb-2 text-xs font-medium text-slate-500">反馈标签</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="tag in feedbackTags" :key="tag" class="flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs">
              <UCheckbox
                :model-value="feedbackForm.tags.includes(tag)"
                @update:model-value="checked => toggleFeedbackTag(tag, checked)"
              />
              <span>{{ tag }}</span>
            </label>
          </div>
        </div>

        <UFormField class="mt-4" label="补充说明">
          <UTextarea v-model="feedbackForm.note" :rows="3" class="w-full" placeholder="可简单说明哪里有用、哪里不贴合；不要填写完整敏感正文。" />
        </UFormField>

        <div class="mt-4 flex justify-end">
          <UButton :loading="feedbackPending" @click="submitFeedback">提交质量反馈</UButton>
        </div>
      </section>
    </div>
  </div>

  <UModal v-model:open="rejectModalOpen" title="请反馈原因" description="反馈将用于调整后续建议，不会自动改变确定性测评结果。">
    <template #body>
      <form class="space-y-4" @submit.prevent="submitRecommendationRejection">
        <div>
          <p class="mb-2 text-sm font-medium text-slate-700">请选择主要原因</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <UButton
              v-for="option in rejectReasonOptions"
              :key="option.value"
              type="button"
              color="neutral"
              :variant="rejectForm.reason === option.value ? 'solid' : 'outline'"
              class="justify-start"
              @click="rejectForm.reason = option.value"
            >
              {{ option.label }}
            </UButton>
          </div>
        </div>
        <UFormField label="补充说明" :required="rejectForm.reason === 'other'">
          <UTextarea
            v-model="rejectForm.note"
            class="w-full"
            :rows="3"
            maxlength="200"
            placeholder="请输入"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" type="button" @click="rejectModalOpen = false">取消</UButton>
          <UButton
            type="submit"
            :loading="decisionPendingGroupKey === rejectGroup?.key"
            :disabled="!rejectForm.reason || (rejectForm.reason === 'other' && rejectForm.note.trim().length < 2)"
          >
            提交反馈
          </UButton>
        </div>
      </form>
    </template>
  </UModal>

  <UModal v-model:open="addActionOpen" title="新增行动" description="补充一项可执行、可复盘的方案行动。">
    <template #body>
      <form class="space-y-4" @submit.prevent="createAction">
        <UFormField label="行动名称" required>
          <UInput v-model="addActionForm.title" class="w-full" maxlength="80" placeholder="例如：完成一次课间观察" />
        </UFormField>
        <UFormField label="行动说明" required>
          <UTextarea v-model="addActionForm.detail" class="w-full" :rows="4" maxlength="500" placeholder="写清楚对象、步骤和可观察结果" />
        </UFormField>
        <UFormField label="计划完成时间">
          <UInput v-model="addActionForm.dueAt" class="w-full" type="datetime-local" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" type="button" @click="addActionOpen = false">取消</UButton>
          <UButton type="submit" :loading="addActionPending" :disabled="addActionForm.title.trim().length < 2 || addActionForm.detail.trim().length < 4">保存行动</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

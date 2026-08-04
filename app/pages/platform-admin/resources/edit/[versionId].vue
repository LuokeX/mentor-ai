<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute()
const versionId = String(route.params.versionId)
const toast = useToast()
const { moduleLabel, libraryTypeLabel } = useDisplayLabels()

const { data: resourceData, refresh: refreshResources } = await useFetch<any>('/api/v1/platform-admin/module-resources')
const { refresh: refreshResourceQuality } = await useFetch<any>('/api/v1/platform-admin/resource-quality')

// ---- 查找版本和库 ----
const version = computed(() => (resourceData.value?.versions || []).find((v: any) => v.id === versionId))
const library = computed(() => {
  if (!version.value) return null
  return (resourceData.value?.libraries || []).find((l: any) => l.id === version.value.libraryId)
})

// ---- 常量和选项 ----
const moduleOptions = [
  { label: '自我成长', value: 'self_growth' },
  { label: '班级系统', value: 'class_system' },
  { label: '家校沟通', value: 'home_school' },
  { label: '学生个案', value: 'student_case' },
  { label: '学习问题', value: 'learning_problem' }
]
const schoolSectionOptions = ['all', 'primary', 'junior', 'senior', 'repeat']
const triggerMethodOptions = ['manual', 'auto', 'scheduled']
const frequencyOptions = ['once', 'daily', 'weekly', 'monthly', 'per_case', 'semester']
const instrumentRoleOptions = [
  { label: '未指定', value: '' },
  { label: '入口筛查', value: 'screening' },
  { label: '深度诊断', value: 'deep_dive' },
  { label: '专项/情境', value: 'situational' },
  { label: '红线检查', value: 'red_line' }
]
const visibilityOptions = ['teacher_only', 'teacher_and_student', 'psychologist']
const calcMethodOptions = ['mean', 'sum', 'weighted', 'count']
/** 严重度取值必须与工具库一致，这是分级规则与工具能咬合的唯一键 */
const severityOptions = [
  { label: 'low 轻度', value: 'low' },
  { label: 'medium 中度', value: 'medium' },
  { label: 'high 重度', value: 'high' },
  { label: 'crisis 危机', value: 'crisis' }
]
const matchModeOptions = ['exact', 'fuzzy', 'regex']
const temporalValidityOptions = ['always', 'pre_term', 'pre_exam', 'holiday']
const templateTypeOptions = ['summary', 'conclusion', 'attribution', 'goal', 'action', 'tool', 'caution', 'review']
const evidenceLevelOptions = [
  { label: '(无)', value: '__none__' },
  { label: 'A', value: 'A' },
  { label: 'B', value: 'B' },
  { label: 'C', value: 'C' },
  { label: 'D', value: 'D' },
]
const scopeOptions = ['instrument', 'module', 'system']
const contraindicationTypeOptions = ['block', 'warn']
const levelOptions = ['success', 'info', 'warning', 'orange', 'error', 'purple', 'survival', 'norming', 'operating', 'mature', 'L1', 'L2', 'L3', 'E']

// ---- 编辑表单 ----
const pending = ref(false)
const activeTab = ref(0)
const savedSnapshot = ref('')
const crossRefResult = ref<any>(null)
const crossRefOpen = ref(false)
const crossRefLoading = ref(false)

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

// ---- 初始化 ----
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
  savedSnapshot.value = JSON.stringify(editStructured.value)
  activeTab.value = 0
  initialized.value = true
}, { immediate: true })

const editPayloadError = computed(() => validateVisualPayload())

// ---- Tab 配置 ----
const tabs = computed(() => {
  const t = editForm.libraryType
  if (t === 'assessment') return [
    { label: '基本属性', icon: 'i-lucide-settings' },
    { label: '题项管理', icon: 'i-lucide-list-checks' },
    { label: '维度定义', icon: 'i-lucide-grid-3x3' },
    { label: '信效度与元数据', icon: 'i-lucide-shield-check' }
  ]
  if (t === 'attribution') return [
    { label: '归因项', icon: 'i-lucide-tags' },
    { label: '证据规则', icon: 'i-lucide-scale' },
    { label: '分级规则', icon: 'i-lucide-git-branch' },
    { label: '计算变量', icon: 'i-lucide-function-square' },
    { label: '红线熔断', icon: 'i-lucide-alert-triangle' },
    { label: '输出与行动', icon: 'i-lucide-play' }
  ]
  if (t === 'tool') return [
    { label: '基本信息', icon: 'i-lucide-settings' },
    { label: '结构化步骤', icon: 'i-lucide-list-ordered' },
    { label: '禁忌规则', icon: 'i-lucide-shield-off' },
    { label: '元数据与关联', icon: 'i-lucide-link' }
  ]
  if (t === 'keyword_route') return [
    { label: '路由规则', icon: 'i-lucide-route' }
  ]
  if (t === 'output_template') return [
    { label: '输出模板', icon: 'i-lucide-file-text' }
  ]
  return []
})

// ---- 未保存离开检测 ----
const hasUnsavedChanges = computed(() => {
  return savedSnapshot.value !== JSON.stringify(editStructured.value)
})

onBeforeRouteLeave(() => {
  if (hasUnsavedChanges.value) {
    return window.confirm('有未保存的修改，确定要离开吗？')
  }
  return true
})

// ---- 工具函数 ----
function suggestNextVersion(ver: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(ver)
  if (!match) return `${ver}-rev`
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : String(value || '')
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {}))
}

function toNumber(val: unknown, fallback: number = 0): number {
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

// ---- normalizeVisualPayload ----
function normalizeVisualPayload(libraryType: string, module: string, payload: Record<string, any>) {
  const source = deepClone(payload)

  if (libraryType === 'assessment') {
    const instruments = Array.isArray(source.instruments) ? source.instruments : [source]
    return {
      instruments: instruments.map((instrument: any) => ({
        code: instrument.code || instrument.instrumentCode || '',
        title: instrument.title || '',
        description: instrument.description || '',
        estimatedMinutes: toNumber(instrument.estimatedMinutes, 3),
        version: instrument.version || editForm.version,
        module,
        // V2 基本属性
        shortName: instrument.shortName || '',
        applicableGradesText: listText(instrument.applicableGrades),
        applicableSubjectsText: listText(instrument.applicableSubjects),
        applicableSchoolSection: instrument.applicableSchoolSection || '',
        targetAudience: instrument.targetAudience || '',
        formType: instrument.formType || '',
        triggerMethod: instrument.triggerMethod || 'manual',
        frequency: instrument.frequency || 'once',
        isRequired: Boolean(instrument.isRequired),
        instrumentRole: instrument.instrumentRole || '',
        timeLimitMinutes: toNumber(instrument.timeLimitMinutes),
        minQuestions: toNumber(instrument.minQuestions),
        usageTiming: instrument.usageTiming || '',
        reAssessmentIntervalDays: toNumber(instrument.reAssessmentIntervalDays),
        prerequisiteCodesText: listText(instrument.prerequisiteCodes),
        exclusiveCodesText: listText(instrument.exclusiveCodes),
        triggerCondition: instrument.triggerCondition || '',
        triggerConditionNote: instrument.triggerConditionNote || '',
        // V2 信效度与元数据
        resultVisibility: instrument.resultVisibility || 'teacher_only',
        responsibleRole: instrument.responsibleRole || '',
        dataSensitivity: instrument.dataSensitivity || '',
        sourceType: instrument.sourceType || '',
        externalAuthorizationNote: instrument.externalAuthorizationNote || '',
        sourceRef: instrument.sourceRef || '',
        normReference: instrument.normReference || '',
        reliabilityNote: instrument.reliabilityNote || '',
        validityNote: instrument.validityNote || '',
        privacyNotice: instrument.privacyNotice || '',
        applicabilityPreconditions: instrument.applicabilityPreconditions || '',
        contraindications: instrument.contraindications || '',
        postAssessmentActions: instrument.postAssessmentActions || '',
        // 题项
        questions: (instrument.questions || []).map((question: any) => ({
          id: question.id || '',
          text: question.text || '',
          dimension: question.dimension || '',
          subDimension: question.subDimension || '',
          weight: question.weight != null ? String(question.weight) : '',
          reverse: Boolean(question.reverse),
          required: question.required !== false,
          displayCondition: question.displayCondition || '',
          dataUsage: question.dataUsage || '',
          help: question.help || '',
          questionNote: question.questionNote || '',
          example: question.example || '',
          options: (question.options || []).map((option: any) => ({
            label: option.label || '',
            value: toNumber(option.value, 0)
          }))
        })),
        // 计分
        scoringRows: Object.entries(instrument.scoring || {}).map(([key, expression]) => ({
          key,
          expression: String(expression)
        })),
        // V2: 维度定义
        dimensionDefs: (instrument.dimensionDefs || []).map((dim: any) => ({
          code: dim.code || '',
          name: dim.name || '',
          questionIdsText: listText(dim.questionIds),
          calcMethod: dim.calcMethod || 'mean',
          weight: dim.weight != null ? String(dim.weight) : '',
          description: dim.description || '',
          highInterpretation: dim.highInterpretation || '',
          lowInterpretation: dim.lowInterpretation || '',
          normMean: dim.normMean != null ? String(dim.normMean) : '',
          normStd: dim.normStd != null ? String(dim.normStd) : ''
        }))
      }))
    }
  }

  if (libraryType === 'attribution') {
    return {
      module: source.module || module,
      version: source.version || editForm.version,
      computedRows: Object.entries(source.computed || {}).map(([key, expression]) => ({ key, expression: String(expression) })),
      // V3 三层：归因项 / 证据规则 / 分级规则
      attributionItems: (source.attributionItems || []).map((item: any) => ({
        code: item.code || '',
        name: item.name || '',
        baseWeight: item.baseWeight ?? 1,
        toolTagsText: listText(item.toolTags),
        description: item.description || '',
        highManifestation: item.highManifestation || '',
        typicalTrigger: item.typicalTrigger || '',
        suggestedAction: item.suggestedAction || '',
        sourceRef: item.sourceRef || ''
      })),
      evidences: (source.evidences || []).map((evidence: any) => ({
        evidenceCode: evidence.evidenceCode || '',
        attributionCode: evidence.attributionCode || '',
        assessmentCode: evidence.assessmentCode || '',
        condition: evidence.condition || '',
        weight: evidence.weight ?? 1,
        description: evidence.description || '',
        sourceRef: evidence.sourceRef || ''
      })),
      gradingRules: (source.gradingRules || []).map((rule: any) => ({
        ruleId: rule.ruleId || '',
        assessmentCode: rule.assessmentCode || '',
        pri: toNumber(rule.pri, 100),
        when: rule.when || '',
        level: rule.level || 'stable',
        levelName: rule.levelName || '',
        severity: rule.severity || 'medium',
        blocked: Boolean(rule.blocked),
        resultDescription: rule.resultDescription || '',
        escalationCondition: rule.escalationCondition || '',
        escalationTarget: rule.escalationTarget || '',
        reEvaluationTrigger: rule.reEvaluationTrigger || '',
        interventionTools: Array.isArray(rule.interventionTools) ? [...rule.interventionTools] : [],
        interventionActions: Array.isArray(rule.interventionActions) ? [...rule.interventionActions] : [],
        sourceRef: rule.sourceRef || ''
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
      crisisBlocked: Boolean(source.crisis?.blocked),
      // V2: 红线熔断规则
      redLines: (source.redLines || []).map((rl: any) => ({
        module: rl.module || module,
        condition: rl.condition || '',
        description: rl.description || '',
        scope: rl.scope || 'module',
        requiredActions: rl.requiredActions || '',
        actionsText: listText(rl.actions),
        recoveryCondition: rl.recoveryCondition || '',
        responsibleRole: rl.responsibleRole || '',
        notificationTemplate: rl.notificationTemplate || '',
        sourceRef: rl.sourceRef || ''
      }))
    }
  }

  if (libraryType === 'keyword_route') {
    return {
      routes: (source.routes || []).map((route: any) => ({
        code: route.code || '',
        coreKeywords: route.coreKeywords || '',
        expandedKeywords: route.expandedKeywords || '',
        exclusionKeywordsText: listText(route.exclusionKeywords),
        module: route.module || module,
        matchPriority: toNumber(route.matchPriority, 0),
        matchMode: route.matchMode || 'fuzzy',
        riskLevel: route.riskLevel || '',
        semanticCategory: route.semanticCategory || '',
        linkedAssessmentCode: route.linkedAssessmentCode || '',
        linkedToolCode: route.linkedToolCode || '',
        contextConstraint: route.contextConstraint || '',
        routeWeight: route.routeWeight != null ? String(route.routeWeight) : '',
        temporalValidity: route.temporalValidity || 'always',
        description: route.description || ''
      }))
    }
  }

  if (libraryType === 'output_template') {
    return {
      templates: (source.templates || []).map((tpl: any) => ({
        code: tpl.code || '',
        module: tpl.module || module,
        attributionLevel: tpl.attributionLevel || '',
        type: tpl.type || 'summary',
        content: tpl.content || '',
        placeholders: tpl.placeholders || '',
        order: toNumber(tpl.order, 0)
      }))
    }
  }

  // tool — default fallback
  return {
    tools: (source.tools || []).map((tool: any) => ({
      code: tool.code || '',
      name: tool.name || '',
      shortName: tool.shortName || '',
      form: tool.form || '',
      symptoms: tool.symptoms || '',
      expectedEffect: tool.expectedEffect || '',
      severity: tool.severity || '',
      level: tool.level || '',
      attributionCode: tool.attributionCode || '',
      attributionLabel: tool.attributionLabel || '',
      attributionCodesText: listText(tool.attributionCodes),
      tagsText: listText(tool.tags),
      toolTagsText: listText(tool.toolTags),
      duration: tool.duration || '',
      timePerSession: tool.timePerSession || '',
      stepsText: listText(tool.steps),
      scripts: tool.scripts || '',
      prohibitions: tool.prohibitions || '',
      targetUsers: tool.targetUsers || '',
      dimensionsText: listText(tool.dimensions),
      effectNote: tool.effectNote || '',
      // V2 new
      applicableSchoolSection: tool.applicableSchoolSection || '',
      reAssessmentIntervalDays: toNumber(tool.reAssessmentIntervalDays),
      contraindicationNote: tool.contraindicationNote || '',
      toolVersion: tool.toolVersion || '',
      // V2 metadata
      evidenceLevel: tool.evidenceLevel || '__none__',
      evidenceSource: tool.evidenceSource || '',
      outcomeIndicators: tool.outcomeIndicators || '',
      failureCriteria: tool.failureCriteria || '',
      preparationNeeded: tool.preparationNeeded || '',
      materialsRequired: tool.materialsRequired || '',
      outputArtifact: tool.outputArtifact || '',
      prerequisiteToolCode: tool.prerequisiteToolCode || '',
      alternativeToolCode: tool.alternativeToolCode || '',
      advancedToolCode: tool.advancedToolCode || '',
      collaborativeToolCodesText: listText(tool.collaborativeToolCodes),
      crossModuleTagsText: listText(tool.crossModuleTags),
      sourceRef: tool.sourceRef || '',
      structuredSteps: (tool.structuredSteps || []).map((s: any) => ({
        seq: toNumber(s.seq, 1),
        title: s.title || '',
        description: s.description || '',
        estimatedTime: s.estimatedTime || '',
        materials: s.materials || '',
        keyTip: s.keyTip || '',
        scriptTemplate: s.scriptTemplate || '',
        successCriteria: s.successCriteria || '',
        commonIssues: s.commonIssues || ''
      })),
      contraindicationRules: (tool.contraindicationRules || []).map((r: any) => ({
        condition: r.condition || '',
        type: r.type || 'warn',
        description: r.description || r.condition,
        alternativeSuggestion: r.alternativeSuggestion || '',
        applicableTeacherGroup: r.applicableTeacherGroup || '',
        reference: r.reference || ''
      }))
    }))
  }
}

// ---- buildVisualPayload ----
function buildVisualPayload() {
  if (editForm.libraryType === 'assessment') {
    return {
      instruments: (editStructured.value.instruments || []).map((instrument: any) => ({
        code: instrument.code,
        instrumentCode: instrument.code,
        version: instrument.version || editForm.version,
        module: editForm.module,
        title: instrument.title,
        description: instrument.description,
        estimatedMinutes: toNumber(instrument.estimatedMinutes),
        // V2
        shortName: instrument.shortName || undefined,
        applicableGrades: splitList(instrument.applicableGradesText).map(Number).filter(n => !Number.isNaN(n)).length ? splitList(instrument.applicableGradesText).map(Number).filter(n => !Number.isNaN(n)) : undefined,
        applicableSubjects: splitList(instrument.applicableSubjectsText).length ? splitList(instrument.applicableSubjectsText) : undefined,
        applicableSchoolSection: instrument.applicableSchoolSection || undefined,
        targetAudience: instrument.targetAudience || undefined,
        formType: instrument.formType || undefined,
        triggerMethod: instrument.triggerMethod || undefined,
        frequency: instrument.frequency || undefined,
        isRequired: instrument.isRequired || undefined,
        instrumentRole: instrument.instrumentRole || undefined,
        timeLimitMinutes: toNumber(instrument.timeLimitMinutes) || undefined,
        minQuestions: toNumber(instrument.minQuestions) || undefined,
        usageTiming: instrument.usageTiming || undefined,
        reAssessmentIntervalDays: toNumber(instrument.reAssessmentIntervalDays) || undefined,
        prerequisiteCodes: splitList(instrument.prerequisiteCodesText).length ? splitList(instrument.prerequisiteCodesText) : undefined,
        exclusiveCodes: splitList(instrument.exclusiveCodesText).length ? splitList(instrument.exclusiveCodesText) : undefined,
        triggerCondition: instrument.triggerCondition || undefined,
        triggerConditionNote: instrument.triggerConditionNote || undefined,
        resultVisibility: instrument.resultVisibility || undefined,
        responsibleRole: instrument.responsibleRole || undefined,
        dataSensitivity: instrument.dataSensitivity || undefined,
        sourceType: instrument.sourceType || undefined,
        externalAuthorizationNote: instrument.externalAuthorizationNote || undefined,
        sourceRef: instrument.sourceRef || undefined,
        normReference: instrument.normReference || undefined,
        reliabilityNote: instrument.reliabilityNote || undefined,
        validityNote: instrument.validityNote || undefined,
        privacyNotice: instrument.privacyNotice || undefined,
        applicabilityPreconditions: instrument.applicabilityPreconditions || undefined,
        contraindications: instrument.contraindications || undefined,
        postAssessmentActions: instrument.postAssessmentActions || undefined,
        // 题项
        questions: (instrument.questions || []).map((question: any) => ({
          id: question.id,
          text: question.text,
          dimension: question.dimension,
          subDimension: question.subDimension || undefined,
          weight: question.weight ? toNumber(question.weight) : undefined,
          reverse: Boolean(question.reverse),
          required: Boolean(question.required),
          displayCondition: question.displayCondition || undefined,
          dataUsage: question.dataUsage || undefined,
          help: question.help || undefined,
          questionNote: question.questionNote || undefined,
          example: question.example || undefined,
          options: (question.options || []).map((option: any) => ({
            label: option.label,
            value: toNumber(option.value)
          }))
        })),
        scoring: Object.fromEntries((instrument.scoringRows || [])
          .filter((row: any) => row.key && row.expression)
          .map((row: any) => [row.key, row.expression])),
        dimensionDefs: (instrument.dimensionDefs || [])
          .filter((dim: any) => dim.code && dim.name)
          .map((dim: any) => ({
            code: dim.code,
            name: dim.name,
            questionIds: splitList(dim.questionIdsText),
            calcMethod: dim.calcMethod || 'mean',
            weight: dim.weight ? toNumber(dim.weight) : undefined,
            description: dim.description || undefined,
            highInterpretation: dim.highInterpretation || undefined,
            lowInterpretation: dim.lowInterpretation || undefined,
            normMean: dim.normMean ? toNumber(dim.normMean) : undefined,
            normStd: dim.normStd ? toNumber(dim.normStd) : undefined
          }))
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
      attributionItems: (editStructured.value.attributionItems || []).map((item: any) => ({
        code: item.code,
        name: item.name,
        module: editForm.module,
        baseWeight: toNumber(item.baseWeight, 1),
        toolTags: splitList(item.toolTagsText),
        description: item.description || undefined,
        highManifestation: item.highManifestation || undefined,
        typicalTrigger: item.typicalTrigger || undefined,
        suggestedAction: item.suggestedAction || undefined,
        sourceRef: item.sourceRef || undefined
      })),
      evidences: (editStructured.value.evidences || []).map((evidence: any) => ({
        evidenceCode: evidence.evidenceCode,
        attributionCode: evidence.attributionCode,
        assessmentCode: evidence.assessmentCode,
        condition: evidence.condition,
        weight: toNumber(evidence.weight, 1),
        description: evidence.description,
        sourceRef: evidence.sourceRef || undefined
      })),
      gradingRules: (editStructured.value.gradingRules || []).map((rule: any) => ({
        ruleId: rule.ruleId,
        assessmentCode: rule.assessmentCode || undefined,
        pri: toNumber(rule.pri, 100),
        when: rule.when || undefined,
        level: rule.level,
        levelName: rule.levelName || undefined,
        severity: rule.severity || 'medium',
        blocked: Boolean(rule.blocked),
        resultDescription: rule.resultDescription || undefined,
        escalationCondition: rule.escalationCondition || undefined,
        escalationTarget: rule.escalationTarget || undefined,
        reEvaluationTrigger: rule.reEvaluationTrigger || undefined,
        interventionTools: Array.isArray(rule.interventionTools)
          ? rule.interventionTools.filter((c: string) => c.trim())
          : undefined,
        interventionActions: Array.isArray(rule.interventionActions)
          ? rule.interventionActions.filter((a: string) => a.trim())
          : undefined,
        sourceRef: rule.sourceRef || undefined
      })),
      actions: (editStructured.value.actions || []).filter((action: any) => action.title && action.detail)
        .map((action: any) => ({ title: action.title, detail: action.detail, status: 'pending' })),
      tools: (editStructured.value.embeddedTools || []).filter((tool: any) => tool.title && tool.content)
        .map((tool: any) => ({ title: tool.title, content: tool.content })),
      crisis: editStructured.value.crisisWhen
        ? { when: editStructured.value.crisisWhen, blocked: Boolean(editStructured.value.crisisBlocked) }
        : undefined,
      redLines: (editStructured.value.redLines || [])
        .filter((rl: any) => rl.condition && rl.description)
        .map((rl: any) => ({
          module: rl.module || editForm.module,
          condition: rl.condition,
          description: rl.description,
          scope: rl.scope || 'module',
          requiredActions: rl.requiredActions || '',
          actions: splitList(rl.actionsText),
          recoveryCondition: rl.recoveryCondition || undefined,
          responsibleRole: rl.responsibleRole || undefined,
          notificationTemplate: rl.notificationTemplate || undefined,
          sourceRef: rl.sourceRef || undefined
        }))
    }
  }

  if (editForm.libraryType === 'keyword_route') {
    return {
      routes: (editStructured.value.routes || []).filter((r: any) => r.code && r.coreKeywords)
        .map((r: any) => ({
          code: r.code,
          coreKeywords: r.coreKeywords,
          expandedKeywords: r.expandedKeywords || undefined,
          exclusionKeywords: splitList(r.exclusionKeywordsText).length ? splitList(r.exclusionKeywordsText) : undefined,
          module: r.module || editForm.module,
          matchPriority: toNumber(r.matchPriority, 0),
          matchMode: r.matchMode || 'fuzzy',
          riskLevel: r.riskLevel,
          semanticCategory: r.semanticCategory || undefined,
          linkedAssessmentCode: r.linkedAssessmentCode || undefined,
          linkedToolCode: r.linkedToolCode || undefined,
          contextConstraint: r.contextConstraint || undefined,
          routeWeight: r.routeWeight ? toNumber(r.routeWeight) : undefined,
          temporalValidity: r.temporalValidity || 'always',
          description: r.description || undefined
        }))
    }
  }

  if (editForm.libraryType === 'output_template') {
    return {
      templates: (editStructured.value.templates || []).filter((t: any) => t.code && t.content)
        .map((t: any) => ({
          code: t.code,
          module: t.module || editForm.module,
          attributionLevel: t.attributionLevel,
          type: t.type || 'summary',
          content: t.content,
          placeholders: t.placeholders || undefined,
          order: toNumber(t.order, 0)
        }))
    }
  }

  // tool
  return {
    tools: (editStructured.value.tools || []).map((tool: any) => ({
      code: tool.code,
      name: tool.name,
      shortName: tool.shortName || undefined,
      form: tool.form,
      symptoms: tool.symptoms,
      expectedEffect: tool.expectedEffect,
      severity: tool.severity,
      level: tool.level,
      attributionCode: tool.attributionCode || undefined,
      attributionLabel: tool.attributionLabel || undefined,
      attributionCodes: splitList(tool.attributionCodesText),
      tags: splitList(tool.tagsText),
      toolTags: splitList(tool.toolTagsText),
      duration: tool.duration,
      timePerSession: tool.timePerSession,
      steps: splitList(tool.stepsText),
      scripts: tool.scripts,
      prohibitions: tool.prohibitions,
      targetUsers: tool.targetUsers,
      dimensions: splitList(tool.dimensionsText),
      effectNote: tool.effectNote || undefined,
      applicableSchoolSection: tool.applicableSchoolSection || undefined,
      reAssessmentIntervalDays: toNumber(tool.reAssessmentIntervalDays) || undefined,
      contraindicationNote: tool.contraindicationNote || undefined,
      toolVersion: tool.toolVersion || undefined,
      evidenceLevel: tool.evidenceLevel === '__none__' ? undefined : tool.evidenceLevel,
      evidenceSource: tool.evidenceSource || undefined,
      outcomeIndicators: tool.outcomeIndicators || undefined,
      failureCriteria: tool.failureCriteria || undefined,
      preparationNeeded: tool.preparationNeeded || undefined,
      materialsRequired: tool.materialsRequired || undefined,
      outputArtifact: tool.outputArtifact || undefined,
      prerequisiteToolCode: tool.prerequisiteToolCode || undefined,
      alternativeToolCode: tool.alternativeToolCode || undefined,
      advancedToolCode: tool.advancedToolCode || undefined,
      collaborativeToolCodes: splitList(tool.collaborativeToolCodesText).length ? splitList(tool.collaborativeToolCodesText) : undefined,
      crossModuleTags: splitList(tool.crossModuleTagsText).length ? splitList(tool.crossModuleTagsText) : undefined,
      sourceRef: tool.sourceRef || undefined,
      structuredSteps: (tool.structuredSteps || [])
        .filter((s: any) => s.title && s.description)
        .map((s: any) => ({
          seq: toNumber(s.seq, 1),
          title: s.title,
          description: s.description,
          estimatedTime: s.estimatedTime || undefined,
          materials: s.materials || undefined,
          keyTip: s.keyTip || undefined,
          scriptTemplate: s.scriptTemplate || undefined,
          successCriteria: s.successCriteria || undefined,
          commonIssues: s.commonIssues || undefined
        })),
      contraindicationRules: (tool.contraindicationRules || [])
        .filter((r: any) => r.condition && r.type)
        .map((r: any) => ({
          condition: r.condition,
          type: r.type,
          description: r.description || r.condition,
          alternativeSuggestion: r.alternativeSuggestion || undefined,
          applicableTeacherGroup: r.applicableTeacherGroup || undefined,
          reference: r.reference || undefined
        }))
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
    const items = editStructured.value.attributionItems || []
    const evidences = editStructured.value.evidences || []
    const gradingRules = editStructured.value.gradingRules || []
    if (!items.length) return '归因库至少需要一条归因项'
    if (!evidences.length) return '归因库至少需要一条证据规则'
    if (!gradingRules.length) return '归因库至少需要一条分级规则'

    const codes = new Set<string>()
    for (const item of items) {
      if (!item.code || !item.name) return '每条归因项都需要编码和名称'
      if (codes.has(item.code)) return `归因编码重复：${item.code}`
      codes.add(item.code)
    }
    const covered = new Set<string>()
    for (const evidence of evidences) {
      if (!evidence.evidenceCode || !evidence.attributionCode || !evidence.assessmentCode || !evidence.condition) {
        return '每条证据规则都需要证据编码、归因编码、依据量表编码和触发条件'
      }
      if (!codes.has(evidence.attributionCode)) return `证据 ${evidence.evidenceCode} 引用的归因编码 ${evidence.attributionCode} 不存在`
      if (!evidence.description) return `证据 ${evidence.evidenceCode} 需要填写证据说明，它会成为方案里的「依据」文案`
      covered.add(evidence.attributionCode)
    }
    for (const item of items) {
      if (!covered.has(item.code)) return `归因项 ${item.code} 没有任何证据规则，永远不会被命中`
    }

    const fallbacks = gradingRules.filter((rule: any) => !rule.when)
    if (!fallbacks.length) return '分级规则必须保留一条兜底规则，触发条件留空即可'
    const maxPri = Math.max(...gradingRules.map((rule: any) => toNumber(rule.pri, 100)))
    for (const rule of fallbacks) {
      if (toNumber(rule.pri, 100) < maxPri) {
        return `兜底分级规则 ${rule.ruleId} 的优先级必须是最大值（当前最大 ${maxPri}）；否则它会吃掉全部作答，其余规则永远不可达`
      }
    }
    for (const rule of gradingRules) {
      if (!rule.ruleId || !rule.level || !rule.severity) return '每条分级规则都需要编码、命中等级和严重度'
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
  if (editForm.libraryType === 'keyword_route') {
    const routes = editStructured.value.routes || []
    if (!routes.length) return '关键词路由至少需要一条规则'
    for (const r of routes) {
      if (!r.code || !r.coreKeywords) return '每条路由都需要编码和核心关键词'
    }
  }
  if (editForm.libraryType === 'output_template') {
    const templates = editStructured.value.templates || []
    if (!templates.length) return '输出模板至少需要一个模板'
    for (const t of templates) {
      if (!t.code || !t.content) return '每个模板都需要编码和内容'
    }
  }
  return ''
}

// ---- 增删操作 ----
function addInstrument() {
  editStructured.value.instruments.push({
    code: '', title: '', description: '', estimatedMinutes: 3, version: editForm.version,
    module: editForm.module, shortName: '', applicableGradesText: '', applicableSubjectsText: '',
    applicableSchoolSection: '', targetAudience: '', formType: '', triggerMethod: 'manual',
    frequency: 'once', isRequired: false, timeLimitMinutes: 0, minQuestions: 0,
    usageTiming: '', reAssessmentIntervalDays: 0, prerequisiteCodesText: '', exclusiveCodesText: '',
    instrumentRole: '', triggerCondition: '', triggerConditionNote: '',
    resultVisibility: 'teacher_only', responsibleRole: '', dataSensitivity: '', sourceType: '',
    externalAuthorizationNote: '', sourceRef: '', normReference: '', reliabilityNote: '',
    validityNote: '', privacyNotice: '', applicabilityPreconditions: '', contraindications: '',
    postAssessmentActions: '', questions: [], scoringRows: [], dimensionDefs: []
  })
}

function addQuestion(instrument: any) {
  instrument.questions.push({
    id: '', text: '', dimension: '', subDimension: '', weight: '', reverse: false,
    required: true, displayCondition: '', dataUsage: '', questionNote: '', example: '',
    options: [
      { label: '完全不符合', value: 1 },
      { label: '比较不符合', value: 2 },
      { label: '一般', value: 3 },
      { label: '比较符合', value: 4 },
      { label: '非常符合', value: 5 }
    ]
  })
}

function addScoringRow(instrument: any) { instrument.scoringRows.push({ key: '', expression: '' }) }

function addDimensionDef(instrument: any) {
  if (!instrument.dimensionDefs) instrument.dimensionDefs = []
  instrument.dimensionDefs.push({
    code: '', name: '', questionIdsText: '', calcMethod: 'mean',
    weight: '', description: '', highInterpretation: '', lowInterpretation: '',
    normMean: '', normStd: ''
  })
}

function addAttributionItem() {
  editStructured.value.attributionItems.push({
    code: '', name: '', baseWeight: 1, toolTagsText: '',
    description: '', highManifestation: '', typicalTrigger: '', suggestedAction: '', sourceRef: ''
  })
}

function addEvidence() {
  editStructured.value.evidences.push({
    evidenceCode: '', attributionCode: '', assessmentCode: '',
    condition: '', weight: 1, description: '', sourceRef: ''
  })
}

function addGradingRule() {
  editStructured.value.gradingRules.push({
    ruleId: '', assessmentCode: '', pri: 100, when: '',
    level: 'stable', levelName: '', severity: 'medium', blocked: false,
    resultDescription: '', escalationCondition: '', escalationTarget: '',
    reEvaluationTrigger: '', interventionTools: [], interventionActions: [], sourceRef: ''
  })
}

function addComputedRow() { editStructured.value.computedRows.push({ key: '', expression: '' }) }
function addAttributionAction() { editStructured.value.actions.push({ title: '', detail: '' }) }
function addEmbeddedTool() { editStructured.value.embeddedTools.push({ title: '', content: '' }) }

function addRedLine() {
  if (!editStructured.value.redLines) editStructured.value.redLines = []
  editStructured.value.redLines.push({
    module: editForm.module, condition: '', description: '',
    scope: 'module', requiredActions: '', actionsText: '',
    recoveryCondition: '', responsibleRole: '', notificationTemplate: '', sourceRef: ''
  })
}

function addToolItem() {
  editStructured.value.tools.push({
    code: '', name: '', shortName: '', form: '', symptoms: '', expectedEffect: '',
    severity: 'medium', level: '', attributionCode: '', attributionLabel: '',
    attributionCodesText: '', tagsText: '', toolTagsText: '',
    duration: '', timePerSession: '', stepsText: '',
    scripts: '', prohibitions: '', targetUsers: '', dimensionsText: '',
    applicableSchoolSection: '', reAssessmentIntervalDays: 0,
    contraindicationNote: '', toolVersion: '',
    evidenceLevel: '__none__', evidenceSource: '', outcomeIndicators: '', failureCriteria: '',
    preparationNeeded: '', materialsRequired: '', outputArtifact: '',
    prerequisiteToolCode: '', alternativeToolCode: '', advancedToolCode: '',
    collaborativeToolCodesText: '', crossModuleTagsText: '', sourceRef: '',
    structuredSteps: [], contraindicationRules: []
  })
}

function addStructuredStep(tool: any) {
  if (!tool.structuredSteps) tool.structuredSteps = []
  tool.structuredSteps.push({
    seq: tool.structuredSteps.length + 1,
    title: '', description: '', estimatedTime: '',
    materials: '', keyTip: '', scriptTemplate: '',
    successCriteria: '', commonIssues: ''
  })
}

function addContraindicationRule(tool: any) {
  if (!tool.contraindicationRules) tool.contraindicationRules = []
  tool.contraindicationRules.push({
    condition: '', type: 'warn', description: '', alternativeSuggestion: '',
    applicableTeacherGroup: '', reference: ''
  })
}

function addRoute() {
  editStructured.value.routes.push({
    code: '', coreKeywords: '', expandedKeywords: '', exclusionKeywordsText: '',
    module: editForm.module, matchPriority: 0, matchMode: 'fuzzy',
    riskLevel: '', semanticCategory: '', linkedAssessmentCode: '',
    linkedToolCode: '', contextConstraint: '', routeWeight: '',
    temporalValidity: 'always', description: ''
  })
}

function addTemplate() {
  editStructured.value.templates.push({
    code: '', module: editForm.module, attributionLevel: '',
    type: 'summary', content: '', placeholders: '', order: 0
  })
}

// ---- 导出 ----
async function exportVersion() {
  try {
    const response = await fetch(`/api/v1/platform-admin/module-resources/versions/${versionId}/export`)
    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
      throw new Error(err.message || '导出失败')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // 从 Content-Disposition 提取文件名，fallback 到默认名称
    const disposition = response.headers.get('Content-Disposition') || ''
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/)
    a.download = filenameMatch?.[1]?.replace(/%([0-9A-F]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))) || 'export.xlsx'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    toast.add({ title: '导出失败', description: e?.message || '请稍后重试', color: 'error' })
  }
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

// ---- 交叉引用校验 ----
async function runCrossRefCheck() {
  crossRefLoading.value = true
  crossRefResult.value = null
  try {
    crossRefResult.value = await $fetch(
      `/api/v1/platform-admin/module-resources/cross-ref-check?module=${editForm.module}&versionId=${versionId}`
    )
    crossRefOpen.value = true
  } catch (error: any) {
    toast.add({
      title: '校验失败',
      description: error?.data?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    crossRefLoading.value = false
  }
}

// ---- 行内编辑辅助 ----
const editingCell = ref<string | null>(null)
function startEdit(cellKey: string) { editingCell.value = cellKey }
function stopEdit() { editingCell.value = null }

function inlineInput(model: any, key: string) {
  return { modelValue: model[key], 'onUpdate:modelValue': (v: any) => { model[key] = v } }
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-8">
    <!-- 未找到 -->
    <div v-if="initialized && !version" class="panel mt-6 p-12 text-center">
      <UIcon name="i-lucide-file-question" class="mx-auto text-4xl text-slate-300" />
      <p class="mt-4 text-lg font-semibold text-slate-500">未找到该版本</p>
      <p class="mt-1 text-sm text-slate-400">版本可能已被删除，或链接无效。</p>
      <UButton to="/platform-admin/resources" class="mt-6" color="neutral" variant="soft">返回资源列表</UButton>
    </div>

    <template v-if="initialized && version">
      <!-- 顶部栏 sticky -->
      <div class="sticky top-3 z-30 rounded-xl border border-slate-100 bg-white shadow-sm px-5 py-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm text-slate-500">
            <NuxtLink to="/platform-admin/resources" class="hover:text-indigo-600 transition-colors">三库运营台</NuxtLink>
            <span class="text-slate-300">/</span>
            <span class="font-medium text-slate-700">{{ library?.name || '加载中...' }}</span>
            <span class="text-slate-300">/</span>
            <span class="text-slate-500">{{ editForm.sourceVersion }} 编辑</span>
            <UBadge v-if="version" :color="version.status === 'published' ? 'success' : version.status === 'retired' ? 'warning' : 'neutral'" variant="soft" size="xs" class="ml-2">
              {{ version.status }}
            </UBadge>
          </div>
          <div class="flex items-center gap-2">
            <UButton to="/platform-admin/resources" color="neutral" variant="soft" size="sm">取消</UButton>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-link-2"
              :loading="crossRefLoading"
              @click="runCrossRefCheck"
            >校验关联</UButton>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-download"
              @click="exportVersion"
            >导出</UButton>
            <UButton icon="i-lucide-save" size="sm" :disabled="Boolean(editPayloadError)" :loading="pending" @click="saveEditedVersion">
              保存新版本
            </UButton>
          </div>
        </div>
        <!-- 版本信息行 -->
        <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span class="text-slate-400">{{ libraryTypeLabel(editForm.libraryType) }} · 模块 {{ moduleLabel(editForm.module) }}</span>
          <span class="text-slate-300">|</span>
          <UInput v-model="editForm.version" size="xs" class="w-32" placeholder="版本号" />
          <UInput v-model="editForm.notes" size="xs" class="w-64" placeholder="版本说明" />
          <UCheckbox v-model="editForm.publish" label="保存后发布" size="sm" />
        </div>
      </div>

      <!-- Tab 栏 -->
      <div class="mt-4 flex border-b border-slate-200">
        <button
          v-for="(tab, index) in tabs"
          :key="index"
          class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === index ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'"
          @click="activeTab = index"
        >
          <UIcon :name="tab.icon" class="mr-1.5 align-middle" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab 内容区 -->
      <div class="mt-4">

        <!-- ====== ASSESSMENT ====== -->
        <template v-if="editForm.libraryType === 'assessment'">

          <!-- Tab 0: 基本属性 -->
          <div v-show="activeTab === 0" class="space-y-6">
            <div v-for="(instrument, i) in editStructured.instruments || []" :key="`basic-${i}`" class="panel p-5">
              <div class="flex items-center justify-between mb-4">
                <h3 class="font-semibold">{{ instrument.code || `量表 ${Number(i) + 1}` }}</h3>
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.instruments.splice(i, 1)" />
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="量表编码"><UInput v-bind="inlineInput(instrument, 'code')" size="sm" /></UFormField>
                <UFormField label="量表名称"><UInput v-bind="inlineInput(instrument, 'title')" size="sm" /></UFormField>
                <UFormField label="量表简称"><UInput v-bind="inlineInput(instrument, 'shortName')" size="sm" /></UFormField>
                <UFormField label="所属模块">
                  <USelect v-bind="inlineInput(instrument, 'module')" :items="moduleOptions" size="sm" />
                </UFormField>
                <UFormField label="版本"><UInput v-bind="inlineInput(instrument, 'version')" size="sm" /></UFormField>
                <UFormField label="预计用时(分钟)"><UInput v-bind="inlineInput(instrument, 'estimatedMinutes')" type="number" size="sm" /></UFormField>
              </div>
              <UFormField label="量表说明" class="mt-3">
                <UTextarea v-bind="inlineInput(instrument, 'description')" :rows="2" size="sm" />
              </UFormField>
              <div class="grid gap-3 mt-3 sm:grid-cols-3">
                <UFormField label="适用学部">
                  <USelect v-bind="inlineInput(instrument, 'applicableSchoolSection')" :items="schoolSectionOptions" size="sm" />
                </UFormField>
                <UFormField label="适用年级(逗号分隔)"><UInput v-bind="inlineInput(instrument, 'applicableGradesText')" size="sm" /></UFormField>
                <UFormField label="适用学科(逗号分隔)"><UInput v-bind="inlineInput(instrument, 'applicableSubjectsText')" size="sm" /></UFormField>
                <UFormField label="施测对象"><UInput v-bind="inlineInput(instrument, 'targetAudience')" size="sm" /></UFormField>
                <UFormField label="施测形式"><UInput v-bind="inlineInput(instrument, 'formType')" size="sm" /></UFormField>
                <UFormField label="触发方式">
                  <USelect v-bind="inlineInput(instrument, 'triggerMethod')" :items="triggerMethodOptions" size="sm" />
                </UFormField>
                <UFormField label="作答频次">
                  <USelect v-bind="inlineInput(instrument, 'frequency')" :items="frequencyOptions" size="sm" />
                </UFormField>
                <UFormField label="作答时限(分钟)"><UInput v-bind="inlineInput(instrument, 'timeLimitMinutes')" type="number" size="sm" /></UFormField>
                <UFormField label="最低题数"><UInput v-bind="inlineInput(instrument, 'minQuestions')" type="number" size="sm" /></UFormField>
                <UFormField label="使用时机"><UInput v-bind="inlineInput(instrument, 'usageTiming')" size="sm" /></UFormField>
                <UFormField label="重评间隔天数"><UInput v-bind="inlineInput(instrument, 'reAssessmentIntervalDays')" type="number" size="sm" /></UFormField>
                <UFormField label="前置量表编码"><UInput v-bind="inlineInput(instrument, 'prerequisiteCodesText')" size="sm" /></UFormField>
                <UFormField label="互斥量表编码"><UInput v-bind="inlineInput(instrument, 'exclusiveCodesText')" size="sm" /></UFormField>
                <UFormField label="量表角色">
                  <USelect v-bind="inlineInput(instrument, 'instrumentRole')" :items="instrumentRoleOptions" size="sm" />
                </UFormField>
                <UFormField label="触发条件"><UInput v-bind="inlineInput(instrument, 'triggerCondition')" size="sm" placeholder="量表[X].总分 >= 17" /></UFormField>
                <UFormField label="触发条件说明"><UInput v-bind="inlineInput(instrument, 'triggerConditionNote')" size="sm" /></UFormField>
                <UFormField label="是否必做">
                  <UCheckbox v-bind="inlineInput(instrument, 'isRequired')" />
                </UFormField>
              </div>
            </div>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addInstrument">新增量表</UButton>
          </div>

          <!-- Tab 1: 题项管理 -->
          <div v-show="activeTab === 1" class="space-y-6">
            <div v-for="(instrument, i) in editStructured.instruments || []" :key="`q-${i}`" class="panel p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">{{ instrument.code || `量表 ${Number(i) + 1}` }} · 题项</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addQuestion(instrument)">新增题项</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[1600px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500">
                    <tr>
                      <th class="p-2 w-16">题号</th><th class="p-2 w-40">题干</th><th class="p-2 w-20">维度</th>
                      <th class="p-2 w-20">子维度</th><th class="p-2 w-14">权重</th><th class="p-2 w-14">反向</th>
                      <th class="p-2 w-14">必答</th><th class="p-2 w-24">显示条件</th><th class="p-2 w-20">数据用途</th>
                      <th class="p-2 w-24">答题提示</th><th class="p-2 w-24">题目说明</th><th class="p-2 w-24">题干举例</th>
                      <th class="p-2 w-48">选项</th><th class="p-2 w-14">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(q, qi) in instrument.questions" :key="qi" class="border-t border-slate-100 align-top">
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'id')" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(q, 'text')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'dimension')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'subDimension')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'weight')" size="xs" type="number" /></td>
                      <td class="p-1 text-center"><UCheckbox v-bind="inlineInput(q, 'reverse')" /></td>
                      <td class="p-1 text-center"><UCheckbox v-bind="inlineInput(q, 'required')" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'displayCondition')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'dataUsage')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'help')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'questionNote')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(q, 'example')" size="xs" /></td>
                      <td class="p-1">
                        <div class="space-y-0.5">
                          <div v-for="(opt, oi) in q.options" :key="oi" class="flex gap-1">
                            <UInput v-bind="inlineInput(opt, 'label')" size="xs" class="flex-1" placeholder="选项" />
                            <UInput v-bind="inlineInput(opt, 'value')" size="xs" type="number" class="w-12" />
                            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="q.options.splice(oi, 1)" />
                          </div>
                          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" @click="q.options.push({ label: '', value: 0 })">加选项</UButton>
                        </div>
                      </td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="instrument.questions.splice(qi, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- 计分表 -->
              <div class="flex items-center justify-between gap-3 mt-4 mb-2">
                <h4 class="text-sm font-semibold">计分表</h4>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addScoringRow(instrument)">新增计分行</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[600px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">字段</th><th class="p-2">表达式</th><th class="p-2 w-14">操作</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, ri) in instrument.scoringRows" :key="ri" class="border-t border-slate-100">
                      <td class="p-1"><UInput v-bind="inlineInput(row, 'key')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(row, 'expression')" size="xs" /></td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="instrument.scoringRows.splice(ri, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Tab 2: 维度定义 -->
          <div v-show="activeTab === 2" class="space-y-6">
            <div v-for="(instrument, i) in editStructured.instruments || []" :key="`dim-${i}`" class="panel p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">{{ instrument.code || `量表 ${Number(i) + 1}` }} · 维度定义</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addDimensionDef(instrument)">新增维度</UButton>
              </div>
              <div v-if="(instrument.dimensionDefs || []).length" class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[1280px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500">
                    <tr>
                      <th class="p-2">编码</th><th class="p-2">名称</th><th class="p-2">题号</th>
                      <th class="p-2">计算方式</th><th class="p-2 w-14">权重</th>
                      <th class="p-2">维度说明</th><th class="p-2">高分解释</th><th class="p-2">低分解释</th>
                      <th class="p-2 w-20">常模均值</th><th class="p-2 w-20">常模标准差</th>
                      <th class="p-2 w-14">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(dim, di) in instrument.dimensionDefs" :key="di" class="border-t border-slate-100 align-top">
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'code')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'name')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'questionIdsText')" size="xs" placeholder="逗号分隔" /></td>
                      <td class="p-1"><USelect v-bind="inlineInput(dim, 'calcMethod')" :items="calcMethodOptions" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'weight')" size="xs" type="number" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(dim, 'description')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(dim, 'highInterpretation')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(dim, 'lowInterpretation')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'normMean')" size="xs" type="number" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(dim, 'normStd')" size="xs" type="number" /></td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="instrument.dimensionDefs.splice(di, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="text-xs text-slate-400">暂无维度定义</p>
            </div>
          </div>

          <!-- Tab 3: 信效度与元数据 -->
          <div v-show="activeTab === 3" class="space-y-6">
            <div v-for="(instrument, i) in editStructured.instruments || []" :key="`meta-${i}`" class="panel p-5">
              <h3 class="font-semibold mb-3">{{ instrument.code || `量表 ${Number(i) + 1}` }} · 信效度与元数据</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <UFormField label="结果可见性">
                  <USelect v-bind="inlineInput(instrument, 'resultVisibility')" :items="visibilityOptions" size="sm" />
                </UFormField>
                <UFormField label="责任角色"><UInput v-bind="inlineInput(instrument, 'responsibleRole')" size="sm" /></UFormField>
                <UFormField label="数据敏感级"><UInput v-bind="inlineInput(instrument, 'dataSensitivity')" size="sm" /></UFormField>
                <UFormField label="来源属性"><UInput v-bind="inlineInput(instrument, 'sourceType')" size="sm" /></UFormField>
                <UFormField label="手册出处"><UInput v-bind="inlineInput(instrument, 'sourceRef')" size="sm" /></UFormField>
                <UFormField label="外部授权说明"><UInput v-bind="inlineInput(instrument, 'externalAuthorizationNote')" size="sm" /></UFormField>
              </div>
              <div class="grid gap-3 mt-3 sm:grid-cols-1">
                <UFormField label="常模参照"><UTextarea v-bind="inlineInput(instrument, 'normReference')" :rows="2" size="sm" /></UFormField>
                <UFormField label="信度说明"><UTextarea v-bind="inlineInput(instrument, 'reliabilityNote')" :rows="2" size="sm" /></UFormField>
                <UFormField label="效度说明"><UTextarea v-bind="inlineInput(instrument, 'validityNote')" :rows="2" size="sm" /></UFormField>
                <UFormField label="隐私声明"><UTextarea v-bind="inlineInput(instrument, 'privacyNotice')" :rows="2" size="sm" /></UFormField>
                <UFormField label="适用前提"><UTextarea v-bind="inlineInput(instrument, 'applicabilityPreconditions')" :rows="2" size="sm" /></UFormField>
                <UFormField label="不适合情况"><UTextarea v-bind="inlineInput(instrument, 'contraindications')" :rows="2" size="sm" /></UFormField>
                <UFormField label="后续建议动作"><UTextarea v-bind="inlineInput(instrument, 'postAssessmentActions')" :rows="2" size="sm" /></UFormField>
              </div>
            </div>
          </div>

        </template>

        <!-- ====== ATTRIBUTION ====== -->
        <template v-if="editForm.libraryType === 'attribution'">

          <!-- Tab 0: 归因项（模块级词表，工具库的「对应归因编码」引用它） -->
          <div v-show="activeTab === 0" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="font-semibold">归因项</h3>
                <p class="mt-1 text-xs text-slate-500">模块级词表。工具库的「对应归因编码」只能引用这里的编码，不要在工具表里另写文案。</p>
              </div>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addAttributionItem">新增归因项</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1600px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">归因编码</th><th class="p-2">归因名称</th><th class="p-2 w-20">权重基数</th>
                    <th class="p-2">工具标签</th><th class="p-2">归因说明</th><th class="p-2">高分表现</th>
                    <th class="p-2">典型诱因</th><th class="p-2">建议动作</th><th class="p-2">手册出处</th><th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, ii) in editStructured.attributionItems || []" :key="ii" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(item, 'code')" size="xs" placeholder="ASCII 编码" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(item, 'name')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(item, 'baseWeight')" size="xs" type="number" step="0.1" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(item, 'toolTagsText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(item, 'description')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(item, 'highManifestation')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(item, 'typicalTrigger')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(item, 'suggestedAction')" :rows="2" size="xs" placeholder="会成为方案的行动项" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(item, 'sourceRef')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.attributionItems.splice(ii, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tab 1: 证据规则（量表级，一条归因可被多张量表的多条证据佐证） -->
          <div v-show="activeTab === 1" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="font-semibold">证据规则</h3>
                <p class="mt-1 text-xs text-slate-500">
                  命中的证据按权重累加到对应归因项，再归一化成占比。触发条件可用「题[q1] &gt;= 4 且 维度[CODE] &gt;= 3」这类写法。
                  注意让条件覆盖中间分段，否则中等分作答会算不出任何归因。
                </p>
              </div>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addEvidence">新增证据</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1400px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">证据编码</th><th class="p-2">归因编码</th><th class="p-2">依据量表编码</th>
                    <th class="p-2">触发条件</th><th class="p-2 w-20">证据权重</th><th class="p-2">证据说明</th>
                    <th class="p-2">手册出处</th><th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(evidence, ei) in editStructured.evidences || []" :key="ei" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'evidenceCode')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'attributionCode')" size="xs" placeholder="引用归因项编码" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'assessmentCode')" size="xs" placeholder="按此过滤适用量表" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'condition')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'weight')" size="xs" type="number" step="0.5" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(evidence, 'description')" :rows="2" size="xs" placeholder="命中后作为方案「依据」文案" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(evidence, 'sourceRef')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.evidences.splice(ei, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tab 2: 分级规则（只产出等级与严重度，不再产出归因） -->
          <div v-show="activeTab === 2" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="font-semibold">分级规则</h3>
                <p class="mt-1 text-xs text-slate-500">
                  按优先级从小到大匹配、首条命中即停，
                  <span class="font-semibold text-amber-700">兜底规则（条件留空）的优先级必须是全表最大值</span>，否则其余规则永远不可达。
                  严重度与工具库共用同一套取值。命中等级可配置「干预工具/干预动作」直接产出干预，与归因通道并行（任一命中即出干预）。
                </p>
              </div>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addGradingRule">新增规则</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1800px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">编码</th><th class="p-2 w-16">优先级</th><th class="p-2">触发条件</th>
                    <th class="p-2">命中等级</th><th class="p-2">等级中文名</th><th class="p-2 w-24">严重度</th>
                    <th class="p-2 w-14">阻断</th><th class="p-2">依据量表</th><th class="p-2">结果说明</th>
                    <th class="p-2">升级条件</th><th class="p-2">升级目标</th><th class="p-2">复评触发</th>
                    <th class="p-2">干预工具</th><th class="p-2">干预动作</th>
                    <th class="p-2">手册出处</th><th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(rule, ri) in editStructured.gradingRules || []" :key="ri" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'ruleId')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'pri')" size="xs" type="number" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'when')" size="xs" placeholder="留空即兜底" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'level')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'levelName')" size="xs" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(rule, 'severity')" :items="severityOptions" size="xs" /></td>
                    <td class="p-1 text-center"><UCheckbox v-bind="inlineInput(rule, 'blocked')" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'assessmentCode')" size="xs" placeholder="留空=模块通用" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(rule, 'resultDescription')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'escalationCondition')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'escalationTarget')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'reEvaluationTrigger')" size="xs" /></td>
                    <td class="p-1"><UInput :model-value="(rule.interventionTools || []).join(';')" size="xs"
                      placeholder="工具编码，多个用;分隔"
                      @update:model-value="(v: string) => rule.interventionTools = v.split(/[;,；，]/).map((s: string) => s.trim()).filter(Boolean)" /></td>
                    <td class="p-1"><UTextarea :model-value="(rule.interventionActions || []).join('\n')" :rows="2" size="xs"
                      placeholder="每行一条动作"
                      @update:model-value="(v: string) => rule.interventionActions = v.split('\n').map((s: string) => s.trim()).filter(Boolean)" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rule, 'sourceRef')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.gradingRules.splice(ri, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tab 3: 计算变量 -->
          <div v-show="activeTab === 3" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">计算变量</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addComputedRow">新增变量</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[600px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">变量名</th><th class="p-2">表达式</th><th class="p-2 w-14">操作</th></tr></thead>
                <tbody>
                  <tr v-for="(row, ri) in editStructured.computedRows || []" :key="ri" class="border-t border-slate-100">
                    <td class="p-1"><UInput v-bind="inlineInput(row, 'key')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(row, 'expression')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.computedRows.splice(ri, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- 危机条件 -->
            <div class="mt-5">
              <h4 class="text-sm font-semibold mb-2">危机条件</h4>
              <div class="flex items-center gap-3">
                <UInput v-bind="inlineInput(editStructured, 'crisisWhen')" size="sm" placeholder="危机触发条件" class="flex-1" />
                <UCheckbox v-bind="inlineInput(editStructured, 'crisisBlocked')" label="阻断" size="sm" />
              </div>
            </div>
          </div>

          <!-- Tab 4: 红线熔断 -->
          <div v-show="activeTab === 4" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">红线熔断规则</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addRedLine">新增红线</UButton>
            </div>
            <div v-if="(editStructured.redLines || []).length" class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1400px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">条件</th><th class="p-2">说明</th><th class="p-2">范围</th>
                    <th class="p-2">处置要求</th><th class="p-2">动作列表</th>
                    <th class="p-2">恢复条件</th><th class="p-2">责任人</th><th class="p-2">通知模板</th>
                    <th class="p-2">手册出处</th><th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(rl, ri) in editStructured.redLines" :key="ri" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'condition')" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(rl, 'description')" :rows="2" size="xs" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(rl, 'scope')" :items="scopeOptions" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'requiredActions')" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(rl, 'actionsText')" :rows="2" size="xs" placeholder="每行一个动作" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'recoveryCondition')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'responsibleRole')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'notificationTemplate')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(rl, 'sourceRef')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.redLines.splice(ri, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="text-xs text-slate-400">暂无红线规则</p>
          </div>

          <!-- Tab 5: 输出与行动 -->
          <div v-show="activeTab === 5" class="grid gap-6 xl:grid-cols-2">
            <div class="panel p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">默认行动项</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addAttributionAction">新增</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[600px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">标题</th><th class="p-2">说明</th><th class="p-2 w-14">操作</th></tr></thead>
                  <tbody>
                    <tr v-for="(a, ai) in editStructured.actions || []" :key="ai" class="border-t border-slate-100">
                      <td class="p-1"><UInput v-bind="inlineInput(a, 'title')" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(a, 'detail')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.actions.splice(ai, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="panel p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">内置工具提示</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addEmbeddedTool">新增</UButton>
              </div>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[600px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">标题</th><th class="p-2">内容</th><th class="p-2 w-14">操作</th></tr></thead>
                  <tbody>
                    <tr v-for="(t, ti) in editStructured.embeddedTools || []" :key="ti" class="border-t border-slate-100">
                      <td class="p-1"><UInput v-bind="inlineInput(t, 'title')" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(t, 'content')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.embeddedTools.splice(ti, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </template>

        <!-- ====== TOOL ====== -->
        <template v-if="editForm.libraryType === 'tool'">

          <!-- Tab 0: 基本信息 -->
          <div v-show="activeTab === 0" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">工具列表</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addToolItem">新增工具</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[3000px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">编码</th><th class="p-2">名称</th><th class="p-2">简称</th><th class="p-2">形式</th>
                    <th class="p-2">适用情形</th><th class="p-2">预期效果</th><th class="p-2">严重度</th>
                    <th class="p-2">等级</th><th class="p-2">对应归因编码</th><th class="p-2">附加归因编码</th>
                    <th class="p-2">标签</th><th class="p-2">工具标签</th><th class="p-2">作用维度编码</th>
                    <th class="p-2">效果说明</th><th class="p-2">步骤</th><th class="p-2">话术</th><th class="p-2">禁忌</th>
                    <th class="p-2">周期</th><th class="p-2">单次时长</th><th class="p-2">对象</th>
                    <th class="p-2">适用学部</th><th class="p-2 w-16">重评间隔</th><th class="p-2">版本</th>
                    <th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(tool, ti) in editStructured.tools || []" :key="ti" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'code')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'name')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'shortName')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'form')" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'symptoms')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'expectedEffect')" :rows="2" size="xs" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(tool, 'severity')" :items="severityOptions" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'level')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'attributionCode')" size="xs" placeholder="引用归因项编码" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'attributionCodesText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'tagsText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'toolTagsText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'dimensionsText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'effectNote')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'stepsText')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'scripts')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(tool, 'prohibitions')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'duration')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'timePerSession')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'targetUsers')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'applicableSchoolSection')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'reAssessmentIntervalDays')" size="xs" type="number" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(tool, 'toolVersion')" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.tools.splice(ti, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tab 1: 结构化步骤 -->
          <div v-show="activeTab === 1" class="space-y-4">
            <div v-for="(tool, ti) in editStructured.tools || []" :key="'ss-' + ti" class="panel p-5" v-show="tool.code">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">{{ tool.code }} · {{ tool.name }} · 结构化步骤</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addStructuredStep(tool)">新增步骤</UButton>
              </div>
              <div v-if="(tool.structuredSteps || []).length" class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-full text-xs">
                  <thead class="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 w-10"></th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 w-14">序号</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-28">标题</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 w-20">预计耗时</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-28">所需材料</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-48">说明</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-36">关键提示</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-32">话术模板</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-28">成功标准</th>
                      <th class="px-2 py-2 text-left font-medium text-slate-600 min-w-28">常见问题</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(step, si) in tool.structuredSteps" :key="si" class="border-b border-slate-100 hover:bg-slate-50/50 align-top">
                      <td class="px-2 py-1">
                        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" @click="tool.structuredSteps.splice(si, 1)" />
                      </td>
                      <td class="px-2 py-1"><UInput v-bind="inlineInput(step, 'seq')" size="xs" type="number" class="w-14" /></td>
                      <td class="px-2 py-1"><UInput v-bind="inlineInput(step, 'title')" size="xs" /></td>
                      <td class="px-2 py-1"><UInput v-bind="inlineInput(step, 'estimatedTime')" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'materials')" :rows="2" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'description')" :rows="2" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'keyTip')" :rows="2" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'scriptTemplate')" :rows="2" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'successCriteria')" :rows="2" size="xs" /></td>
                      <td class="px-2 py-1"><UTextarea v-bind="inlineInput(step, 'commonIssues')" :rows="2" size="xs" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="text-xs text-slate-400">暂无结构化步骤</p>
            </div>
          </div>

          <!-- Tab 2: 禁忌规则 -->
          <div v-show="activeTab === 2" class="space-y-4">
            <div v-for="(tool, ti) in editStructured.tools || []" :key="'cr-' + ti" class="panel p-5" v-show="tool.code">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-semibold">{{ tool.code }} · {{ tool.name }} · 禁忌规则</h3>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addContraindicationRule(tool)">新增规则</UButton>
              </div>
              <div v-if="(tool.contraindicationRules || []).length" class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-[1000px] w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500">
                    <tr><th class="p-2">条件</th><th class="p-2">类型</th><th class="p-2">说明</th><th class="p-2">替代建议</th><th class="p-2">教师群体</th><th class="p-2">依据</th><th class="p-2 w-14">操作</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(rule, ri) in tool.contraindicationRules" :key="ri" class="border-t border-slate-100">
                      <td class="p-1"><UInput v-bind="inlineInput(rule, 'condition')" size="xs" /></td>
                      <td class="p-1"><USelect v-bind="inlineInput(rule, 'type')" :items="contraindicationTypeOptions" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(rule, 'description')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UTextarea v-bind="inlineInput(rule, 'alternativeSuggestion')" :rows="2" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(rule, 'applicableTeacherGroup')" size="xs" /></td>
                      <td class="p-1"><UInput v-bind="inlineInput(rule, 'reference')" size="xs" /></td>
                      <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="tool.contraindicationRules.splice(ri, 1)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="text-xs text-slate-400">暂无禁忌规则</p>
            </div>
          </div>

          <!-- Tab 3: 元数据与关联 -->
          <div v-show="activeTab === 3" class="space-y-4">
            <div v-for="(tool, ti) in editStructured.tools || []" :key="'md-' + ti" class="panel p-5" v-show="tool.code">
              <h3 class="font-semibold mb-3">{{ tool.code }} · {{ tool.name }} · 元数据与关联</h3>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-full text-xs">
                  <tbody>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50 w-40">证据等级</td>
                      <td class="px-3 py-1.5"><USelect v-bind="inlineInput(tool, 'evidenceLevel')" :items="evidenceLevelOptions" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50 w-40">手册出处</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'sourceRef')" size="xs" /></td>
                    </tr>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">证据来源</td>
                      <td class="px-3 py-1.5"><UTextarea v-bind="inlineInput(tool, 'evidenceSource')" :rows="2" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">效果指标</td>
                      <td class="px-3 py-1.5"><UTextarea v-bind="inlineInput(tool, 'outcomeIndicators')" :rows="2" size="xs" /></td>
                    </tr>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">失败标准</td>
                      <td class="px-3 py-1.5"><UTextarea v-bind="inlineInput(tool, 'failureCriteria')" :rows="2" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">准备事项</td>
                      <td class="px-3 py-1.5"><UTextarea v-bind="inlineInput(tool, 'preparationNeeded')" :rows="2" size="xs" /></td>
                    </tr>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">所需材料</td>
                      <td class="px-3 py-1.5"><UTextarea v-bind="inlineInput(tool, 'materialsRequired')" :rows="2" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">输出物</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'outputArtifact')" size="xs" /></td>
                    </tr>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">前置工具</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'prerequisiteToolCode')" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">替代工具</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'alternativeToolCode')" size="xs" /></td>
                    </tr>
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">进阶工具</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'advancedToolCode')" size="xs" /></td>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">协同工具</td>
                      <td class="px-3 py-1.5"><UInput v-bind="inlineInput(tool, 'collaborativeToolCodesText')" size="xs" placeholder="逗号分隔" /></td>
                    </tr>
                    <tr>
                      <td class="px-3 py-1.5 font-medium text-slate-600 bg-slate-50">跨模块标签</td>
                      <td class="px-3 py-1.5" colspan="3"><UInput v-bind="inlineInput(tool, 'crossModuleTagsText')" size="xs" placeholder="逗号分隔" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </template>

        <!-- ====== KEYWORD_ROUTE ====== -->
        <template v-if="editForm.libraryType === 'keyword_route'">
          <div v-show="activeTab === 0" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">路由规则</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addRoute">新增路由</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1800px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">编码</th><th class="p-2">核心关键词</th><th class="p-2">扩展关键词</th>
                    <th class="p-2">排除关键词</th><th class="p-2">模块</th><th class="p-2">优先级</th>
                    <th class="p-2">匹配模式</th><th class="p-2">风险等级</th><th class="p-2">语义类别</th>
                    <th class="p-2">关联量表</th><th class="p-2">关联工具</th><th class="p-2">上下文约束</th>
                    <th class="p-2 w-16">权重</th><th class="p-2">时效</th><th class="p-2">说明</th>
                    <th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, ri) in editStructured.routes || []" :key="ri" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'code')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'coreKeywords')" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(r, 'expandedKeywords')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'exclusionKeywordsText')" size="xs" placeholder="逗号分隔" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(r, 'module')" :items="moduleOptions" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'matchPriority')" size="xs" type="number" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(r, 'matchMode')" :items="matchModeOptions" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'riskLevel')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'semanticCategory')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'linkedAssessmentCode')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'linkedToolCode')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'contextConstraint')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(r, 'routeWeight')" size="xs" type="number" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(r, 'temporalValidity')" :items="temporalValidityOptions" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(r, 'description')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.routes.splice(ri, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- ====== OUTPUT_TEMPLATE ====== -->
        <template v-if="editForm.libraryType === 'output_template'">
          <div v-show="activeTab === 0" class="panel p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">输出模板</h3>
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addTemplate">新增模板</UButton>
            </div>
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-[1200px] w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500">
                  <tr>
                    <th class="p-2">编码</th><th class="p-2">模块</th><th class="p-2">归因等级</th>
                    <th class="p-2">模板类型</th><th class="p-2">模板内容</th>
                    <th class="p-2">变量占位符</th><th class="p-2 w-14">排序</th>
                    <th class="p-2 w-14">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(t, ti) in editStructured.templates || []" :key="ti" class="border-t border-slate-100 align-top">
                    <td class="p-1"><UInput v-bind="inlineInput(t, 'code')" size="xs" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(t, 'module')" :items="moduleOptions" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(t, 'attributionLevel')" size="xs" /></td>
                    <td class="p-1"><USelect v-bind="inlineInput(t, 'type')" :items="templateTypeOptions" size="xs" /></td>
                    <td class="p-1"><UTextarea v-bind="inlineInput(t, 'content')" :rows="2" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(t, 'placeholders')" size="xs" /></td>
                    <td class="p-1"><UInput v-bind="inlineInput(t, 'order')" size="xs" type="number" /></td>
                    <td class="p-1"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="editStructured.templates.splice(ti, 1)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

      </div>

      <!-- 错误提示 -->
      <p v-if="editPayloadError" class="mt-4 text-right text-xs text-red-500">{{ editPayloadError }}</p>

      <!-- 交叉引用校验报告弹窗 -->
      <UModal v-model:open="crossRefOpen" title="交叉引用校验报告">
        <template #body>
          <div v-if="crossRefResult" class="space-y-4">
            <!-- 模块信息 -->
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-slate-500">模块</span>
              <span class="font-medium">{{ moduleLabel(crossRefResult.module) }}</span>
              <span class="text-slate-300">|</span>
              <span class="text-slate-500">已导入</span>
              <span v-if="crossRefResult.librariesAvailable.length" class="flex gap-1">
                <UBadge v-for="lt in crossRefResult.librariesAvailable" :key="lt" color="success" variant="soft" size="xs">
                  {{ libraryTypeLabel(lt) }}
                </UBadge>
              </span>
              <span v-else class="text-slate-400 text-xs">(无)</span>
            </div>

            <!-- 缺失库类型 -->
            <div v-if="crossRefResult.librariesMissing.length" class="rounded-lg border border-red-100 bg-red-50/50 p-3">
              <p class="text-sm font-medium text-red-700 mb-2">尚未导入的库类型</p>
              <div class="flex flex-wrap gap-1">
                <UBadge v-for="lt in crossRefResult.librariesMissing" :key="lt" color="error" variant="soft" size="xs">
                  {{ libraryTypeLabel(lt) }}
                </UBadge>
              </div>
              <p class="mt-2 text-xs text-red-500">这些库类型尚未导入，导致依赖它们的引用无法校验</p>
            </div>

            <!-- 问题列表 -->
            <div v-if="crossRefResult.issues.length" class="space-y-2">
              <p class="text-sm font-medium text-slate-700">
                发现 {{ crossRefResult.issues.length }} 个问题
                <span class="text-xs text-slate-400">
                  (error {{ crossRefResult.issues.filter((i: any) => i.severity === 'error').length }}
                  / warning {{ crossRefResult.issues.filter((i: any) => i.severity === 'warning').length }}
                  / info {{ crossRefResult.issues.filter((i: any) => i.severity === 'info').length }})
                </span>
              </p>

              <div
                v-for="(issue, idx) in crossRefResult.issues"
                :key="idx"
                class="rounded-md border-l-4 p-3 text-sm"
                :class="{
                  'border-red-400 bg-red-50/70': issue.severity === 'error',
                  'border-amber-400 bg-amber-50/70': issue.severity === 'warning',
                  'border-slate-300 bg-slate-50/70': issue.severity === 'info'
                }"
              >
                <div class="flex items-start gap-2">
                  <UBadge
                    :color="issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'neutral'"
                    variant="solid"
                    size="xs"
                    class="shrink-0 mt-0.5"
                  >{{ issue.severity }}</UBadge>
                  <div class="min-w-0">
                    <p class="text-slate-800">
                      <span class="font-medium">{{ libraryTypeLabel(issue.sourceLibraryType) }}</span>
                      <span v-if="issue.sourceCode" class="text-slate-500"> · {{ issue.sourceCode }}</span>
                    </p>
                    <p class="mt-0.5 text-slate-600">
                      字段 <code class="text-xs bg-slate-200 px-1 rounded">{{ issue.sourceField }}</code>
                      的值 <code class="text-xs bg-slate-200 px-1 rounded">{{ issue.sourceValue }}</code>
                      → 目标 <span class="font-medium">{{ libraryTypeLabel(issue.targetLibraryType) }}</span>.{{ issue.targetField }}
                    </p>
                    <p class="mt-1 text-xs" :class="issue.severity === 'error' ? 'text-red-600' : issue.severity === 'warning' ? 'text-amber-600' : 'text-slate-500'">
                      {{ issue.message }}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 无问题 -->
            <div v-else class="rounded-lg border border-green-100 bg-green-50/50 p-4 text-center">
              <UIcon name="i-lucide-check-circle" class="mx-auto text-2xl text-green-500" />
              <p class="mt-2 text-sm font-medium text-green-700">所有交叉引用校验通过</p>
              <p class="text-xs text-green-500">已导入的库之间没有发现不一致的引用</p>
            </div>
          </div>

          <!-- 加载中 -->
          <div v-else class="py-8 text-center text-sm text-slate-400">
            <UIcon name="i-lucide-loader-2" class="mx-auto animate-spin text-2xl" />
            <p class="mt-2">正在校验...</p>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
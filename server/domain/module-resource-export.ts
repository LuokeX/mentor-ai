/**
 * 将版本的 payload 反向转换为 V2 模板格式的 xlsx buffer。
 * 每个 libraryType 输出对应的 sheet 结构（与导入模板一致）。
 */
import XLSX from 'xlsx'
import type { LibraryType, ModuleId } from '../../shared/contracts'

// ---- 公共辅助 ----

/** 将数组转为逗号分隔的字符串，用于在 xlsx 单元格中表示列表 */
function listStr(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value ?? '')
}

/** 将布尔值转为 "是" / "否" */
function boolStr(value: unknown): string {
  return value ? '是' : '否'
}

// ---- 各 libraryType 的导出函数 ----

function exportAssessment(payload: any): { sheetName: string; headers: string[]; rows: string[][] }[] {
  const instruments = Array.isArray(payload.instruments) ? payload.instruments : [payload]
  const sheets: { sheetName: string; headers: string[]; rows: string[][] }[] = []

  // ③ 量表-清单
  const instrumentHeaders = [
    '量表编码*', '量表名称*', '量表简称', '所属模块*', '版本*',
    '量表说明', '预计用时分钟*',
    '适用学部*', '适用年级', '适用学科',
    '施测对象*', '施测形式*', '触发方式*', '作答频次*', '是否必做*',
    '作答时限分钟', '最低题数', '使用时机', '重评间隔天数',
    '前置量表编码', '互斥量表编码',
    '结果可见性*', '责任角色', '数据敏感级*', '来源属性*',
    '外部授权说明', '手册出处*',
    '常模参照', '信度说明', '效度说明',
    '隐私声明', '适用前提', '不适合情况', '后续建议动作',
  ]
  const instrumentRows = instruments.map((inst: any) => [
    inst.code || inst.instrumentCode || '',
    inst.title || '',
    inst.shortName || '',
    inst.module || '',
    inst.version || '',
    inst.description || '',
    String(inst.estimatedMinutes ?? ''),
    inst.applicableSchoolSection || '',
    listStr(inst.applicableGrades),
    listStr(inst.applicableSubjects),
    inst.targetAudience || '',
    inst.formType || '',
    inst.triggerMethod || '',
    inst.frequency || '',
    boolStr(inst.isRequired),
    String(inst.timeLimitMinutes ?? ''),
    String(inst.minQuestions ?? ''),
    inst.usageTiming || '',
    String(inst.reAssessmentIntervalDays ?? ''),
    listStr(inst.prerequisiteCodes),
    listStr(inst.exclusiveCodes),
    inst.resultVisibility || '',
    inst.responsibleRole || '',
    inst.dataSensitivity || '',
    inst.sourceType || '',
    inst.externalAuthorizationNote || '',
    inst.sourceRef || '',
    inst.normReference || '',
    inst.reliabilityNote || '',
    inst.validityNote || '',
    inst.privacyNotice || '',
    inst.applicabilityPreconditions || '',
    inst.contraindications || '',
    inst.postAssessmentActions || '',
  ])
  sheets.push({ sheetName: '③ 量表-清单', headers: instrumentHeaders, rows: instrumentRows })

  // ④ 量表-题目
  const questionHeaders = [
    '量表编码*', '题号*', '题型*', '维度*', '子维度',
    '题干*', '题干举例', '选项组编码*',
    '反向计分*', '权重', '是否必答*', '显示条件', '数据用途*',
    '答题提示', '题目说明', '默认分值',
  ]
  const questionRows: string[][] = []
  for (const inst of instruments) {
    for (const q of inst.questions || []) {
      questionRows.push([
        inst.code || inst.instrumentCode || '',
        q.id || '',
        '', // 题型 — 当前版本未在 payload 中保存，留空
        q.dimension || '',
        q.subDimension || '',
        q.text || '',
        q.example || '',
        '', // 选项组编码 — 选项以内联形式在模板中，此处暂留空
        boolStr(q.reverse),
        String(q.weight ?? ''),
        boolStr(q.required !== false),
        q.displayCondition || '',
        q.dataUsage || '',
        '', // 答题提示
        q.questionNote || '',
        '', // 默认分值
      ])
    }
  }
  sheets.push({ sheetName: '④ 量表-题目', headers: questionHeaders, rows: questionRows })

  // ④b 量表-选项组
  const optionHeaders = ['选项组编码*', '选项顺序*', '选项文本*', '分值*']
  const optionRows: string[][] = []
  let optionGroupIndex = 0
  for (const inst of instruments) {
    for (const q of inst.questions || []) {
      if (!q.options?.length) continue
      optionGroupIndex++
      const groupCode = `OPT-${inst.code || inst.instrumentCode || 'X'}-${q.id || optionGroupIndex}`
      q.options.forEach((opt: any, oi: number) => {
        optionRows.push([
          groupCode,
          String(oi + 1),
          opt.label || '',
          String(opt.value ?? ''),
        ])
      })
    }
  }
  if (optionRows.length > 0) {
    sheets.push({ sheetName: '④b 量表-选项组', headers: optionHeaders, rows: optionRows })
  }

  // ④c 量表-维度定义
  const dimHeaders = [
    '量表编码*', '维度编码*', '维度名称*', '所属题号列表*',
    '计算方式*', '权重系数', '维度说明',
    '高分解释', '低分解释', '常模均值', '常模标准差',
  ]
  const dimRows: string[][] = []
  for (const inst of instruments) {
    for (const dim of inst.dimensionDefs || []) {
      dimRows.push([
        inst.code || inst.instrumentCode || '',
        dim.code || '',
        dim.name || '',
        listStr(dim.questionIds),
        dim.calcMethod || 'mean',
        String(dim.weight ?? ''),
        dim.description || '',
        dim.highInterpretation || '',
        dim.lowInterpretation || '',
        String(dim.normMean ?? ''),
        String(dim.normStd ?? ''),
      ])
    }
  }
  if (dimRows.length > 0) {
    sheets.push({ sheetName: '④c 量表-维度定义', headers: dimHeaders, rows: dimRows })
  }

  return sheets
}

function exportAttribution(payload: any): { sheetName: string; headers: string[]; rows: string[][] }[] {
  const sheets: { sheetName: string; headers: string[]; rows: string[][] }[] = []

  // ⑤b 归因-计算变量
  const varHeaders = ['变量名*', '所属模块*', '计算表达式*', '变量说明', '依赖量表编码', '依赖题号', '依赖维度编码']
  const varRows: string[][] = []
  const computed = payload.computed || {}
  for (const [key, expression] of Object.entries(computed)) {
    varRows.push([key, payload.module || '', String(expression), '', '', '', ''])
  }
  sheets.push({ sheetName: '⑤b 归因-计算变量', headers: varHeaders, rows: varRows })

  // ⑤c 归因-分级规则
  const branchHeaders = [
    '规则编码*', '所属模块*', '依据量表编码*', '优先级*', '触发条件',
    '命中等级*', '等级中文名*', '是否红线熔断*', '主归因*', '次归因',
    '归因理由*', '工具标签*', '结果说明*',
    '输出动作摘要', '输出工具摘要', '升级条件', '升级目标', '复评触发条件', '手册出处',
  ]
  const branchRows = (payload.branches || []).map((b: any) => [
    b.ruleId || '',
    payload.module || '',
    b.assessmentCode || '',
    String(b.pri ?? ''),
    b.when || '',
    b.level || '',
    b.levelName || '',
    boolStr(b.blocked),
    b.primaryAttribution || '',
    listStr(b.secondaryAttributions),
    listStr(b.reasons),
    listStr(b.toolTags),
    b.resultDescription || '',
    b.outputActionSummary || '',
    b.outputToolSummary || '',
    b.escalationCondition || '',
    b.escalationTarget || '',
    b.reEvaluationTrigger || '',
    b.sourceRef || '',
  ])
  sheets.push({ sheetName: '⑤c 归因-分级规则', headers: branchHeaders, rows: branchRows })

  // ⑥ 归因-红线熔断
  const rlHeaders = [
    '所属模块*', '红线条件*', '红线说明*', '熔断范围*',
    '处置要求*', '熔断后动作', '恢复条件', '责任人', '通知模板', '手册出处',
  ]
  const rlRows = (payload.redLines || []).map((rl: any) => [
    rl.module || payload.module || '',
    rl.condition || '',
    rl.description || '',
    rl.scope || 'module',
    rl.requiredActions || '',
    listStr(rl.actions),
    rl.recoveryCondition || '',
    rl.responsibleRole || '',
    rl.notificationTemplate || '',
    rl.sourceRef || '',
  ])
  if (rlRows.length > 0) {
    sheets.push({ sheetName: '⑥ 归因-红线熔断', headers: rlHeaders, rows: rlRows })
  }

  return sheets
}

function exportTool(payload: any): { sheetName: string; headers: string[]; rows: string[][] }[] {
  const tools = payload.tools || []
  const sheets: { sheetName: string; headers: string[]; rows: string[][] }[] = []

  // ⑦ 工具-处方总表
  const toolHeaders = [
    '工具编码*', '工具名称*', '工具简称', '所属模块*', '工具形式*',
    '适用学部*', '适用对象*', '适用症状场景*', '严重度*', '对应归因*',
    '工具标签*', '作用维度', '操作步骤摘要*',
    '关键话术', '预期效果*', '单次耗时', '疗程与频次', '重评间隔天数',
    '禁止事项*', '禁忌说明',
    '前置工具编码', '替代工具编码', '进阶工具编码',
    '证据等级*', '证据来源', '效果指标', '失败标准',
    '准备事项', '所需材料', '输出物', '协同工具编码',
    '手册出处*', '版本*', '跨模块标签',
  ]
  const toolRows = tools.map((t: any) => [
    t.code || '',
    t.name || '',
    t.shortName || '',
    payload.module || '',
    t.form || '',
    t.applicableSchoolSection || '',
    t.targetUsers || '',
    t.symptoms || '',
    t.severity || '',
    t.attribution || t.primaryAttribution || '',
    listStr(t.toolTags || t.tags),
    listStr(t.dimensions),
    listStr(t.steps),
    t.scripts || '',
    t.expectedEffect || '',
    t.timePerSession || '',
    t.duration || '',
    String(t.reAssessmentIntervalDays ?? ''),
    t.prohibitions || '',
    t.contraindicationNote || '',
    t.prerequisiteToolCode || '',
    t.alternativeToolCode || '',
    t.advancedToolCode || '',
    t.evidenceLevel || '',
    t.evidenceSource || '',
    t.outcomeIndicators || '',
    t.failureCriteria || '',
    t.preparationNeeded || '',
    t.materialsRequired || '',
    t.outputArtifact || '',
    listStr(t.collaborativeToolCodes),
    t.sourceRef || '',
    t.toolVersion || '',
    listStr(t.crossModuleTags),
  ])
  sheets.push({ sheetName: '⑦ 工具-处方总表', headers: toolHeaders, rows: toolRows })

  // ⑦b 工具-步骤明细
  const stepHeaders = [
    '工具编码*', '步骤序号*', '步骤标题*', '步骤说明*',
    '预计耗时', '所需材料', '关键提示', '话术模板', '成功标准', '常见问题',
  ]
  const stepRows: string[][] = []
  for (const t of tools) {
    for (const s of t.structuredSteps || []) {
      stepRows.push([
        t.code || '',
        String(s.seq ?? ''),
        s.title || '',
        s.description || '',
        s.estimatedTime || '',
        s.materials || '',
        s.keyTip || '',
        s.scriptTemplate || '',
        s.successCriteria || '',
        s.commonIssues || '',
      ])
    }
  }
  if (stepRows.length > 0) {
    sheets.push({ sheetName: '⑦b 工具-步骤明细', headers: stepHeaders, rows: stepRows })
  }

  // ⑧ 工具-禁忌规则
  const contraHeaders = [
    '工具编码*', '禁忌条件*', '禁忌类型*', '禁忌说明*',
    '替代建议', '适用教师群体', '依据',
  ]
  const contraRows: string[][] = []
  for (const t of tools) {
    for (const r of t.contraindicationRules || []) {
      contraRows.push([
        t.code || '',
        r.condition || '',
        r.type || 'warn',
        r.description || '',
        r.alternativeSuggestion || '',
        r.applicableTeacherGroup || '',
        r.reference || '',
      ])
    }
  }
  if (contraRows.length > 0) {
    sheets.push({ sheetName: '⑧ 工具-禁忌规则', headers: contraHeaders, rows: contraRows })
  }

  return sheets
}

function exportKeywordRoute(payload: any): { sheetName: string; headers: string[]; rows: string[][] }[] {
  const routes = payload.routes || []
  const headers = [
    '关键词编码*', '核心触发词*', '扩展词与近义表达', '排除词', '所属模块*',
    '匹配优先级*', '匹配模式', '风险等级*', '语义分类',
    '关联量表编码', '关联工具编码', '情境限定', '路由权重', '时效性', '场景描述',
  ]
  const rows = routes.map((r: any) => [
    r.code || '',
    r.coreKeywords || '',
    r.expandedKeywords || '',
    listStr(r.exclusionKeywords),
    r.module || payload.module || '',
    String(r.matchPriority ?? 0),
    r.matchMode || 'fuzzy',
    r.riskLevel || '',
    r.semanticCategory || '',
    r.linkedAssessmentCode || '',
    r.linkedToolCode || '',
    r.contextConstraint || '',
    String(r.routeWeight ?? ''),
    r.temporalValidity || 'always',
    r.description || '',
  ])
  return [{ sheetName: '⑨ 关键词-路由', headers, rows }]
}

function exportOutputTemplate(payload: any): { sheetName: string; headers: string[]; rows: string[][] }[] {
  const templates = payload.templates || []
  const headers = [
    '模板编码*', '所属模块*', '命中归因等级*', '模板类型*',
    '模板内容*', '占位符说明', '排序*',
  ]
  const rows = templates.map((t: any) => [
    t.code || '',
    t.module || payload.module || '',
    t.attributionLevel || '',
    t.type || 'summary',
    t.content || '',
    t.placeholders || '',
    String(t.order ?? 0),
  ])
  return [{ sheetName: '⑩ 方案输出模板', headers, rows }]
}

// ---- 主入口 ----

export function exportVersionToXlsx(libraryType: LibraryType, module: ModuleId, payload: any): XLSX.WorkBook {
  let sheetDefs: { sheetName: string; headers: string[]; rows: string[][] }[] = []

  switch (libraryType) {
    case 'assessment':
      sheetDefs = exportAssessment(payload)
      break
    case 'attribution':
      sheetDefs = exportAttribution(payload)
      break
    case 'tool':
      sheetDefs = exportTool(payload)
      break
    case 'keyword_route':
      sheetDefs = exportKeywordRoute(payload)
      break
    case 'output_template':
      sheetDefs = exportOutputTemplate(payload)
      break
    default:
      throw new Error(`不支持的库类型: ${libraryType}`)
  }

  const workbook = XLSX.utils.book_new()
  for (const { sheetName, headers, rows } of sheetDefs) {
    // 将表头和数据合并为一个二维数组
    const data = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(workbook, ws, sheetName)
  }

  return workbook
}
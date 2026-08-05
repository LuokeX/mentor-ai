/**
 * 将版本的 payload 反向转换为 V4 模板格式的 xlsx buffer。
 * 每个 libraryType 输出对应的 sheet 结构（与 business-libraries/templates/三库填写模板_v4.xlsx 一致），
 * 因此导出的文件可以直接改完再导回来。
 *
 * 归因库导出三张 sheet：⑤c 归因项 / ⑤d 证据规则 / ⑤e 分级规则。
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

  // ③ 量表-清单（列序与 v4 模板逐列一致，见 V4_HEADERS）
  const instrumentHeaders = [
    '量表编码*', '量表名称*', '量表简称', '所属模块*', '适用学部*', '适用年级', '适用学科',
    '施测对象*', '施测形式*', '触发方式*', '作答频次*', '是否必做*', '预计用时分钟*',
    '作答时限分钟', '最低题数', '使用时机', '重评间隔天数', '前置量表编码', '互斥量表编码',
    '触发条件', '触发条件说明', '结果可见性*', '责任角色', '数据敏感级*', '来源属性*',
    '外部授权说明', '手册出处*', '版本*', '量表说明', '常模参照', '信度说明', '效度说明',
    '隐私声明', '适用前提', '不适合情况', '后续建议动作', '量表角色*', '做完导向什么*',
  ]
  const instrumentRows = instruments.map((inst: any) => [
    inst.code || inst.instrumentCode || '',
    inst.title || '',
    inst.shortName || '',
    inst.module || '',
    inst.applicableSchoolSection || '',
    listStr(inst.applicableGrades),
    listStr(inst.applicableSubjects),
    inst.targetAudience || '',
    inst.formType || '',
    inst.triggerMethod || '',
    inst.frequency || '',
    boolStr(inst.isRequired),
    String(inst.estimatedMinutes ?? ''),
    String(inst.timeLimitMinutes ?? ''),
    String(inst.minQuestions ?? ''),
    inst.usageTiming || '',
    String(inst.reAssessmentIntervalDays ?? ''),
    listStr(inst.prerequisiteCodes),
    listStr(inst.exclusiveCodes),
    inst.triggerCondition || '',
    inst.triggerConditionNote || '',
    inst.resultVisibility || '',
    inst.responsibleRole || '',
    inst.dataSensitivity || '',
    inst.sourceType || '',
    inst.externalAuthorizationNote || '',
    inst.sourceRef || '',
    inst.version || '',
    inst.description || '',
    inst.normReference || '',
    inst.reliabilityNote || '',
    inst.validityNote || '',
    inst.privacyNotice || '',
    inst.applicabilityPreconditions || '',
    inst.contraindications || '',
    inst.postAssessmentActions || '',
    inst.instrumentRole || '',
    '', // 做完导向什么 — payload 不保存（模板里是给业务看的定位说明），导出留空
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
      // 与下方 ④b 的生成规则保持一致：OPT-<量表编码>-<题号>
      const groupCode = `OPT-${inst.code || inst.instrumentCode || 'X'}-${q.id || ''}`
      questionRows.push([
        inst.code || inst.instrumentCode || '',
        q.id || '',
        '', // 题型 — 当前版本未在 payload 中保存，留空
        q.dimension || '',
        q.subDimension || '',
        q.text || '',
        q.example || '',
        groupCode,
        boolStr(q.reverse),
        String(q.weight ?? ''),
        boolStr(q.required !== false),
        q.displayCondition || '',
        q.dataUsage || '',
        q.help || '',
        q.questionNote || '',
        '', // 默认分值
      ])
    }
  }
  sheets.push({ sheetName: '④ 量表-题目', headers: questionHeaders, rows: questionRows })

  // ④b 量表-选项组
  const optionHeaders = ['选项组编码*', '选项顺序*', '选项文本*', '分值*']
  const optionRows: string[][] = []
  for (const inst of instruments) {
    for (const q of inst.questions || []) {
      if (!q.options?.length) continue
      const groupCode = `OPT-${inst.code || inst.instrumentCode || 'X'}-${q.id || ''}`
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

  // ⑤c 归因项
  const attributionItemHeaders = [
    '归因编码*', '归因名称*', '所属模块*', '权重基数*', '工具标签*',
    '归因说明', '高分表现', '典型诱因', '建议动作', '手册出处',
  ]
  const attributionItemRows = (payload.attributionItems || []).map((item: any) => [
    item.code || '',
    item.name || '',
    item.module || payload.module || '',
    String(item.baseWeight ?? 1),
    listStr(item.toolTags),
    item.description || '',
    item.highManifestation || '',
    item.typicalTrigger || '',
    item.suggestedAction || '',
    item.sourceRef || '',
  ])
  sheets.push({ sheetName: '⑤c 归因项', headers: attributionItemHeaders, rows: attributionItemRows })

  // ⑤d 证据规则
  const evidenceHeaders = [
    '证据编码*', '归因编码*', '依据量表编码*', '触发条件*', '证据权重*', '证据说明*', '手册出处',
  ]
  const evidenceRows = (payload.evidences || []).map((evidence: any) => [
    evidence.evidenceCode || '',
    evidence.attributionCode || '',
    evidence.assessmentCode || '',
    evidence.condition || '',
    String(evidence.weight ?? 1),
    evidence.description || '',
    evidence.sourceRef || '',
  ])
  sheets.push({ sheetName: '⑤d 证据规则', headers: evidenceHeaders, rows: evidenceRows })

  // ⑤e 分级规则
  const gradingHeaders = [
    '规则编码*', '所属模块*', '依据量表编码', '优先级*', '触发条件',
    '命中等级*', '等级中文名*', '严重度*', '是否红线熔断*', '结果说明*',
    '升级条件', '升级目标', '复评触发条件', '干预工具', '干预动作', '手册出处',
  ]
  const gradingRows = (payload.gradingRules || []).map((rule: any) => [
    rule.ruleId || '',
    payload.module || '',
    rule.assessmentCode || '',
    String(rule.pri ?? ''),
    rule.when || '',
    rule.level || '',
    rule.levelName || '',
    rule.severity || '',
    boolStr(rule.blocked),
    rule.resultDescription || '',
    rule.escalationCondition || '',
    rule.escalationTarget || '',
    rule.reEvaluationTrigger || '',
    listStr(rule.interventionTools),
    // 干预动作与导入端 splitActions 对齐：只按分号/换行分割（动作文案里常见中文逗号）
    Array.isArray(rule.interventionActions) ? rule.interventionActions.map(String).join('；') : '',
    rule.sourceRef || '',
  ])
  sheets.push({ sheetName: '⑤e 分级规则', headers: gradingHeaders, rows: gradingRows })

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
    '适用学部*', '适用对象*', '适用症状场景*', '严重度*', '对应归因编码*',
    '对应归因名称', '工具标签*', '作用维度编码', '效果说明', '操作步骤摘要*',
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
    (t.attributionCodes?.length ? t.attributionCodes.join(';') : t.attributionCode) || '',
    t.attributionLabel || '',
    listStr(t.toolTags || t.tags),
    listStr(t.dimensions),
    t.effectNote || '',
    // 步骤摘要：导入端按「；」或换行拆分，必须用「；」连接（逗号连接会拆不开）
    Array.isArray(t.steps) ? t.steps.join('；') : String(t.steps || ''),
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
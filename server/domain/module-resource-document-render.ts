import { attributionConfigSchema, toolLibraryPayloadSchema } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'

/**
 * 三库版本导入知识库的文档渲染器：
 * 把「量表库 / 归因库 / 工具库」的版本 payload 渲染成 markdown 知识文档，
 * 供知识库入库前生成 title/content。所有字段都可能缺失或为空数组，
 * 缺失的字段不渲染对应行；完全无可渲染内容时 content 返回空字符串。
 */

/** 模块编码 → 中文名（标题用） */
const MODULE_NAMES: Record<string, string> = {
  self_growth: '自我成长',
  class_system: '班级系统',
  home_school: '家校沟通',
  student_case: '学生个案',
  learning_problem: '学习问题'
}

export function renderVersionDocument(input: {
  libraryType: 'assessment' | 'attribution' | 'tool'
  module: string
  libraryName: string
  version: string
  payload: Record<string, unknown>
}): { title: string; content: string } {
  const title = `${input.libraryName}（${MODULE_NAMES[input.module] ?? input.module}）v${input.version}`
  let content = ''
  if (input.libraryType === 'assessment') content = renderAssessment(input.payload)
  else if (input.libraryType === 'attribution') content = renderAttribution(input.payload)
  else content = renderTool(input.payload)
  return { title, content }
}

// ---- 私有辅助（不导出）----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空字符串才返回，否则 null（缺失/空串不渲染该行） */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** 有限数字才返回，否则 null */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ---- 量表库 ----

function isAssessmentDefinition(value: unknown): value is AssessmentDefinition {
  if (!isRecord(value)) return false
  return typeof value.title === 'string' && Boolean(value.title.trim()) && Array.isArray(value.questions)
}

function renderAssessment(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.instruments)) return ''
  const instruments = payload.instruments.filter(isAssessmentDefinition)
  const sections: string[] = []
  for (const instrument of instruments) {
    const lines: string[] = [`## 量表：${instrument.title}`]
    const description = str(instrument.description)
    if (description) lines.push(description)
    const estimatedMinutes = num(instrument.estimatedMinutes)
    if (estimatedMinutes !== null) lines.push(`预计用时：${estimatedMinutes} 分钟`)

    if (Array.isArray(instrument.dimensionDefs) && instrument.dimensionDefs.length) {
      lines.push('### 维度说明')
      for (const dim of instrument.dimensionDefs) {
        if (!isRecord(dim)) continue
        const code = str(dim.code)
        const name = str(dim.name)
        const desc = str(dim.description)
        if (!code && !name) continue
        lines.push(`- ${code ? `${code} ` : ''}${name ?? ''}${desc ? `：${desc}` : ''}`)
      }
    }

    const questions = instrument.questions.filter(isRecord)
    if (questions.length) {
      lines.push('### 题目')
      questions.forEach((question, index) => {
        const text = str(question.text)
        if (!text) return
        const dimension = str(question.dimension)
        // AssessmentQuestion 类型只有 dimension，subDimension 是导入数据里存在的扩展字段
        const subDimension = str((question as unknown as Record<string, unknown>)['subDimension'])
        const dimensionText = dimension ? (subDimension ? `${dimension}/${subDimension}` : dimension) : (subDimension ?? '')
        lines.push(`${index + 1}. ${text}${dimensionText ? `【维度：${dimensionText}】` : ''}`)
        if (Array.isArray(question.options)) {
          for (const option of question.options) {
            if (!isRecord(option)) continue
            const label = str(option.label)
            if (!label) continue
            const value = num(option.value)
            lines.push(`   - ${label}${value !== null ? `（${value} 分）` : ''}`)
          }
        }
      })
    }
    sections.push(lines.join('\n'))
  }
  return sections.join('\n\n')
}

// ---- 归因库 ----

function renderAttribution(payload: Record<string, unknown>): string {
  const parsed = attributionConfigSchema.safeParse(payload)
  if (!parsed.success) return ''
  const config = parsed.data
  const sections: string[] = []

  if (config.attributionItems.length) {
    const lines: string[] = ['## 归因项']
    for (const item of config.attributionItems) {
      lines.push(`### ${item.name}`)
      if (item.description) lines.push(`- 描述：${item.description}`)
      if (item.highManifestation) lines.push(`- 高发表现：${item.highManifestation}`)
      if (item.typicalTrigger) lines.push(`- 典型触发：${item.typicalTrigger}`)
      if (item.suggestedAction) lines.push(`- 建议动作：${item.suggestedAction}`)
      if (item.sourceRef) lines.push(`- 来源：${item.sourceRef}`)
    }
    sections.push(lines.join('\n'))
  }

  if (config.evidences.length) {
    const lines: string[] = ['## 证据规则']
    for (const evidence of config.evidences) {
      lines.push(`### ${evidence.evidenceCode}（归因：${evidence.attributionCode}）`)
      lines.push(`- 量表：${evidence.assessmentCode}`)
      lines.push(`- 条件：${evidence.condition}`)
      lines.push(`- 说明：${evidence.description}`)
      if (evidence.weight !== undefined) lines.push(`- 权重：${evidence.weight}`)
      if (evidence.sourceRef) lines.push(`- 来源：${evidence.sourceRef}`)
    }
    sections.push(lines.join('\n'))
  }

  if (config.gradingRules.length) {
    const lines: string[] = ['## 分级规则']
    for (const rule of config.gradingRules) {
      lines.push(`### ${rule.ruleId}`)
      const levelName = rule.levelName ? `（${rule.levelName}）` : ''
      lines.push(`- 等级：${rule.level}${levelName}`)
      lines.push(`- 严重度：${rule.severity}`)
      if (rule.when) lines.push(`- 条件：${rule.when}`)
      if (rule.resultDescription) lines.push(`- 结果说明：${rule.resultDescription}`)
      if (rule.escalationCondition) lines.push(`- 升级条件：${rule.escalationCondition}`)
      if (rule.escalationTarget) lines.push(`- 升级目标：${rule.escalationTarget}`)
      if (rule.reEvaluationTrigger) lines.push(`- 再评估触发：${rule.reEvaluationTrigger}`)
      if (rule.interventionTools.length) lines.push(`- 干预工具：${rule.interventionTools.join('、')}`)
      if (rule.interventionActions.length) lines.push(`- 干预动作：${rule.interventionActions.join('、')}`)
      if (rule.sourceRef) lines.push(`- 来源：${rule.sourceRef}`)
    }
    sections.push(lines.join('\n'))
  }

  if (config.redLines.length) {
    const lines: string[] = ['## 红线熔断规则']
    for (const rule of config.redLines) {
      lines.push(`### ${rule.condition}`)
      lines.push(`- 说明：${rule.description}`)
      lines.push(`- 范围：${rule.scope}`)
      lines.push(`- 必做动作：${rule.requiredActions}`)
      if (rule.actions.length) lines.push(`- 动作清单：${rule.actions.join('、')}`)
      if (rule.recoveryCondition) lines.push(`- 恢复条件：${rule.recoveryCondition}`)
      if (rule.responsibleRole) lines.push(`- 责任角色：${rule.responsibleRole}`)
      if (rule.notificationTemplate) lines.push(`- 通知模板：${rule.notificationTemplate}`)
      if (rule.sourceRef) lines.push(`- 来源：${rule.sourceRef}`)
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}

// ---- 工具库 ----

function renderTool(payload: Record<string, unknown>): string {
  const parsed = toolLibraryPayloadSchema.safeParse(payload)
  if (!parsed.success) return ''
  const sections: string[] = []
  for (const tool of parsed.data.tools) {
    const lines: string[] = [`## ${tool.name}`]
    if (tool.form) lines.push(`- 形式：${tool.form}`)
    if (tool.symptoms) lines.push(`- 适用症状：${tool.symptoms}`)
    if (tool.expectedEffect) lines.push(`- 预期效果：${tool.expectedEffect}`)
    if (tool.targetUsers) lines.push(`- 目标人群：${tool.targetUsers}`)
    if (tool.evidenceLevel) {
      lines.push(`- 证据等级：${tool.evidenceLevel}${tool.evidenceSource ? `（来源：${tool.evidenceSource}）` : ''}`)
    }
    if (tool.effectNote) lines.push(`- 效果说明：${tool.effectNote}`)
    if (tool.outcomeIndicators) lines.push(`- 成果指标：${tool.outcomeIndicators}`)
    if (tool.failureCriteria) lines.push(`- 失败标准：${tool.failureCriteria}`)
    if (tool.preparationNeeded) lines.push(`- 准备事项：${tool.preparationNeeded}`)
    if (tool.materialsRequired) lines.push(`- 所需材料：${tool.materialsRequired}`)
    if (tool.outputArtifact) lines.push(`- 产出物：${tool.outputArtifact}`)
    if (tool.contraindicationNote) lines.push(`- 禁忌说明：${tool.contraindicationNote}`)
    if (tool.steps.length) {
      lines.push(`- 操作步骤：${tool.steps.map((step, index) => `${index + 1}. ${step}`).join('；')}`)
    }
    if (tool.scripts) lines.push(`- 话术脚本：${tool.scripts}`)
    if (tool.prohibitions) lines.push(`- 注意事项：${tool.prohibitions}`)

    if (tool.structuredSteps?.length) {
      lines.push('### 结构化步骤')
      for (const step of tool.structuredSteps) {
        lines.push(`#### ${step.seq}. ${step.title}`)
        if (step.description) lines.push(`- 说明：${step.description}`)
        if (step.estimatedTime) lines.push(`- 预计时间：${step.estimatedTime}`)
        if (step.materials) lines.push(`- 材料：${step.materials}`)
        if (step.keyTip) lines.push(`- 关键提示：${step.keyTip}`)
        if (step.scriptTemplate) lines.push(`- 话术模板：${step.scriptTemplate}`)
        if (step.successCriteria) lines.push(`- 成功标准：${step.successCriteria}`)
        if (step.commonIssues) lines.push(`- 常见问题：${step.commonIssues}`)
      }
    }

    if (tool.contraindicationRules?.length) {
      lines.push('### 禁忌规则')
      for (const rule of tool.contraindicationRules) {
        lines.push(`- ${rule.type === 'block' ? '禁止' : '警告'}：${rule.condition}`)
        if (rule.description) lines.push(`  - 说明：${rule.description}`)
        if (rule.alternativeSuggestion) lines.push(`  - 替代建议：${rule.alternativeSuggestion}`)
        if (rule.applicableTeacherGroup) lines.push(`  - 适用教师群体：${rule.applicableTeacherGroup}`)
        if (rule.reference) lines.push(`  - 参考：${rule.reference}`)
      }
    }

    if (tool.sourceRef) lines.push(`- 来源：${tool.sourceRef}`)
    sections.push(lines.join('\n'))
  }
  return sections.join('\n\n')
}
// 工具库 transformer：将各种格式的工具 xlsx → ToolRxEntry[]
import type { ToolRxEntry } from '../../../shared/contracts'
import { readXlsxFile, extractValue } from '../xlsx-reader'

/**
 * 处方总表格式 (self_growth, student_case):
 *   编号, 处方名称, 处方形式, 适用症状/场景, 预期效果, 严重度分级, 疗程与频次, 单次耗时, 操作步骤（详细）, 关键话术, 禁止事项, 适用对象, 作用维度
 */
function parseRxFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => name.includes('总表') || name.includes('处方') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['编号'] || row['处方编号'] || ''
      const name = row['处方名称'] || row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['操作步骤（详细）'] || row['操作步骤'] || row['核心操作'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code,
        name,
        form: row['处方形式'] || row['工具类型'] || '',
        symptoms: row['适用症状/场景'] || row['适用问题/场景'] || '',
        expectedEffect: row['预期效果'] || undefined,
        severity: row['严重度分级'] || undefined,
        duration: row['疗程与频次'] || undefined,
        timePerSession: row['单次耗时'] || undefined,
        steps,
        scripts: row['关键话术'] || undefined,
        prohibitions: row['禁止事项'] || undefined,
        targetUsers: row['适用对象'] || undefined,
        dimensions: (row['作用维度'] || row['维度'] || '')?.split(/[,，、+]/).map(d => d.trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

/**
 * 班级系统工具索引格式 (class_system):
 *   工具ID, 工具名称, 所属模块, 适用问题/场景, 核心操作(摘要), 手册出处, 配套评估ID, 平台入口标识, 整理状态
 */
function parseClassSystemFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => name.includes('索引') || name.includes('工具') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['工具ID'] || ''
      const name = row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['核心操作(摘要)'] || row['核心操作'] || row['操作步骤'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code,
        name,
        form: row['所属模块'] || row['模块'] || '',
        symptoms: row['适用问题/场景'] || row['适用场景'] || '',
        steps,
        scripts: undefined,
        prohibitions: undefined,
        dimensions: [row['所属模块'] || ''].filter(Boolean),
      })
    }
  }

  return entries
}

/**
 * 家校沟通工具库格式 (home_school):
 *   模块编码, 模块名称, 所属类别, 模块说明, 解决处理路径, 核心方法_工具, 关联技术标签, 适用场景_触发条件, 责任角色, 输出物, 来源手册章节
 */
function parseHomeSchoolFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { headerRowIndex: 1, sheetFilter: name => name.includes('工具库') && !name.includes('说明') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['模块编码'] || ''
      const name = row['模块名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['解决处理路径'] || row['核心方法_工具'] || ''
      const steps = stepsRaw.split(/[;；]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code,
        name,
        form: row['所属类别'] || '',
        symptoms: row['适用场景_触发条件'] || row['模块说明'] || '',
        steps,
        scripts: undefined,
        prohibitions: undefined,
        targetUsers: row['责任角色'] || undefined,
        dimensions: (row['关联技术标签'] || '')?.split(/[;；]/).map(d => d.trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

/**
 * 学习问题工具库格式 (learning_problem): 多 Sheet，每 Sheet 一个流程阶段
 *   工具ID, 工具名称, 子维度, 工具类型, 适用人群, 适用学段, 触发情景（调用条件）, 工具说明（可直接使用）, 具体操作步骤, 输出物, 关联/协同工具
 */
function parseLearningProblemFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => !name.includes('说明') && !name.includes('总表') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['工具ID'] || ''
      const name = row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['具体操作步骤'] || row['操作步骤'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code,
        name,
        form: row['工具类型'] || '',
        symptoms: row['触发情景（调用条件）'] || row['触发情景'] || row['工具说明'] || '',
        expectedEffect: row['输出物'] || undefined,
        steps,
        scripts: undefined,
        prohibitions: undefined,
        targetUsers: row['适用人群'] || undefined,
        dimensions: (row['子维度'] || row['关联/协同工具'] || '')?.split(/[,，、→]/).map(d => d.replace(/[←→]/g, '').trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

type ToolFileFormat = 'rx' | 'class_system' | 'home_school' | 'learning_problem'

export function parseToolFile(filePath: string, format: ToolFileFormat): ToolRxEntry[] {
  switch (format) {
    case 'rx': return parseRxFormat(filePath)
    case 'class_system': return parseClassSystemFormat(filePath)
    case 'home_school': return parseHomeSchoolFormat(filePath)
    case 'learning_problem': return parseLearningProblemFormat(filePath)
  }
}

/**
 * 批量导入（整套替换）的辅助逻辑。
 *
 * 语义与 wizard-import 一致：本次上传的几个库互为对侧，
 * 而不是拿库里现行的旧版本做对侧——旧归因库引用旧量表，
 * 拿旧归因校验新量表会得到必然失败的结果。
 */
import type { AssessmentDefinition } from '../../shared/assessments'
import type { AttributionConfig, LibraryType } from '../../shared/contracts'
import type { ModuleResourceCounterpart } from './module-resource-validation'

export const BATCH_LIBRARY_TYPES: LibraryType[] = ['assessment', 'attribution', 'tool', 'output_template', 'keyword_route']

export const BATCH_LIBRARY_LABEL: Record<string, string> = {
  assessment: '量表库', attribution: '归因库', tool: '工具库',
  keyword_route: '关键词路由库', output_template: '输出模板库'
}

export const BATCH_MODULE_LABEL: Record<string, string> = {
  self_growth: '自我成长赋能', class_system: '班级系统建设', home_school: '家校沟通合作',
  student_case: '学生个体问题', learning_problem: '学生学习问题'
}

/** assessment payload 里提取全部量表（单量表或 instruments 数组） */
export function assessmentInstrumentsFromPayload(payload: Record<string, unknown>): AssessmentDefinition[] {
  return Array.isArray(payload.instruments)
    ? payload.instruments as unknown as AssessmentDefinition[]
    : [payload as unknown as AssessmentDefinition]
}

/**
 * 批量场景下某库的对侧资源：优先用本次一并上传的对侧库，
 * 没上传才回退现行已发布版本。
 */
export function buildBatchCounterpart(
  uploaded: Map<LibraryType, Record<string, unknown>>,
  current: ModuleResourceCounterpart,
  libraryType: LibraryType
): ModuleResourceCounterpart {
  if (libraryType === 'assessment') {
    const attribution = uploaded.get('attribution')
    // attribution 库的 payload 本身就是 AttributionConfig（与 resolveAttributionConfig 返回一致）
    if (attribution) return { attributionConfig: attribution as unknown as AttributionConfig }
    return { attributionConfig: current.attributionConfig ?? null }
  }
  if (libraryType === 'attribution') {
    const assessment = uploaded.get('assessment')
    if (assessment) {
      const instruments = assessmentInstrumentsFromPayload(assessment)
      return { assessmentDefinition: instruments[0], assessmentInstruments: instruments }
    }
    return {
      assessmentDefinition: current.assessmentDefinition ?? null,
      assessmentInstruments: current.assessmentInstruments ?? null
    }
  }
  return {}
}
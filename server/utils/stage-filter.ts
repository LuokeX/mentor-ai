/**
 * 学段过滤开关与查看者学段解析（三库资源 / 知识库文档的「适用学部」）。
 *
 * 设计：标签与数据一直保留，是否按学段过滤由 `SCHOOL_SECTION_FILTER_ENABLED` 决定，
 * 默认**关闭**。关闭时所有调用方拿到的学段集合都是空数组，等价于「查看者学段未知」——
 * 按 shared/school-section.ts 的口径即不过滤，任何人看到的内容与加标签之前一致。
 * 内容按学段细分完成后，把 `NUXT_SCHOOL_SECTION_FILTER_ENABLED=true` 打开即可生效，
 * 不需要改代码或重导数据。
 *
 * 为什么默认关闭：试点初期内容整片标同一个学部时，过滤结果永远是「该学段全中」或
 * 「空集回退全部」，既没有分流收益，又让「为什么标了还都看得到」难以解释；
 * 等真的按学段拆分内容后再开。
 */
import type { H3Event } from 'h3'
import { schoolSectionsOfGrades, type SchoolSection } from '../../shared/school-section'

/** 学段过滤是否启用（未显式开启即为关闭）。 */
export function stageFilterEnabled(event: H3Event): boolean {
  try {
    return useRuntimeConfig(event).schoolSectionFilterEnabled === true
  } catch {
    // 没有 Nitro 上下文（脚本、单测）时按关闭处理：宁可不过滤，也不要因为读不到配置把内容藏起来
    return false
  }
}

/**
 * 查看者学段：开关关闭时恒为空数组（= 不过滤），开启时按教师任教年级折算
 * （1-6 小学、7-9 初中、10-12 高中）。
 */
export function viewerSchoolSections(event: H3Event, grades: readonly number[] | null | undefined): SchoolSection[] {
  return stageFilterEnabled(event) ? schoolSectionsOfGrades(grades) : []
}

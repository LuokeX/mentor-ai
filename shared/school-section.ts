/**
 * 学部（学段）标签：三库资源与知识库文档用它声明适用范围，运行时按教师任教年级过滤。
 *
 * 取值与三库填写模板「② 枚举字典」的「适用学部」一致：
 *   all 全学部 / primary 小学部 / junior 初中部 / senior 高中部 / repeat 复读部
 * 年级（1-12）是更细的一层：只在「适用年级」列标注与展示，不参与过滤判断。
 *
 * 可见性口径（与产品确认过的默认规则一致）：
 *   1. 标 all 或没标学部的资源 → 任何学段可见；
 *   2. 标了具体学部的资源 → 只有查看者学段包含它时才可见；
 *   3. 查看者学段未知（教师没填任教年级）→ 不过滤，一律可见（不因为缺资料而藏内容）；
 *   4. 过滤后候选为空 → 回退到不过滤（宁可多给，也不要整页/整轮没有可用内容）。
 */

export const SCHOOL_SECTIONS = ['all', 'primary', 'junior', 'senior', 'repeat'] as const
export type SchoolSection = (typeof SCHOOL_SECTIONS)[number]

export const SCHOOL_SECTION_LABELS: Record<SchoolSection, string> = {
  all: '全学部',
  primary: '小学部',
  junior: '初中部',
  senior: '高中部',
  repeat: '复读部'
}

/** 年级 → 学部：1-6 小学、7-9 初中、10-12 高中；0 与越界值返回 null（视为未标注）。 */
export function schoolSectionOfGrade(grade: number): SchoolSection | null {
  if (!Number.isFinite(grade)) return null
  if (grade >= 1 && grade <= 6) return 'primary'
  if (grade >= 7 && grade <= 9) return 'junior'
  if (grade >= 10 && grade <= 12) return 'senior'
  return null
}

/** 任教年级 → 去重后的学部集合（如 [6, 7] → ['primary', 'junior']）。空数组表示学段未知。 */
export function schoolSectionsOfGrades(grades: readonly number[] | null | undefined): SchoolSection[] {
  const sections = new Set<SchoolSection>()
  for (const grade of grades ?? []) {
    const section = schoolSectionOfGrade(Number(grade))
    if (section) sections.add(section)
  }
  return [...sections]
}

/** 归一化资源上的学段标签：非法值或缺省一律视为 all（所有人可见）。 */
export function normalizeSchoolSection(value: unknown): SchoolSection {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return (SCHOOL_SECTIONS as readonly string[]).includes(normalized)
    ? normalized as SchoolSection
    : 'all'
}

/** 单个资源是否对当前学段可见（口径见文件头）。 */
export function isSchoolSectionVisible(
  resourceSection: unknown,
  viewerSections: readonly SchoolSection[] | null | undefined
): boolean {
  const section = normalizeSchoolSection(resourceSection)
  if (section === 'all') return true
  if (!viewerSections?.length) return true
  return viewerSections.includes(section)
}

/**
 * 按学段过滤一批带标签的行。
 * 过滤后为空（且原本有行）时回退到不过滤，并置 fallback: true，调用方可据此说明
 * 「当前学段没有专属资源，下面是全部资源」，而不是把内容整片藏掉。
 */
export function filterBySchoolSection<T>(
  rows: readonly T[],
  sectionOf: (row: T) => unknown,
  viewerSections: readonly SchoolSection[] | null | undefined
): { rows: T[], fallback: boolean } {
  if (!viewerSections?.length) return { rows: [...rows], fallback: false }
  const matched = rows.filter(row => isSchoolSectionVisible(sectionOf(row), viewerSections))
  if (matched.length) return { rows: matched, fallback: false }
  return { rows: [...rows], fallback: rows.length > 0 }
}

/**
 * 从三库版本 payload 的资源行（量表 `instruments` / 工具 `tools`）推导文档级学部标签。
 *
 * 用途：把三库版本渲染成一篇知识库文档时（平台后台「从三库导入」），文档只有一个
 * 学部字段，而版本内各行可以各自带学段。推导口径偏保守：
 *   - 所有行标了同一个具体学部 → 取该值（例如整版都是小学部内容）；
 *   - 行内学段混杂、全是 all、没有该字段或没有行 → all（宁可多给，不可少给）。
 */
export function schoolSectionOfResourceRows(rows: readonly unknown[] | null | undefined): SchoolSection {
  const sections = new Set<SchoolSection>()
  for (const row of rows ?? []) {
    if (!row || typeof row !== 'object') continue
    sections.add(normalizeSchoolSection((row as { applicableSchoolSection?: unknown }).applicableSchoolSection))
  }
  return sections.size === 1 ? [...sections][0]! : 'all'
}

/**
 * 取三库版本 payload 里带学段标签的资源行：量表取 `instruments`、工具取 `tools`，
 * 归因库等其它库没有该字段（返回空数组，`schoolSectionOfResourceRows` 会得到 all）。
 */
export function resourceRowsOfVersion(libraryType: string, payload: unknown): Array<Record<string, unknown>> {
  const key = libraryType === 'assessment' ? 'instruments' : libraryType === 'tool' ? 'tools' : null
  if (!key) return []
  const rows = (payload as Record<string, unknown> | null | undefined)?.[key]
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
}

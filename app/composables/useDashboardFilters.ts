import type { LocationQuery } from 'vue-router'

/**
 * 数据驾驶舱的全局下钻状态（学校 › 年级 › 班级），四个看板页面共用。
 *
 * 状态本身放在 URL 查询里（`grade` / `classIds`），因此：
 * - 切换页面（总览 / AI 问答 / 量表与方案 / 预警）时筛选不丢；
 * - 刷新或复制链接可以复现同一视图；
 * - 页面里的年级下拉、班级多选与面包屑读写的是同一份状态，不会出现两套口径。
 *
 * 越界班级由服务端与本校班级取交集，前端不自行判断权限；年级主任的可见年级
 * 已由服务端 scope 收窄，这里只负责把已选的层级带进查询。
 */
export function useDashboardFilters() {
  const route = useRoute()
  const router = useRouter()

  const parseGrade = (raw: LocationQuery[string] | undefined): number | '' => {
    const text = Array.isArray(raw) ? raw[0] : raw
    const value = Number(text)
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : ''
  }

  const parseClassIds = (raw: LocationQuery[string] | undefined): string[] => {
    const text = Array.isArray(raw) ? raw[0] : raw
    if (!text) return []
    return String(text).split(',').map(item => item.trim()).filter(Boolean)
  }

  /** 只改写 grade / classIds 两个键，其余查询参数（如未来的 deep link）原样保留。 */
  function patchQuery(next: { grade?: string, classIds?: string }) {
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      if (key === 'grade' || key === 'classIds') continue
      if (typeof value === 'string' && value) query[key] = value
    }
    if (next.grade) query.grade = next.grade
    if (next.classIds) query.classIds = next.classIds
    void router.replace({ query })
  }

  /** 年级（'' = 全校/学部范围）。选择年级会清空已选班级：下钻一层只保留一层筛选。 */
  const grade = computed<number | ''>({
    get: () => parseGrade(route.query.grade),
    set: (value) => patchQuery({
      grade: value === '' ? undefined : String(value),
      classIds: value === '' ? (classIds.value.length ? classIds.value.join(',') : undefined) : undefined
    })
  })

  /** 班级多选（空数组 = 不限班级）。 */
  const classIds = computed<string[]>({
    get: () => parseClassIds(route.query.classIds),
    set: (value) => patchQuery({
      grade: grade.value === '' ? undefined : String(grade.value),
      classIds: value.length ? value.join(',') : undefined
    })
  })

  /** 面包屑：回到学校层级（清空年级与班级）。 */
  const resetToSchool = () => patchQuery({})
  /** 面包屑 / 对比表：下钻到某个年级（清空班级）。 */
  const drillToGrade = (value: number) => patchQuery({ grade: String(value) })
  /** 面包屑：回退到年级层级（清空班级，保留年级）。 */
  const drillToGradeLevel = () => patchQuery({ grade: grade.value === '' ? undefined : String(grade.value) })
  /** 下钻到具体班级（保留年级）。 */
  const drillToClasses = (ids: readonly string[]) => patchQuery({
    grade: grade.value === '' ? undefined : String(grade.value),
    classIds: ids.length ? ids.join(',') : undefined
  })

  return { grade, classIds, resetToSchool, drillToGrade, drillToGradeLevel, drillToClasses }
}

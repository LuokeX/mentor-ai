/**
 * 家长展示文案：把「真实姓名 · 关系」改成班主任更熟悉的「某生爸爸（真实姓名）」。
 *
 * - 优先使用学生-家长关联上的 relation（同一家长对不同学生可以是爸爸/爷爷）；
 * - 没有关联学生时回退旧格式「王强 · 父亲」，避免影响家长独立页面；
 * - 多个学生时按关系分组，如「王五爸爸、王六爷爷（王强）」。
 */

export function guardianRelationLabel(relation?: string | null): string {
  const text = String(relation ?? '').trim()
  if (!text) return '家长'
  if (text === '父亲' || text === '爸爸') return '爸爸'
  if (text === '母亲' || text === '妈妈') return '妈妈'
  if (text === '祖父' || text === '爷爷') return '爷爷'
  if (text === '祖母' || text === '奶奶') return '奶奶'
  if (text === '外祖父' || text === '外公') return '外公'
  if (text === '外祖母' || text === '外婆' || text === '姥姥') return '外婆'
  if (text === '其他监护人' || text === '其他') return '家长'
  return text
}

export interface GuardianDisplayLink {
  studentName: string
  relation?: string | null
}

export function guardianDisplayLabel(
  links: readonly GuardianDisplayLink[],
  guardianName: string | null | undefined,
  fallbackRelation?: string | null
): string {
  const name = String(guardianName ?? '').trim()
  const validLinks = links
    .map(link => ({ studentName: String(link.studentName ?? '').trim(), relation: link.relation }))
    .filter(link => link.studentName)
  if (!validLinks.length) {
    const relation = String(fallbackRelation ?? '').trim()
    if (name && relation) return `${name} · ${relation}`
    return name || '家长'
  }

  const groups = new Map<string, string[]>()
  for (const link of validLinks) {
    const relationLabel = guardianRelationLabel(link.relation)
    const names = groups.get(relationLabel) ?? []
    if (!names.includes(link.studentName)) names.push(link.studentName)
    groups.set(relationLabel, names)
  }
  const segments = [...groups.entries()].map(([relationLabel, studentNames]) => `${studentNames.join('、')}${relationLabel}`)
  const label = `${segments.join('、')}（${name || '家长'}）`
  return label.length > 80 ? `${label.slice(0, 79)}…` : label
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  filterBySchoolSection,
  isSchoolSectionVisible,
  normalizeSchoolSection,
  resourceRowsOfVersion,
  schoolSectionOfGrade,
  schoolSectionOfResourceRows,
  schoolSectionsOfGrades
} from '../shared/school-section'
import { searchKnowledgeChunksHybrid, type DrizzleDB } from '../server/domain/module-resource-knowledge-search'
import { parseKnowledgeSheets } from '../server/domain/module-resource-file-import'
import { stageFilterEnabled, viewerSchoolSections } from '../server/utils/stage-filter'

describe('学段标签：年级折算与可见性', () => {
  it('年级折算学部：1-6 小学、7-9 初中、10-12 高中，0 与越界视为未标注', () => {
    expect([1, 6].map(schoolSectionOfGrade)).toEqual(['primary', 'primary'])
    expect([7, 9].map(schoolSectionOfGrade)).toEqual(['junior', 'junior'])
    expect([10, 12].map(schoolSectionOfGrade)).toEqual(['senior', 'senior'])
    expect([0, 13, -1, Number.NaN].map(schoolSectionOfGrade)).toEqual([null, null, null, null])
  })

  it('任教年级折算为去重学部集合；未填写返回空集合（表示学段未知）', () => {
    expect(schoolSectionsOfGrades([6, 7, 6])).toEqual(['primary', 'junior'])
    expect(schoolSectionsOfGrades([2, 11])).toEqual(['primary', 'senior'])
    expect(schoolSectionsOfGrades([])).toEqual([])
    expect(schoolSectionsOfGrades(undefined)).toEqual([])
  })

  it('未标注或标 all 的资源对所有学段可见；标了具体学部的只对同学段可见', () => {
    expect(isSchoolSectionVisible(undefined, ['primary'])).toBe(true)
    expect(isSchoolSectionVisible('all', ['senior'])).toBe(true)
    expect(isSchoolSectionVisible('primary', ['primary', 'junior'])).toBe(true)
    expect(isSchoolSectionVisible('junior', ['primary'])).toBe(false)
    expect(isSchoolSectionVisible('repeat', ['primary', 'senior'])).toBe(false)
  })

  it('无法识别的学段写法按 all 处理，不因为笔误把资源藏起来', () => {
    expect(normalizeSchoolSection('小学部')).toBe('all')
    expect(normalizeSchoolSection('')).toBe('all')
    expect(isSchoolSectionVisible('小学部', ['primary'])).toBe(true)
  })

  it('学段未知（教师没填任教年级）时不过滤', () => {
    expect(isSchoolSectionVisible('senior', [])).toBe(true)
    expect(isSchoolSectionVisible('senior', null)).toBe(true)
    expect(filterBySchoolSection([{ section: 'senior' }], r => r.section, []).fallback).toBe(false)
  })

  it('过滤后为空回退到全部并标记 fallback，不返回空列表', () => {
    const rows = [{ section: 'junior' }, { section: 'senior' }]
    expect(filterBySchoolSection(rows, r => r.section, ['primary'])).toEqual({ rows, fallback: true })
    expect(filterBySchoolSection(rows, r => r.section, ['junior'])).toEqual({ rows: [{ section: 'junior' }], fallback: false })
    expect(filterBySchoolSection(rows, r => r.section, ['junior', 'senior']).rows).toHaveLength(2)
    expect(filterBySchoolSection([], r => r.section, ['primary'])).toEqual({ rows: [], fallback: false })
  })
})

describe('知识库导入：适用学部列', () => {
  it('识别「适用学部」列，非法或缺失按 all', () => {
    const entries = parseKnowledgeSheets([{
      name: '知识文档',
      rows: [
        { 文档标题: '小学沟通话术', 文档内容: '这是一段足够长的正文内容，用于通过导入校验。', 适用学部: 'primary' },
        { 文档标题: '初中沟通话术', 文档内容: '这是一段足够长的正文内容，用于通过导入校验。', 适用学部: 'junior' },
        { 文档标题: '写法有误的文档', 文档内容: '这是一段足够长的正文内容，用于通过导入校验。', 适用学部: '小学' },
        { 文档标题: '未标注的文档', 文档内容: '这是一段足够长的正文内容，用于通过导入校验。' }
      ]
    }], 'home_school')
    expect(entries.map(entry => entry.applicableSchoolSection)).toEqual(['primary', 'junior', 'all', 'all'])
  })
})

describe('三库版本 → 知识库文档的学段继承', () => {
  it('取量表 instruments 与工具 tools 行；归因库没有该字段，返回空数组', () => {
    expect(resourceRowsOfVersion('assessment', { instruments: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
    expect(resourceRowsOfVersion('tool', { tools: [{ id: 't' }] })).toEqual([{ id: 't' }])
    expect(resourceRowsOfVersion('attribution', { rules: [{ id: 'r' }] })).toEqual([])
    expect(resourceRowsOfVersion('assessment', null)).toEqual([])
    expect(resourceRowsOfVersion('tool', { tools: 'not-an-array' })).toEqual([])
  })

  it('整版同一具体学部才采用；混杂、全 all、缺字段或没有行一律按 all', () => {
    expect(schoolSectionOfResourceRows([{ applicableSchoolSection: 'primary' }, { applicableSchoolSection: 'primary' }])).toBe('primary')
    expect(schoolSectionOfResourceRows([{ applicableSchoolSection: 'primary' }, { applicableSchoolSection: 'junior' }])).toBe('all')
    expect(schoolSectionOfResourceRows([{ applicableSchoolSection: 'primary' }, {}])).toBe('all')
    expect(schoolSectionOfResourceRows([{ applicableSchoolSection: 'all' }])).toBe('all')
    expect(schoolSectionOfResourceRows([])).toBe('all')
    expect(schoolSectionOfResourceRows(null)).toBe('all')
    // 写法非法的行按 all 参与集合，因此与具体学部混用会退回 all
    expect(schoolSectionOfResourceRows([{ applicableSchoolSection: 'primary' }, { applicableSchoolSection: '小学部' }])).toBe('all')
    // 非对象项忽略，不影响唯一学部
    expect(schoolSectionOfResourceRows([null, 'text', { applicableSchoolSection: 'senior' }])).toBe('senior')
  })
})

describe('知识检索：学段可见性条件', () => {  const captureQueries = async (filters: Parameters<typeof searchKnowledgeChunksHybrid>[3]) => {
    const queries: Array<{ sql: string, params: unknown[] }> = []
    const db = {
      execute: async (query: never) => {
        queries.push(new PgDialect().sqlToQuery(query))
        return { rows: [] }
      }
    } as unknown as DrizzleDB
    await searchKnowledgeChunksHybrid(db, '家长不配合怎么办', [1, 0], filters)
    return queries
  }

  it('传入学段时，向量与关键词两个分支都带上学部条件', async () => {
    const queries = await captureQueries({ schoolId: 'school-a', module: 'home_school', sections: ['primary'] })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query.sql).toContain("c.metadata->>'applicableSchoolSection'")
      // 未标注（NULL）与 all 始终可见（写在 SQL 里），具体学部按请求学段参数化过滤
      expect(query.sql).toContain("'all'")
      expect(query.params).toContain('primary')
    }
  })

  it('未传学段时不加学部条件（老数据与未填年级的教师行为不变）', async () => {
    const queries = await captureQueries({ schoolId: 'school-a', module: 'home_school' })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query.sql).not.toContain('applicableSchoolSection')
    }
  })
})

describe('学段过滤开关', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('默认关闭：教师填了任教年级也返回空集合（等价于不过滤）', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ schoolSectionFilterEnabled: false }))
    expect(stageFilterEnabled({} as never)).toBe(false)
    expect(viewerSchoolSections({} as never, [6, 10])).toEqual([])
  })

  it('开启后按任教年级折算学段（1-6 小学、10-12 高中）', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ schoolSectionFilterEnabled: true }))
    expect(stageFilterEnabled({} as never)).toBe(true)
    expect(viewerSchoolSections({} as never, [6, 10])).toEqual(['primary', 'senior'])
  })

  it('读不到运行时配置（脚本/无 Nitro 上下文）时按关闭处理，不因为异常把内容藏起来', () => {
    vi.stubGlobal('useRuntimeConfig', () => { throw new Error('no nitro context') })
    expect(stageFilterEnabled({} as never)).toBe(false)
    expect(viewerSchoolSections({} as never, [7])).toEqual([])
  })
})

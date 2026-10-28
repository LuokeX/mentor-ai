import { describe, expect, it } from 'vitest'
import { guardianDisplayLabel, guardianRelationLabel } from '../shared/guardian-display'

describe('guardianRelationLabel 关系口语化', () => {
  it('父母映射为爸爸/妈妈', () => {
    expect(guardianRelationLabel('父亲')).toBe('爸爸')
    expect(guardianRelationLabel('爸爸')).toBe('爸爸')
    expect(guardianRelationLabel('母亲')).toBe('妈妈')
    expect(guardianRelationLabel('妈妈')).toBe('妈妈')
  })
  it('祖辈与未知关系', () => {
    expect(guardianRelationLabel('祖父')).toBe('爷爷')
    expect(guardianRelationLabel('奶奶')).toBe('奶奶')
    expect(guardianRelationLabel('外祖父')).toBe('外公')
    expect(guardianRelationLabel('姥姥')).toBe('外婆')
    expect(guardianRelationLabel('其他监护人')).toBe('家长')
    expect(guardianRelationLabel('叔叔')).toBe('叔叔')
    expect(guardianRelationLabel('')).toBe('家长')
    expect(guardianRelationLabel(null)).toBe('家长')
  })
})

describe('guardianDisplayLabel 学生+家长展示', () => {
  it('单个学生 → 某生爸爸（姓名）', () => {
    expect(guardianDisplayLabel([{ studentName: '王五', relation: '父亲' }], '王强')).toBe('王五爸爸（王强）')
  })
  it('多个学生同关系 → 王五、王六爸爸（王强）', () => {
    expect(guardianDisplayLabel([
      { studentName: '王五', relation: '父亲' },
      { studentName: '王六', relation: '父亲' },
    ], '王强')).toBe('王五、王六爸爸（王强）')
  })
  it('多个学生不同关系 → 按关系分组', () => {
    expect(guardianDisplayLabel([
      { studentName: '王五', relation: '父亲' },
      { studentName: '王六', relation: '爷爷' },
    ], '王强')).toBe('王五爸爸、王六爷爷（王强）')
  })
  it('无学生时回退姓名 · 关系', () => {
    expect(guardianDisplayLabel([], '王强', '父亲')).toBe('王强 · 父亲')
    expect(guardianDisplayLabel([], '王强')).toBe('王强')
    expect(guardianDisplayLabel([], null)).toBe('家长')
  })
  it('学生名去重且截断到 80 字', () => {
    expect(guardianDisplayLabel([
      { studentName: '王五', relation: '父亲' },
      { studentName: '王五', relation: '父亲' },
    ], '王强')).toBe('王五爸爸（王强）')
    const label = guardianDisplayLabel([{ studentName: '甲'.repeat(100), relation: '父亲' }], '王强')
    expect(label.length).toBeLessThanOrEqual(80)
    expect(label.endsWith('…')).toBe(true)
  })
})

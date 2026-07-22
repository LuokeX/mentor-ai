import { describe, expect, it } from 'vitest'
import {
  moduleResourceLibraryCreateSchema,
  moduleResourceVersionActionSchema,
  moduleToolPayloadSchema
} from '../shared/contracts'
import { filterVisiblePublishedLibraries } from '../server/domain/module-resources'

describe('module resource contracts', () => {
  it('requires a school id for school-scoped libraries', () => {
    expect(moduleResourceLibraryCreateSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'school',
      name: '家校工具库'
    }).success).toBe(false)
    expect(moduleResourceLibraryCreateSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      scope: 'school',
      schoolId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
      name: '家校工具库'
    }).success).toBe(true)
  })

  it('validates structured tool cards', () => {
    const parsed = moduleToolPayloadSchema.parse({
      title: '高情绪家长三步降温',
      scenario: '家长表达强烈不满，但尚未出现威胁或公开扩散。',
      steps: ['先接住情绪', '再澄清事实', '最后约定下一步'],
      relatedModule: 'home_school',
      version: '1.0.0'
    })
    expect(parsed.doNot).toEqual([])
    expect(parsed.sourceRefs).toEqual([])
  })

  it('supports publish, rollback and retire lifecycle actions', () => {
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'publish' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'rollback' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'retire' }).success).toBe(true)
    expect(moduleResourceVersionActionSchema.safeParse({ action: 'delete' }).success).toBe(false)
  })
})

describe('module resource visibility', () => {
  it('uses school resources before global resources for the same library type', () => {
    const libraries = [
      { id: 'global-tool', libraryType: 'tool', scope: 'global', schoolId: null },
      { id: 'school-tool', libraryType: 'tool', scope: 'school', schoolId: 'school-1' },
      { id: 'global-sop', libraryType: 'sop', scope: 'global', schoolId: null },
      { id: 'other-school-sop', libraryType: 'sop', scope: 'school', schoolId: 'school-2' }
    ]
    expect(filterVisiblePublishedLibraries(libraries, 'school-1').map(item => item.id)).toEqual(['school-tool', 'global-sop'])
  })
})

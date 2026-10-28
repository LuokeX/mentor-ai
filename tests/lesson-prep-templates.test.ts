import { describe, expect, it } from 'vitest'
import { LESSON_PREP_TEMPLATES } from '../app/utils/lesson-prep'

describe('备课提示词模板', () => {
  it('提供学情 / 赛课 / 班会三个模板，key 唯一', () => {
    expect(LESSON_PREP_TEMPLATES.map(item => item.key)).toEqual(['learning_profile', 'competition', 'class_meeting'])
    expect(new Set(LESSON_PREP_TEMPLATES.map(item => item.key)).size).toBe(3)
  })

  it('每个模板都有标签、说明和可直接填入的结构化提示词', () => {
    for (const template of LESSON_PREP_TEMPLATES) {
      expect(template.label.length).toBeGreaterThan(0)
      expect(template.description.length).toBeGreaterThan(0)
      expect(template.prompt.length).toBeGreaterThan(50)
      expect(template.prompt).toContain('【')
    }
  })

  it('模板长度不超过聊天输入上限 4000 字', () => {
    for (const template of LESSON_PREP_TEMPLATES) {
      expect(template.prompt.length).toBeLessThan(4000)
    }
  })
})

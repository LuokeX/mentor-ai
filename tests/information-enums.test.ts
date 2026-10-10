import { describe, expect, it } from 'vitest'
import {
  communicationChannelLabels,
  communicationChannelSchema,
  studentEventTypeLabels,
  studentEventTypeSchema,
  studentEventTypes,
} from '../shared/contracts'

/** 产品确认的学生事件六大类（E1–E6） */
const EXPECTED_STUDENT_EVENT_TYPES = ['学业纪律类', '课堂秩序类', '行为规范类', '身心健康类', '欺凌侵害类', '其他'] as const
/** 迁移 0059 之前的旧口径，必须不再合法 */
const LEGACY_STUDENT_EVENT_TYPES = ['违纪', '冲突', '异常行为', '学业波动']
/** 沟通渠道英文码；空值表示未标注，不属于枚举 */
const EXPECTED_CHANNELS = ['phone', 'wechat', 'meeting', 'home_visit', 'other'] as const

describe('学生事件类型枚举（E1–E6）', () => {
  it('有序常量数组恰好是六大类', () => {
    expect([...studentEventTypes]).toEqual([...EXPECTED_STUDENT_EVENT_TYPES])
  })

  it('schema 取值与有序常量数组完全一致，且逐项通过校验', () => {
    expect([...studentEventTypeSchema.options]).toEqual([...EXPECTED_STUDENT_EVENT_TYPES])
    for (const value of EXPECTED_STUDENT_EVENT_TYPES) {
      expect(studentEventTypeSchema.safeParse(value).success).toBe(true)
    }
  })

  it('不再接受旧口径取值', () => {
    for (const legacy of LEGACY_STUDENT_EVENT_TYPES) {
      expect(studentEventTypeSchema.safeParse(legacy).success).toBe(false)
    }
    expect(studentEventTypeSchema.safeParse('违纪').success).toBe(false)
  })

  it('标签映射按 E1–E6 顺序覆盖全部取值', () => {
    expect(Object.keys(studentEventTypeLabels)).toEqual([...EXPECTED_STUDENT_EVENT_TYPES])
    for (const value of EXPECTED_STUDENT_EVENT_TYPES) {
      expect(studentEventTypeLabels[value]).toBe(value)
    }
  })
})

describe('家校沟通渠道枚举', () => {
  it('恰好包含五个英文渠道码', () => {
    expect([...communicationChannelSchema.options]).toEqual([...EXPECTED_CHANNELS])
    for (const value of EXPECTED_CHANNELS) {
      expect(communicationChannelSchema.safeParse(value).success).toBe(true)
    }
  })

  it('空值表示未标注，不属于枚举', () => {
    expect(communicationChannelSchema.safeParse('').success).toBe(false)
    expect(communicationChannelSchema.safeParse(null).success).toBe(false)
    expect(communicationChannelSchema.safeParse('短信').success).toBe(false)
  })

  it('标签映射齐全且与渠道码一一对应', () => {
    expect(Object.keys(communicationChannelLabels)).toEqual([...EXPECTED_CHANNELS])
    expect(communicationChannelLabels).toEqual({
      phone: '电话',
      wechat: '企微',
      meeting: '面谈',
      home_visit: '家访',
      other: '其他',
    })
  })
})

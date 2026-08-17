import { describe, expect, it } from 'vitest'
import { matchUser, toMappingCandidate, type MappingCandidate, type UserMatcher } from '../server/domain/sso'

const row = (id: string, overrides: Partial<Record<'oidcSubject' | 'phone' | 'employeeNo', string>> = {}) =>
  ({ id, name: '用户', status: 'active', ...overrides }) as never

const noopMatcher = (): UserMatcher => ({
  bySubject: async () => undefined,
  byPhone: async () => undefined,
  byEmployeeNo: async () => []
})

describe('SSO 账号映射', () => {
  it('从 IdP 用户信息提取匹配键：手机号去空格，空值归一为 undefined', () => {
    expect(toMappingCandidate({ sub: 'idp-1', phone: ' 13800000001 ' })).toEqual({
      subject: 'idp-1',
      phone: '13800000001'
    })
    expect(toMappingCandidate({ sub: 'idp-2', phone: '  ', employeeNo: ' 1001 ' })).toEqual({
      subject: 'idp-2',
      employeeNo: '1001'
    })
    expect(toMappingCandidate({ sub: 'idp-3' })).toEqual({ subject: 'idp-3' })
  })

  it('已绑定 subject 的用户优先匹配', async () => {
    const bound = row('u1', { oidcSubject: 'idp-1' })
    const result = await matchUser({ subject: 'idp-1', phone: '13800000001' }, {
      ...noopMatcher(),
      bySubject: async () => bound
    })
    expect(result?.id).toBe('u1')
  })

  it('subject 未绑定时按手机号匹配', async () => {
    const byPhone = row('u2', { phone: '13800000001' })
    const result = await matchUser({ subject: 'idp-2', phone: ' 13800000001 ' }, {
      ...noopMatcher(),
      byPhone: async () => byPhone
    })
    expect(result?.id).toBe('u2')
  })

  it('subject 与手机号都未命中时按工号匹配，且仅唯一命中', async () => {
    const byEmployeeNo = row('u3', { employeeNo: '1001' })
    expect((await matchUser({ subject: 'idp-3', employeeNo: '1001' }, {
      ...noopMatcher(),
      byEmployeeNo: async () => [byEmployeeNo]
    }))?.id).toBe('u3')
    // 多校同工号视为歧义，不匹配
    expect(await matchUser({ subject: 'idp-3', employeeNo: '1001' }, {
      ...noopMatcher(),
      byEmployeeNo: async () => [row('u3a', { employeeNo: '1001' }), row('u3b', { employeeNo: '1001' })]
    })).toBeNull()
  })

  it('全部未命中返回 null（未预置账号）', async () => {
    expect(await matchUser({ subject: 'idp-x', phone: '13900000000' }, noopMatcher())).toBeNull()
  })
})
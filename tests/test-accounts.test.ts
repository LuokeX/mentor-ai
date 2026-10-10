import { describe, expect, it } from 'vitest'
import { TEST_ACCOUNTS, groupTestAccounts } from '../app/utils/test-accounts'

/**
 * 测试环境登录页「选择测试账户」清单的回归测试。
 *
 * 这些断言的目的是挡住「点选后登录失败」这类静默故障：口令写错、手机号敲错、
 * 分组丢失都不会让页面报错，只会在使用时才发现。清单本身只影响测试环境页面渲染。
 */
describe('测试环境登录页预置账号', () => {
  it('手机号格式正确且不重复', () => {
    const phones = TEST_ACCOUNTS.map(account => account.phone)
    expect(new Set(phones).size).toBe(phones.length)
    for (const phone of phones) expect(phone).toMatch(/^1\d{10}$/)
  })

  it('每个账号都有分组、展示名与可用口令', () => {
    for (const account of TEST_ACCOUNTS) {
      expect(account.group.trim()).not.toBe('')
      expect(account.label.trim()).not.toBe('')
      expect(account.password.length).toBeGreaterThanOrEqual(6)
    }
  })

  it('口令符合测试库口径：种子演示密码或手机号后 8 位', () => {
    // 能看到口令的账号必然是这两种来源之一（create-account 的随机口令无法列出）。
    // 换过口令的账号要同步改这里，否则点选后会以失败告终。
    for (const account of TEST_ACCOUNTS) {
      expect(['Mentor@2026', account.phone.slice(-8)]).toContain(account.password)
    }
  })

  it('分组按书写顺序生成且不丢账号', () => {
    const groups = groupTestAccounts()
    expect(groups.map(group => group.name)).toEqual(['平台管理', '学校管理', '心理专员', '教师', '数据驾驶舱'])
    expect(groups.flatMap(group => group.accounts)).toEqual(TEST_ACCOUNTS)
  })
})

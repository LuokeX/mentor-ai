/**
 * 测试环境登录页「选择测试账户」的预置账号清单（纯前端常量，不参与任何鉴权）。
 *
 * 生效条件：`NUXT_PUBLIC_SHOW_TEST_ACCOUNTS=true`，只有测试/UAT 编排
 * （`docker-compose.test.yml`）注入该变量；正式编排 `docker-compose.yml`
 * 不注入 → 登录页不渲染任何测试账号信息。
 *
 * 维护口径：
 * - 只列测试库长期保留的演示/测试账号，**不要加入真实教师账号**——测试库中可能
 *   残留正式库数据副本，把账号铺开等于把人员名单放在登录页上。
 * - 密码与测试库一致：种子演示账号（`scripts/seed.ts`）为 `Mentor@2026`；
 *   后续用 `scripts/create-account.ts --phone-suffix` 开通的账号为手机号后 8 位。
 * - 账号或密码变动后同步这里；正式环境不存在这些账号，泄漏面仅限测试环境本身。
 */

export interface TestAccount {
  /** 分组名（登录页按此分组展示） */
  group: string
  /** 展示名（角色 + 范围，便于测试者认出该选谁） */
  label: string
  /** 登录手机号 */
  phone: string
  /** 测试库中该账号当前的口令 */
  password: string
}

/** 登录页「选择测试账户」的展示顺序：平台 → 学校 → 心理 → 教师 → 驾驶舱 */
export const TEST_ACCOUNTS: TestAccount[] = [
  { group: '平台管理', label: '平台管理员', phone: '13800000000', password: 'Mentor@2026' },
  { group: '学校管理', label: '小学部管理员', phone: '13800000001', password: 'Mentor@2026' },
  { group: '学校管理', label: '初中部管理员', phone: '13800000011', password: '00000011' },
  { group: '学校管理', label: '高中部管理员', phone: '13800000012', password: '00000012' },
  { group: '心理专员', label: '张心理（初中部）', phone: '13800000002', password: 'Mentor@2026' },
  { group: '教师', label: '张忠程（教师）', phone: '16688096890', password: 'Mentor@2026' },
  { group: '数据驾驶舱', label: '小学部校长', phone: '13800001001', password: '00001001' },
  { group: '数据驾驶舱', label: '初中部校长', phone: '13800001002', password: '00001002' },
  { group: '数据驾驶舱', label: '高中部校长', phone: '13800001003', password: '00001003' }
]

export interface TestAccountGroup {
  name: string
  accounts: TestAccount[]
}

/** 按 TEST_ACCOUNTS 的书写顺序分组，供登录页直接渲染 */
export function groupTestAccounts(accounts: TestAccount[] = TEST_ACCOUNTS): TestAccountGroup[] {
  const groups: TestAccountGroup[] = []
  for (const account of accounts) {
    let group = groups.find(item => item.name === account.group)
    if (!group) {
      group = { name: account.group, accounts: [] }
      groups.push(group)
    }
    group.accounts.push(account)
  }
  return groups
}

import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../app/composables/useAuth'
import {
  MANAGED_TARGET_TYPES,
  TARGET_CAPABILITY_MATRIX,
  TARGET_TYPE_GROUPS,
  allowedCapabilities,
  countRolePermissions,
  diffRolePermissions,
  isCapabilityAllowedForTarget,
  normalizeRolePermissions,
  rolePermissionsEqual,
  effectiveRolePermissions,
  inheritedRolePermissions,
  rolePermissionsEqual,
  rolePermissionsMatchDefaults,
  sanitizeRolePermissions,
  type Capability,
  type ManagedTargetType,
  type RolePermissions,
} from '../shared/management'
import {
  parseRolePermissions,
  resolveCapabilitiesFromRoleData,
  resolveCapabilitiesHardcoded,
  resolvePageCapabilitiesFromRoleData,
  resolvePageCapabilitiesHardcoded,
} from '../server/domain/capabilities'
import { DEFAULT_ROLE_PERMISSIONS } from '../server/domain/roles'

const users: Record<string, AuthUser> = {
  teacher: { id: 'u-t', schoolId: 'school-1', phone: '13800000001', name: '李老师', role: 'teacher', roleLabel: '教师' },
  psychologist: { id: 'u-p', schoolId: 'school-1', phone: '13800000002', name: '王专员', role: 'psychologist', roleLabel: '心理专员' },
  school_admin: { id: 'u-a', schoolId: 'school-1', phone: '13800000003', name: '学校管理员', role: 'school_admin', roleLabel: '学校管理员' },
  division_principal: { id: 'u-dp', schoolId: 'school-1', phone: '13800000005', name: '学部校长', role: 'division_principal', roleLabel: '学部校长' },
  moral_education_director: { id: 'u-md', schoolId: 'school-1', phone: '13800000006', name: '德育主任', role: 'moral_education_director', roleLabel: '德育主任' },
  grade_director: { id: 'u-gd', schoolId: 'school-1', phone: '13800000007', name: '年级主任', role: 'grade_director', roleLabel: '年级主任' },
  platform_admin: { id: 'u-pa', schoolId: null, phone: '13800000004', name: '平台管理员', role: 'platform_admin', roleLabel: '平台管理员' },
}

const STATUSES = [
  undefined, 'active', 'open', 'draft', 'in_progress', 'created', 'acknowledged',
  'archived', 'transferred', 'graduated', 'invited', 'disabled', 'closed', 'resolved', 'pending',
]

function ctx(role: keyof typeof users, targetType: ManagedTargetType, status?: string) {
  const user = users[role]
  return {
    user,
    recordSchoolId: user.schoolId ?? 'school-1',
    recordOwnerUserId: 'u-t',
    recordStatus: status,
    targetType,
  }
}

describe('roles 表数据驱动解析 = 原硬编码结果（默认权限数据）', () => {
  for (const role of Object.keys(users) as Array<keyof typeof users>) {
    it(`${role}：全部目标类型 × 全部状态一致`, () => {
      const perm = DEFAULT_ROLE_PERMISSIONS[role]
      for (const targetType of MANAGED_TARGET_TYPES) {
        for (const status of STATUSES) {
          const input = ctx(role, targetType, status)
          const expected = resolveCapabilitiesHardcoded(input)
          const fromData = resolveCapabilitiesFromRoleData(input, perm)
          // 模拟真实入口的回退路径：null → 硬编码
          const actual = fromData === null ? resolveCapabilitiesHardcoded(input) : fromData
          expect(actual, `${role}/${targetType}/${status}`).toEqual(expected)
        }
      }
    })
  }

  it('页面级能力：数据驱动 = 硬编码', () => {
    for (const role of Object.keys(users) as Array<keyof typeof users>) {
      const perm = DEFAULT_ROLE_PERMISSIONS[role]
      for (const targetType of MANAGED_TARGET_TYPES) {
        const expected = resolvePageCapabilitiesHardcoded(users[role], targetType)
        const fromData = resolvePageCapabilitiesFromRoleData(users[role], targetType, perm)
        const actual = fromData === null ? resolvePageCapabilitiesHardcoded(users[role], targetType) : fromData
        expect(actual, `${role}/${targetType}`).toEqual(expected)
      }
    }
  })
})

describe('权限修改生效（数据驱动的目的）', () => {
  it('取消教师对学生的 edit 后，数据驱动结果不再包含 edit', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.teacher))
    perm.records.student = ['view']
    const input = ctx('teacher', 'student', 'active')
    const fromData = resolveCapabilitiesFromRoleData(input, perm)
    expect(fromData).toEqual(['view'])
  })

  it('给教师增加 class 的 edit 后生效', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.teacher))
    perm.records.class = ['view', 'edit']
    const input = ctx('teacher', 'class', 'active')
    const fromData = resolveCapabilitiesFromRoleData(input, perm)
    expect(fromData).toEqual(['view', 'edit'])
  })

  it('清空学校管理员对班级的 archive 后，active 班级不再含 archive（restore 门禁仍生效）', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.school_admin))
    perm.records.class = ['view', 'edit', 'transfer', 'graduate', 'restore']
    const active = resolveCapabilitiesFromRoleData(ctx('school_admin', 'class', 'active'), perm)
    expect(active).toEqual(['view', 'edit', 'transfer', 'graduate'])
    const archived = resolveCapabilitiesFromRoleData(ctx('school_admin', 'class', 'archived'), perm)
    expect(archived).toEqual(['view', 'edit', 'restore'])
  })
})

describe('降级回退与容错', () => {
  it('目标类型未在权限配置中 → 返回 null（调用方回退硬编码）', () => {
    const perm: RolePermissions = { pages: {}, records: { student: ['view'] } }
    expect(resolveCapabilitiesFromRoleData(ctx('teacher', 'class', 'active'), perm)).toBeNull()
    expect(resolvePageCapabilitiesFromRoleData(users.teacher, 'class', perm)).toBeNull()
  })

  it('结构非法的权限数据 → parseRolePermissions 返回 null', () => {
    expect(parseRolePermissions(null)).toBeNull()
    expect(parseRolePermissions('oops')).toBeNull()
    expect(parseRolePermissions({ pages: 'bad', records: {} })).toBeNull()
    expect(parseRolePermissions({ pages: { a: 'bad' }, records: {} })).toBeNull()
  })

  it('合法结构正常解析，未知能力值被剔除', () => {
    const parsed = parseRolePermissions({ pages: { class: ['view', 'hack'] }, records: { student: ['view', 'edit'] } })
    expect(parsed).toEqual({ pages: { class: ['view'] }, records: { student: ['view', 'edit'] } })
  })

  it('默认数据覆盖全部目标类型（不会误触回退）', () => {
    for (const perm of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const targetType of MANAGED_TARGET_TYPES) {
        expect(perm.records[targetType], `records.${targetType}`).toBeDefined()
        expect(perm.pages[targetType], `pages.${targetType}`).toBeDefined()
      }
    }
  })
})

describe('数据驾驶舱权限（PRD 4.1 / 5.2：三个看板角色默认勾选四个页面，其余角色无能力）', () => {
  const DASHBOARD_ROLES = ['division_principal', 'moral_education_director', 'grade_director']
  const DASHBOARD_PAGES: ManagedTargetType[] = ['dashboard', 'dashboard_ai_questions', 'dashboard_plans', 'dashboard_alerts']

  it('页面级与记录级：数据驱动与硬编码一致，且只给看板角色', () => {
    for (const role of Object.keys(users) as Array<keyof typeof users>) {
      const perm = DEFAULT_ROLE_PERMISSIONS[role]
      const expected: Capability[] = DASHBOARD_ROLES.includes(role) ? ['view'] : []
      for (const page of DASHBOARD_PAGES) {
        expect(resolvePageCapabilitiesHardcoded(users[role], page), `pages hardcoded ${role}/${page}`).toEqual(expected)
        expect(resolveCapabilitiesHardcoded(ctx(role, page, 'active')), `records hardcoded ${role}/${page}`).toEqual(expected)
        expect(resolvePageCapabilitiesFromRoleData(users[role], page, perm), `pages data ${role}/${page}`).toEqual(expected)
        expect(resolveCapabilitiesFromRoleData(ctx(role, page, 'active'), perm), `records data ${role}/${page}`).toEqual(expected)
      }
    }
  })

  it('二级页逐页取消：只影响被取消的页，其余页不受影响', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.division_principal))
    perm.pages.dashboard_plans = []
    expect(resolvePageCapabilitiesFromRoleData(users.division_principal, 'dashboard_plans', perm)).toEqual([])
    expect(resolvePageCapabilitiesFromRoleData(users.division_principal, 'dashboard', perm)).toEqual(['view'])
    expect(resolvePageCapabilitiesFromRoleData(users.division_principal, 'dashboard_ai_questions', perm)).toEqual(['view'])
    expect(resolvePageCapabilitiesFromRoleData(users.division_principal, 'dashboard_alerts', perm)).toEqual(['view'])
  })

  it('非看板角色即使被勾选看板页也不放行（与前端路由域一致）', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.school_admin))
    perm.pages.dashboard = ['view']
    perm.records.dashboard = ['view']
    // 页面级能力按配置返回（配置页可勾选），但记录级解析对非看板角色强制为空
    expect(resolvePageCapabilitiesFromRoleData(users.school_admin, 'dashboard', perm)).toEqual(['view'])
    expect(resolveCapabilitiesFromRoleData(ctx('school_admin', 'dashboard', 'active'), perm)).toEqual([])
    expect(resolveCapabilitiesFromRoleData(ctx('teacher', 'dashboard', 'active'), perm)).toEqual([])
  })

  it('个体明细（view_sensitive）：默认未开通时不授予，开通后只多这一项', () => {
    const def = DEFAULT_ROLE_PERMISSIONS.division_principal
    expect(resolveCapabilitiesFromRoleData(ctx('division_principal', 'dashboard', 'active'), def)).toEqual(['view'])

    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.division_principal))
    perm.records.dashboard = ['view', 'view_sensitive']
    expect(resolveCapabilitiesFromRoleData(ctx('division_principal', 'dashboard', 'active'), perm)).toEqual(['view', 'view_sensitive'])
    // 硬编码回退路径不授予 view_sensitive（数据缺失时按最小权限处理）
    expect(resolveCapabilitiesHardcoded(ctx('division_principal', 'dashboard', 'active'))).toEqual(['view'])
  })

  it('平台管理员取走校长的驾驶舱权限后，该校校长解析为空', () => {
    const perm: RolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.division_principal))
    for (const page of DASHBOARD_PAGES) {
      perm.pages[page] = []
      expect(resolvePageCapabilitiesFromRoleData(users.division_principal, page, perm)).toEqual([])
    }
  })
})

describe('Capability 类型一致性', () => {
  it('权限数据中的能力值均为合法 Capability', () => {
    const valid = new Set<Capability>([
      'view', 'view_sensitive', 'create', 'edit', 'inline_edit',
      'archive', 'restore', 'transfer', 'graduate', 'delete', 'disable',
    ])
    for (const perm of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const [key, list] of Object.entries(perm.records)) for (const c of list) expect(valid.has(c), `${key}: ${c}`).toBe(true)
      for (const [key, list] of Object.entries(perm.pages)) for (const c of list) expect(valid.has(c), `${key}: ${c}`).toBe(true)
    }
  })
})

describe('能力白名单与分组（shared/management.ts 为唯一事实来源）', () => {
  it('分组恰好覆盖全部目标类型，不重不漏', () => {
    const grouped = TARGET_TYPE_GROUPS.flatMap(group => group.targetTypes)
    expect(grouped.slice().sort()).toEqual([...MANAGED_TARGET_TYPES].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const group of TARGET_TYPE_GROUPS) expect(group.label, group.id).toBeTruthy()
  })

  it('白名单覆盖全部目标类型，页面级只有查看 / 新增', () => {
    for (const targetType of MANAGED_TARGET_TYPES) {
      const entry = TARGET_CAPABILITY_MATRIX[targetType]
      expect(entry, targetType).toBeDefined()
      expect(entry.pages.length, targetType).toBeGreaterThan(0)
      expect(entry.records.length, targetType).toBeGreaterThan(0)
      for (const capability of entry.pages) expect(['view', 'create'], `${targetType}/${capability}`).toContain(capability)
    }
  })

  it('view_sensitive 只出现在数据驾驶舱入口目标类型上', () => {
    for (const targetType of MANAGED_TARGET_TYPES) {
      const allows = isCapabilityAllowedForTarget(targetType, 'records', 'view_sensitive')
      expect(allows, targetType).toBe(targetType === 'dashboard')
    }
  })

  it('「勾了也不会生效」的能力不在白名单里（只读域与驾驶舱）', () => {
    for (const targetType of ['audit', 'plan_operation', 'access_request']) {
      expect(allowedCapabilities(targetType, 'records'), targetType).toEqual(['view'])
      expect(allowedCapabilities(targetType, 'pages'), targetType).toEqual(['view'])
    }
    for (const targetType of ['dashboard', 'dashboard_ai_questions', 'dashboard_plans', 'dashboard_alerts']) {
      expect(allowedCapabilities(targetType, 'pages'), targetType).toEqual(['view'])
    }
  })

  it('导入管理页允许新建导入（学校管理员在页面上执行 CSV/xlsx 预检与提交）', () => {
    expect(allowedCapabilities('import', 'pages')).toEqual(['view', 'create'])
    expect(allowedCapabilities('import', 'records')).toEqual(['view'])
  })

  it('系统默认清单已经在白名单内（清洗默认值不产生任何改动）', () => {
    for (const [role, perm] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const { permissions, dropped } = sanitizeRolePermissions(perm)
      expect(dropped, role).toEqual([])
      expect(rolePermissionsEqual(permissions, perm), role).toBe(true)
    }
  })
})

describe('权限清洗与差异（前后端共用的纯函数）', () => {
  it('清洗：丢弃未知目标类型与不适用能力，去重并按白名单顺序排列', () => {
    const { permissions, dropped } = sanitizeRolePermissions({
      pages: { class: ['create', 'view', 'create', 'delete'], not_a_target: ['view'] },
      records: { class: ['graduate', 'view', 'graduate', 'view_sensitive'] },
    })
    expect(permissions.pages.class).toEqual(['view', 'create'])
    expect(permissions.records.class).toEqual(['view', 'graduate'])
    expect(dropped).toEqual([
      { group: 'pages', targetType: 'class', capability: 'delete' },
      { group: 'pages', targetType: 'not_a_target', capability: 'view' },
      { group: 'records', targetType: 'class', capability: 'view_sensitive' },
    ])
    // 未出现的键补空数组，避免运行时落到硬编码回退
    expect(permissions.pages.student).toEqual([])
    expect(permissions.records.dashboard_alerts).toEqual([])
  })

  it('清洗：dashboard 的个体明细能力在入口目标类型上保留', () => {
    const { permissions, dropped } = sanitizeRolePermissions({
      pages: { dashboard: ['view'] },
      records: { dashboard: ['view', 'view_sensitive'] },
    })
    expect(permissions.records.dashboard).toEqual(['view', 'view_sensitive'])
    expect(dropped).toEqual([])
  })

  it('差异：同值无差异，增删能精确到目标类型与能力', () => {
    const before = normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS.school_admin)
    expect(diffRolePermissions(before, before)).toEqual([])

    const after = normalizeRolePermissions(before)
    after.records.class = after.records.class!.filter(capability => capability !== 'archive')
    after.pages.student = [...(after.pages.student ?? []), 'delete']
    expect(diffRolePermissions(before, after)).toEqual([
      { group: 'pages', targetType: 'student', added: ['delete'], removed: [] },
      { group: 'records', targetType: 'class', added: [], removed: ['archive'] },
    ])
  })

  it('计数：区分页面级 / 记录级 / 覆盖目标类型 / 驾驶舱可见页', () => {
    const counts = countRolePermissions(DEFAULT_ROLE_PERMISSIONS.division_principal)
    expect(counts.dashboardPageCount).toBe(4)
    expect(counts.pageCount).toBe(4)
    expect(counts.targetTypeCount).toBe(4)

    const platformAdmin = countRolePermissions(DEFAULT_ROLE_PERMISSIONS.platform_admin)
    expect(platformAdmin.dashboardPageCount).toBe(0)
    expect(platformAdmin.targetTypeCount).toBeGreaterThan(5)
  })

  it('生效值：缺键按系统默认补齐，显式空数组不能被默认值覆盖', () => {
    const defaults = normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS.teacher)
    // 历史迁移写下的教师行只覆盖部分目标类型，缺的几类在运行时走硬编码回退（= 默认值）
    const legacyTeacher: RolePermissions = {
      pages: { student: ['view', 'create'], class: ['view'] },
      records: { student: ['view', 'edit', 'inline_edit'], class: ['view'] },
    }
    const effective = effectiveRolePermissions(legacyTeacher, defaults)
    expect(effective.pages.student).toEqual(['view', 'create'])
    expect(effective.records.student).toEqual(['view', 'edit', 'inline_edit'])
    // 缺键 → 取默认（教师对评估记录只有查看）
    expect(effective.records.assessment).toEqual(['view'])
    expect(effective.pages.assessment).toEqual(['view'])
    // 显式空数组是「明确不给」，必须压过默认值（这是保存后固化配置的语义）
    const explicitEmpty = effectiveRolePermissions({ ...legacyTeacher, records: { ...legacyTeacher.records, assessment: [] } }, defaults)
    expect(explicitEmpty.records.assessment).toEqual([])
    // 未知角色（没有默认清单）缺键补空数组
    expect(effectiveRolePermissions(legacyTeacher, null).records.assessment).toEqual([])
  })

  it('继承默认：只列出库里没有显式配置的目标类型', () => {
    const stored: RolePermissions = { pages: { class: [] }, records: { class: ['view'] } }
    const inherited = inheritedRolePermissions(stored)
    expect(inherited).toContainEqual({ group: 'records', targetType: 'student' })
    expect(inherited).not.toContainEqual({ group: 'pages', targetType: 'class' })
    expect(inherited).not.toContainEqual({ group: 'records', targetType: 'class' })
    expect(inherited.length).toBe(MANAGED_TARGET_TYPES.length * 2 - 2)
  })

  it('与系统默认一致：按生效值比较，缺键等价于默认值', () => {
    const defaults = normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS.teacher)
    const legacyTeacher: RolePermissions = {
      pages: { student: ['view', 'create'], class: ['view'] },
      records: { student: ['view', 'edit', 'inline_edit'], class: ['view'] },
    }
    expect(rolePermissionsMatchDefaults(legacyTeacher, defaults)).toBe(true)
    // 少勾一项即视为已自定义
    expect(rolePermissionsMatchDefaults({ ...legacyTeacher, records: { ...legacyTeacher.records, student: ['view'] } }, defaults)).toBe(false)
    // 显式清空一个目标类型同样视为已自定义
    expect(rolePermissionsMatchDefaults({ ...legacyTeacher, records: { ...legacyTeacher.records, assessment: [] } }, defaults)).toBe(false)
    expect(rolePermissionsMatchDefaults(defaults, defaults)).toBe(true)
  })
})
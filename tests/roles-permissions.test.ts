import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../app/composables/useAuth'
import {
  MANAGED_TARGET_TYPES,
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
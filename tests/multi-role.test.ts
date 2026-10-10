import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { roleSchema } from '../shared/contracts'
import {
  ROLE_HOME,
  ROLE_LABELS,
  pathInRoleDomain,
  pathIsShared,
  roleDomainOfPath,
  roleHomePath,
  rolesDomainOfPath,
  rolesOf
} from '../app/composables/useAuth'
import { normalizeRoleScope } from '../server/domain/user-roles'

describe('多角色：账号角色集合与激活角色', () => {
  it('rolesOf：缺省 roles 时按激活角色处理，避免历史数据/测试 fixture 失效', () => {
    expect(rolesOf(null)).toEqual([])
    expect(rolesOf(undefined)).toEqual([])
    expect(rolesOf({ role: 'teacher' })).toEqual(['teacher'])
    // 空数组同样回落到激活角色
    expect(rolesOf({ role: 'teacher', roles: [] })).toEqual(['teacher'])
  })

  it('rolesOf：返回账号持有的全部角色（不因激活角色变化而变）', () => {
    const user = { role: 'school_admin', roles: ['teacher', 'school_admin'] as const }
    expect(rolesOf(user)).toEqual(['teacher', 'school_admin'])
    expect(rolesOf({ ...user, role: 'teacher' })).toEqual(['teacher', 'school_admin'])
  })

  it('每个角色都有首页与中文标签，未知角色回落到教师首页', () => {
    for (const role of roleSchema.options) {
      expect(ROLE_HOME[role]).toBeTruthy()
      expect(ROLE_LABELS[role]).toBeTruthy()
    }
    expect(roleHomePath('teacher')).toBe('/')
    expect(roleHomePath('school_admin')).toBe('/school-admin')
    expect(roleHomePath('platform_admin')).toBe('/platform-admin')
    expect(roleHomePath('psychologist')).toBe('/specialist')
    expect(roleHomePath('not_a_role')).toBe('/')
    expect(roleHomePath(null)).toBe('/')
  })
})

describe('多角色：路径归属与共用区域', () => {
  it('按分段匹配角色域，不把 /modules 误判成 /module', () => {
    expect(roleDomainOfPath('/')).toBe('teacher')
    expect(roleDomainOfPath('/module/class_system')).toBe('teacher')
    expect(roleDomainOfPath('/information')).toBe('teacher')
    expect(roleDomainOfPath('/school-admin')).toBe('school_admin')
    expect(roleDomainOfPath('/school-admin/users')).toBe('school_admin')
    expect(roleDomainOfPath('/platform-admin/ai-center')).toBe('platform_admin')
    expect(roleDomainOfPath('/specialist')).toBe('psychologist')
    // 前缀必须整段匹配
    expect(roleDomainOfPath('/modules')).toBeNull()
    expect(roleDomainOfPath('/informations')).toBeNull()
    // 共用区域与未知路径不归属任何角色域
    expect(roleDomainOfPath('/notifications')).toBeNull()
    expect(roleDomainOfPath('/no-such-page')).toBeNull()
  })

  it('数据驾驶舱由三个看板角色共用同一路径域（中间件按集合判断，避免落地页死循环）', () => {
    expect(rolesDomainOfPath('/dashboard')).toEqual(['division_principal', 'moral_education_director', 'grade_director'])
    expect(rolesDomainOfPath('/dashboard/plans')).toEqual(['division_principal', 'moral_education_director', 'grade_director'])
    expect(rolesDomainOfPath('/school-admin')).toEqual(['school_admin'])
    expect(rolesDomainOfPath('/no-such-page')).toEqual([])
    // 兼容入口仍返回第一个匹配角色
    expect(roleDomainOfPath('/dashboard')).toBe('division_principal')
  })

  it('/notifications 为四角色共用，且所有角色都能访问', () => {
    expect(pathIsShared('/notifications')).toBe(true)
    expect(pathIsShared('/notifications/123')).toBe(true)
    expect(pathIsShared('/school-admin')).toBe(false)
    for (const role of roleSchema.options) {
      expect(pathInRoleDomain(role, '/notifications')).toBe(false)
    }
  })

  it('同一路径只归属一个角色域，避免中间件来回切换激活角色', () => {
    for (const path of ['/', '/module/x', '/assessments', '/information', '/growth', '/plans', '/specialist', '/school-admin', '/platform-admin']) {
      const owners = roleSchema.options.filter(role => pathInRoleDomain(role, path))
      expect(owners, path).toHaveLength(1)
    }
  })
})

describe('多角色：角色范围净化', () => {
  it('只保留已知键，忽略脏数据', () => {
    expect(normalizeRoleScope(null)).toEqual({})
    expect(normalizeRoleScope(undefined)).toEqual({})
    expect(normalizeRoleScope(['primary'])).toEqual({})
    expect(normalizeRoleScope('primary')).toEqual({})
    expect(normalizeRoleScope({ section: 'primary' })).toEqual({ section: 'primary' })
    expect(normalizeRoleScope({ section: 'junior', grade: 7 })).toEqual({ section: 'junior', grade: 7 })
    expect(normalizeRoleScope({ section: '', grade: '7', extra: 1 })).toEqual({})
    expect(normalizeRoleScope({ grade: Number.NaN })).toEqual({})
  })
})

describe('多角色：迁移与角色目录一致性', () => {
  it('user_roles 迁移先建表、再回填，且带唯一索引与激活角色列', () => {
    const sql = readFileSync(new URL('../drizzle/0058_broad_ben_urich.sql', import.meta.url), 'utf8')
    const create = sql.indexOf('CREATE TABLE "user_roles"')
    const unique = sql.indexOf('user_roles_user_role_uidx')
    const backfill = sql.indexOf('INSERT INTO "user_roles" ("user_id", "role_code")')
    const activeRole = sql.indexOf('ALTER TABLE "sessions" ADD COLUMN "active_role"')
    expect(create).toBeGreaterThan(-1)
    expect(unique).toBeGreaterThan(create)
    expect(activeRole).toBeGreaterThan(-1)
    // 回填必须发生在建表之后，否则存量账号会没有角色行
    expect(backfill).toBeGreaterThan(create)
    expect(sql).toContain('ON CONFLICT ("user_id", "role_code") DO NOTHING')
    // 回填来源是账号主角色（users.role 保留为主角色，必须是角色集合中的一行）
    expect(sql).toContain('SELECT "id", "role" FROM "users"')
  })

  it('roleSchema 的取值与 roles 目录表种子一致（新增角色必须同时登记目录表）', () => {
    // 角色目录行可能分散在多个迁移里（新增角色走新迁移），因此扫描整个 drizzle 目录
    const files = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql'))
    const seeded = new Set<string>()
    for (const file of files) {
      const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')
      for (const match of sql.matchAll(/INSERT INTO "roles" \("code", "name", "description", "is_system", "permissions"\) VALUES \('([a-z_]+)'/g)) {
        seeded.add(match[1]!)
      }
    }
    expect(seeded).toEqual(new Set(roleSchema.options))
  })
})

import { describe, expect, it } from 'vitest'
import {
  departmentTypeSchema,
  managedRecordStatusSchema,
  schoolAdminClassCreateSchema,
  schoolAdminDepartmentCreateSchema,
  schoolAdminDepartmentMemberSchema,
  schoolAdminStudentCreateSchema,
  schoolAdminStudentGuardianSchema,
  schoolAdminUserCreateSchema,
  schoolAdminUserInviteSchema,
  schoolAdminUserUpdateSchema,
  targetTypeSchema
} from '../shared/contracts'
import { SCHOOL_MANAGED_ROLES, hasBusinessRole, isSchoolManagedRole, normalizeRoleScope, normalizeScopeGrades } from '../server/domain/user-roles'

describe('management contracts', () => {
  it('limits managed record status to archive-style lifecycle values', () => {
    expect(managedRecordStatusSchema.safeParse('active').success).toBe(true)
    expect(managedRecordStatusSchema.safeParse('archived').success).toBe(true)
    expect(managedRecordStatusSchema.safeParse('deleted').success).toBe(false)
  })

  it('keeps user invitations scoped to school-managed roles', () => {
    expect(schoolAdminUserInviteSchema.safeParse({ name: '李老师', phone: '13800000001', role: 'teacher' }).success).toBe(true)
    expect(schoolAdminUserInviteSchema.safeParse({ name: '德育主任', phone: '13800000001', role: 'moral_education_director' }).success).toBe(true)
    expect(schoolAdminUserInviteSchema.safeParse({ name: '校管', phone: '13800000001', role: 'school_admin' }).success).toBe(false)
    expect(schoolAdminUserInviteSchema.safeParse({ name: '平台', phone: '13800000001', role: 'platform_admin' }).success).toBe(false)
  })

  it('requires a grade scope for grade directors and only accepts grades 1-12', () => {
    const base = { name: '年级主任', phone: '13800000001' }
    const missingScope = schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director' })
    expect(missingScope.success).toBe(false)
    expect(missingScope.error?.issues[0]?.message).toBe('年级主任必须填写所辖年级')
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrade: 7 }).success).toBe(true)
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrade: 13 }).success).toBe(false)
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrade: 0 }).success).toBe(false)
    // 多选年级：数组形式通过，重复项去重并按升序写入
    const multi = schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrades: [8, 7, 8] })
    expect(multi.success).toBe(true)
    expect(multi.success ? multi.data.scopeGrades : null).toEqual([7, 8])
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrades: [] }).success).toBe(false)
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'grade_director', scopeGrades: [13] }).success).toBe(false)
    // 非年级主任不要求所辖年级
    expect(schoolAdminUserCreateSchema.safeParse({ ...base, role: 'moral_education_director' }).success).toBe(true)
  })

  it('carries the school-managed role set into account updates', () => {
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'moral_education_director' }).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'grade_director', scopeGrade: 7 }).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ scopeGrade: 7 }).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ scopeGrade: 13 }).success).toBe(false)
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'grade_director', scopeGrades: [7, 8] }).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ scopeGrades: [7, 8] }).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ scopeGrades: [0, 7] }).success).toBe(false)
    // 学校管理员/平台管理员/学部校长不归学校级账号管理
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'school_admin' }).success).toBe(false)
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'platform_admin' }).success).toBe(false)
    expect(schoolAdminUserUpdateSchema.safeParse({ role: 'division_principal' }).success).toBe(false)
  })

  it('accepts an optional transfer target when changing a role that owns business data', () => {
    const withTransfer = { role: 'grade_director', scopeGrade: 7, transferToUserId: '9f1b3f74-6f4e-4a2b-9d0a-1a2b3c4d5e6f' }
    expect(schoolAdminUserUpdateSchema.safeParse(withTransfer).success).toBe(true)
    expect(schoolAdminUserUpdateSchema.safeParse({ ...withTransfer, transferReason: '换角色移交：原教师转为年级主任' }).success).toBe(true)
    // 非 UUID 的接收教师直接拒绝
    expect(schoolAdminUserUpdateSchema.safeParse({ ...withTransfer, transferToUserId: 'not-a-uuid' }).success).toBe(false)
    // 事由过短也拒绝（服务端会补默认事由，传了就要合规）
    expect(schoolAdminUserUpdateSchema.safeParse({ ...withTransfer, transferReason: '短' }).success).toBe(false)
  })

  it('normalizes multi-grade scopes and keeps legacy single-grade rows readable', () => {
    expect(normalizeScopeGrades([8, 7, 8, 0, 13])).toEqual([7, 8])
    expect(normalizeScopeGrades(7)).toEqual([7])
    expect(normalizeScopeGrades(undefined)).toEqual([])
    expect(normalizeRoleScope({ grades: [8, 7] })).toEqual({ grades: [7, 8], grade: 7 })
    expect(normalizeRoleScope({ grade: 9 })).toEqual({ grade: 9 })
    expect(normalizeRoleScope({ section: 'primary', grades: [3, 4] })).toEqual({ section: 'primary', grades: [3, 4], grade: 3 })
  })

  it('treats only teacher and psychologist as business roles', () => {
    expect(hasBusinessRole(['teacher'])).toBe(true)
    expect(hasBusinessRole(['psychologist'])).toBe(true)
    expect(hasBusinessRole(['teacher', 'grade_director'])).toBe(true)
    expect(hasBusinessRole(['moral_education_director'])).toBe(false)
    expect(hasBusinessRole(['grade_director'])).toBe(false)
    expect(SCHOOL_MANAGED_ROLES).toEqual(['teacher', 'psychologist', 'moral_education_director', 'grade_director'])
    expect(isSchoolManagedRole('school_admin')).toBe(false)
    expect(isSchoolManagedRole('division_principal')).toBe(false)
    expect(isSchoolManagedRole('grade_director')).toBe(true)
  })

  it('validates class and student base-management payloads', () => {
    expect(schoolAdminClassCreateSchema.safeParse({
      name: '七年级一班',
      grade: 7,
      ownerUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827'
    }).success).toBe(true)
    expect(schoolAdminStudentCreateSchema.safeParse({ name: '示例学生', ownerUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827' }).success).toBe(true)
  })

  it('validates school departments and department members', () => {
    expect(departmentTypeSchema.safeParse('grade_group').success).toBe(true)
    expect(schoolAdminDepartmentCreateSchema.safeParse({
      name: '七年级组',
      code: 'G7',
      type: 'grade_group',
      leaderUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827'
    }).success).toBe(true)
    expect(schoolAdminDepartmentMemberSchema.safeParse({
      userId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
      memberRole: '组长'
    }).success).toBe(true)
  })

  it('requires either an existing guardian id or a new guardian payload when linking guardians', () => {
    expect(schoolAdminStudentGuardianSchema.safeParse({}).success).toBe(false)
    expect(schoolAdminStudentGuardianSchema.safeParse({ guardianId: 'd9c4988e-e585-4a69-8e83-a87b79b88827' }).success).toBe(true)
    expect(schoolAdminStudentGuardianSchema.safeParse({ guardian: { name: '示例家长', relation: '母亲' } }).success).toBe(true)
  })

  it('extends auditable target types for governance management', () => {
    for (const target of ['user', 'department', 'class', 'student', 'guardian', 'school']) {
      expect(targetTypeSchema.safeParse(target).success).toBe(true)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  departmentTypeSchema,
  managedRecordStatusSchema,
  schoolAdminClassCreateSchema,
  schoolAdminDepartmentCreateSchema,
  schoolAdminDepartmentMemberSchema,
  schoolAdminStudentCreateSchema,
  schoolAdminStudentGuardianSchema,
  schoolAdminUserInviteSchema,
  targetTypeSchema
} from '../shared/contracts'

describe('management contracts', () => {
  it('limits managed record status to archive-style lifecycle values', () => {
    expect(managedRecordStatusSchema.safeParse('active').success).toBe(true)
    expect(managedRecordStatusSchema.safeParse('archived').success).toBe(true)
    expect(managedRecordStatusSchema.safeParse('deleted').success).toBe(false)
  })

  it('keeps user invitations scoped to teacher and psychologist roles', () => {
    expect(schoolAdminUserInviteSchema.safeParse({ name: '李老师', phone: '13800000001', role: 'teacher' }).success).toBe(true)
    expect(schoolAdminUserInviteSchema.safeParse({ name: '校管', phone: '13800000001', role: 'school_admin' }).success).toBe(false)
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

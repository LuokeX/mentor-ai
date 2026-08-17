import { describe, expect, it } from 'vitest'
import {
  schoolAdminStudentCreateSchema,
  schoolAdminUserInviteSchema,
  schoolAdminUserUpdateSchema,
} from '../shared/contracts'

describe('dateInputSchema 契约验证', () => {
  it('邀请用户：接受 YYYY-MM-DD 纯日期（date input 直传）', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
      hiredAt: '2026-08-11',
    })
    expect(result.success).toBe(true)
  })

  it('邀请用户：仍接受完整 ISO 时间', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
      hiredAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('邀请用户：不填 hiredAt 正常通过', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
    })
    expect(result.success).toBe(true)
  })

  it('拒绝非法日期字符串', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
      hiredAt: '2026-13-99',
    })
    expect(result.success).toBe(false)
  })

  it('编辑账号：hiredAt 支持纯日期与 null', () => {
    const withDate = schoolAdminUserUpdateSchema.safeParse({ hiredAt: '2026-08-11' })
    const withNull = schoolAdminUserUpdateSchema.safeParse({ hiredAt: null })
    expect(withDate.success).toBe(true)
    expect(withNull.success).toBe(true)
  })

  it('邀请用户：gender / title 传 null（前端“无/其他”默认值）通过', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
      gender: null,
      title: null,
      subject: null,
      employeeNo: null,
    })
    expect(result.success).toBe(true)
  })

  it('邀请用户：完整表单（模拟前端 saveUser 载荷）通过', () => {
    const result = schoolAdminUserInviteSchema.safeParse({
      name: '测试老师',
      email: 't@school.edu.cn',
      role: 'teacher',
      employeeNo: 'T001',
      gender: null,
      teachingGrades: [7, 8],
      subject: '语文',
      isClassTeacher: false,
      classTeacherYears: null,
      hiredAt: '2026-08-11',
      title: null,
    })
    expect(result.success).toBe(true)
  })

  it('学生创建：birthDate / enrolledAt 支持纯日期', () => {
    const result = schoolAdminStudentCreateSchema.safeParse({
      name: '张三',
      birthDate: '2015-03-01',
      enrolledAt: '2026-09-01',
    })
    expect(result.success).toBe(true)
  })
})
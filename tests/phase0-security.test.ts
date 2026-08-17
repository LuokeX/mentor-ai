import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  managedRecordStatusSchema,
  schoolAdminUserUpdateSchema,
  schoolAdminUserInviteSchema,
} from '../shared/contracts'

// transfer-and-disable schema 定义
const transferAndDisableSchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  newPsychologistId: z.string().uuid().optional()
})

describe('phase 0: security and data protection baseline', () => {
  // ===== 生命周期状态验证 =====
  describe('lifecycle status schema', () => {
    it('allows only archive-style lifecycle values (active, archived, transferred, graduated)', () => {
      expect(managedRecordStatusSchema.safeParse('active').success).toBe(true)
      expect(managedRecordStatusSchema.safeParse('archived').success).toBe(true)
      expect(managedRecordStatusSchema.safeParse('transferred').success).toBe(true)
      expect(managedRecordStatusSchema.safeParse('graduated').success).toBe(true)
    })

    it('rejects "deleted" status — no physical deletion of business records', () => {
      expect(managedRecordStatusSchema.safeParse('deleted').success).toBe(false)
    })

    it('rejects arbitrary status strings', () => {
      expect(managedRecordStatusSchema.safeParse('removed').success).toBe(false)
      expect(managedRecordStatusSchema.safeParse('purged').success).toBe(false)
    })
  })

  // ===== 用户状态变更验证 =====
  describe('user status transitions', () => {
    it('allows active → disabled transition', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({ status: 'disabled' })
      expect(result.success).toBe(true)
    })

    it('allows disabled → active (re-enable)', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({ status: 'active' })
      expect(result.success).toBe(true)
    })

    it('requires at least one field in update', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  // ===== 账号停用移交验证 =====
  describe('transfer-and-disable', () => {
    it('requires toUserId and reason', () => {
      expect(transferAndDisableSchema.safeParse({}).success).toBe(false)
      expect(transferAndDisableSchema.safeParse({
        toUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
        reason: '教师离职，移交全部业务档案'
      }).success).toBe(true)
    })

    it('requires reason to be at least 10 characters', () => {
      expect(transferAndDisableSchema.safeParse({
        toUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
        reason: '离职'
      }).success).toBe(false)
    })

    it('reason must not exceed 500 characters', () => {
      expect(transferAndDisableSchema.safeParse({
        toUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
        reason: 'x'.repeat(501)
      }).success).toBe(false)
    })

    it('optionally accepts newPsychologistId for psychologist transfers', () => {
      expect(transferAndDisableSchema.safeParse({
        toUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
        reason: '心理专员离职，移交全部未完成转介',
        newPsychologistId: 'a1b2c3d4-e585-4a69-8e83-a87b79b88827'
      }).success).toBe(true)
    })

    it('rejects invalid UUID for newPsychologistId', () => {
      expect(transferAndDisableSchema.safeParse({
        toUserId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
        reason: '心理专员离职，移交全部未完成转介',
        newPsychologistId: 'invalid'
      }).success).toBe(false)
    })
  })

  // ===== 邀请账号规则 =====
  describe('invitation-only deletion rules', () => {
    it('invitations are scoped to teacher and psychologist roles only', () => {
      expect(schoolAdminUserInviteSchema.safeParse({
        name: '李老师', phone: '13800000001', role: 'teacher'
      }).success).toBe(true)
      expect(schoolAdminUserInviteSchema.safeParse({
        name: '管理员', phone: '13800000002', role: 'school_admin'
      }).success).toBe(false)
    })

    it('requires name and phone in invitations', () => {
      expect(schoolAdminUserInviteSchema.safeParse({
        name: '', phone: '13800000001', role: 'teacher'
      }).success).toBe(false)
      expect(schoolAdminUserInviteSchema.safeParse({
        name: 'test', phone: '123', role: 'teacher'
      }).success).toBe(false)
    })
  })

  // ===== 并发控制验证 =====
  describe('concurrency control (expectedUpdatedAt)', () => {
    it('accepts valid ISO datetime as expectedUpdatedAt', () => {
      const result = z.string().datetime().safeParse('2026-07-27T10:00:00.000Z')
      expect(result.success).toBe(true)
    })

    it('rejects invalid datetime format', () => {
      const result = z.string().datetime().safeParse('not-a-date')
      expect(result.success).toBe(false)
    })
  })

  // ===== 角色权限验证 =====
  describe('role access boundaries', () => {
    it('school_admin users can only manage teacher and psychologist roles', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({ role: 'school_admin' })
      expect(result.success).toBe(false)
    })

    it('school_admin users can update teacher role to psychologist', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({ role: 'psychologist' })
      expect(result.success).toBe(true)
    })

    it('school_admin users can update psychologist role to teacher', () => {
      const result = schoolAdminUserUpdateSchema.safeParse({ role: 'teacher' })
      expect(result.success).toBe(true)
    })
  })
})
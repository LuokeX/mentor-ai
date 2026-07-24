import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecoveryCodes, invitationExpiresAt } from '../server/domain/invitations'
import { defaultActionDueAt, defaultReviewAt } from '../server/domain/plan-actions'
import { governBusinessContext } from '../server/domain/ai-governance'
import { parseImportFile } from '../server/domain/school-imports'

describe('校内试用核心不变量', () => {
  it('邀请有效期固定为 72 小时', () => {
    const now = new Date('2026-07-17T00:00:00.000Z')
    expect(invitationExpiresAt(now).getTime() - now.getTime()).toBe(72 * 60 * 60 * 1000)
  })

  it('恢复码为一次性可分发格式且互不重复', () => {
    const codes = createRecoveryCodes()
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    expect(codes.every(code => /^[A-F0-9]{6}-[A-F0-9]{6}$/.test(code))).toBe(true)
  })

  it('新方案默认三天动作与七天复盘节点', () => {
    const createdAt = new Date('2026-07-17T08:00:00.000Z')
    expect(defaultActionDueAt(createdAt, 0).toISOString()).toBe('2026-07-18T08:00:00.000Z')
    expect(defaultActionDueAt(createdAt, 4).toISOString()).toBe('2026-07-20T08:00:00.000Z')
    expect(defaultReviewAt(createdAt).toISOString()).toBe('2026-07-24T08:00:00.000Z')
  })

  it('CSV 支持 BOM、引号和内容校验值', () => {
    const csv = '\uFEFFname,email,role\n"张,老师",teacher@example.edu.cn,teacher\n'
    const result = parseImportFile('users', Buffer.from(csv).toString('base64'))
    expect(result.rows).toEqual([{ name: '张,老师', email: 'teacher@example.edu.cn', role: 'teacher' }])
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(result.errors).toEqual([])
  })

  it('完整上下文也移除联系方式、系统标识与密钥', () => {
    const context = {
      type: 'student' as const,
      id: '11111111-1111-4111-8111-111111111111',
      label: '小王同学',
      prompt: '',
      snapshot: {
        student: { id: 'uuid', name: '小王同学', phone: '13800000000', email: 'a@example.com', notes: '近期需要支持' },
        totpSecret: 'never-send'
      }
    }
    const result = governBusinessContext(context, 'full_context')!
    expect(result.id).toBe('')
    expect(JSON.stringify(result.snapshot)).toContain('小王同学')
    expect(JSON.stringify(result.snapshot)).not.toContain('13800000000')
    expect(JSON.stringify(result.snapshot)).not.toContain('a@example.com')
    expect(JSON.stringify(result.snapshot)).not.toContain('never-send')
  })

  it('首页聊天只做分诊，通知 Worker 不扩散学生信息', () => {
    const chat = readFileSync(new URL('../server/api/v1/chat/messages.post.ts', import.meta.url), 'utf8')
    const worker = readFileSync(new URL('../server/plugins/notification-worker.ts', import.meta.url), 'utf8')
    expect(chat).toContain("emit(controller, 'route'")
    expect(chat).toContain('AI 只推荐模块，不生成工具、方案或知识库引用')
    expect(chat).not.toContain("emit(controller, 'plan_update_suggestions'")
    expect(worker).toContain('INSERT INTO notifications')
    expect(worker).not.toContain('studentNameEnc')
    expect(worker).not.toContain('decryptSensitive')
  })
})

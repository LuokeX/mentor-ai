import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecoveryCodes, invitationExpiresAt } from '../server/domain/invitations'
import { defaultActionDueAt, defaultReviewAt, derivePlanActionSnapshots, mergePlanActionSnapshots, nextPlanActionSequence } from '../server/domain/plan-actions'
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

  it('合并量表时行动序号从已有最大值后继续', () => {
    expect(nextPlanActionSequence(null)).toBe(0)
    expect(nextPlanActionSequence(2)).toBe(3)
  })

  it('合并量表时保留旧行动状态且只追加新行动', () => {
    const merged = mergePlanActionSnapshots(
      [{ title: '观察', detail: '记录一次课堂表现', status: 'completed' }],
      [
        { title: '观察', detail: '记录一次课堂表现', status: 'pending' },
        { title: '沟通', detail: '完成一次简短沟通', status: 'pending' }
      ]
    )
    expect(merged).toEqual([
      { title: '观察', detail: '记录一次课堂表现', status: 'completed' },
      { title: '沟通', detail: '完成一次简短沟通', status: 'pending' }
    ])
  })

  it('旧方案没有行动快照时从报告建议派生跟踪动作', () => {
    expect(derivePlanActionSnapshots([], {
      firstAction: { title: '不会优先使用', detail: '三日行动存在时不用这个兜底' },
      threeDayPlan: [
        { day: 1, actions: [{ title: '完成一次观察', detail: '记录事实和变化。' }] },
        { day: 2, actions: [{ title: '完成一次观察', detail: '记录事实和变化。' }] },
        { day: 3, actions: [{ title: '与同伴复盘', detail: '确认下一步支持。' }] }
      ]
    })).toEqual([
      { title: '完成一次观察', detail: '记录事实和变化。', status: 'pending' },
      { title: '与同伴复盘', detail: '确认下一步支持。', status: 'pending' }
    ])
  })

  it('报告建议不会覆盖已有跟踪动作', () => {
    const existing = [{ title: '教师自定义行动', detail: '保留人工调整。', status: 'in_progress' }]
    expect(derivePlanActionSnapshots(existing, {
      threeDayPlan: [{ actions: [{ title: '报告建议', detail: '不应覆盖。' }] }]
    })).toBe(existing)
  })

  it('CSV 支持 BOM、引号和内容校验值', () => {
    const csv = '\uFEFFname,phone,role\n"张,老师",13800000001,teacher\n'
    const result = parseImportFile('users', Buffer.from(csv).toString('base64'))
    expect(result.rows).toEqual([{ name: '张,老师', phone: '13800000001', role: 'teacher' }])
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

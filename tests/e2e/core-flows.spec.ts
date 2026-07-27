import { expect, test } from '@playwright/test'
import * as OTPAuth from 'otpauth'

async function login(page: import('@playwright/test').Page, email: string, options: { password?: string, otp?: string } = {}) {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email, password: options.password || 'Mentor@2026', ...(options.otp ? { otp: options.otp } : {}) }
  })
  expect(response.ok()).toBeTruthy()
  const result = await response.json()
  const homes: Record<string, string> = {
    teacher: '/',
    psychologist: '/specialist',
    school_admin: '/school-admin',
    platform_admin: '/platform-admin'
  }
  await page.goto(homes[result.role] || '/')
}

test.describe('四角色核心路径', () => {
  test.describe.configure({ timeout: 90_000 })

  test('教师登录、移动导航与 AI 咨询', async ({ page }, testInfo) => {
    await login(page, 'teacher@demo.local')
    await expect(page.getByRole('heading', { name: /今天遇到了什么/ })).toBeVisible()
    if (testInfo.project.name === 'mobile-chromium') await expect(page.getByRole('link', { name: '事件', exact: true })).toBeVisible()
    await page.getByLabel('向 AI 赋能助手提问').fill('我想先梳理一下班级纪律反复的问题。')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.getByText('这条回答有帮助吗？').last()).toBeVisible({ timeout: 30_000 })
  })

  test('教师从模块说明进入评估、确认方案并完成执行闭环', async ({ page }) => {
    await login(page, 'teacher@demo.local')
    await page.goto('/module/self_growth')
    await expect(page.getByRole('heading', { name: '班主任状态五问' })).toBeVisible()
    await expect(page.getByText('完成后会生成确定性评估报告、3 天行动方案和 7 天复盘节点；到期动作会进入“今日待办”。')).toBeVisible()

    await expect(page.getByText('正在检查未完成草稿……')).toBeHidden()
    const start = page.getByRole('button', { name: '开始完整评估' })
    if (await start.isVisible()) await start.click()
    else await page.getByRole('button', { name: '重新开始' }).click()

    for (let questionIndex = 0; questionIndex < 5; questionIndex++) {
      await expect(page.getByText(`${questionIndex + 1} / 5`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '3 有时', exact: true }).click()
    }
    const submit = page.getByRole('button', { name: '提交并生成方案' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByText('评估完成 · 行动方案已创建')).toBeVisible({ timeout: 45_000 })
    const firstAction = page.getByRole('link', { name: '开始执行第一个行动' })
    await expect(firstAction).toHaveAttribute('href', /\/information\/plans\/[0-9a-f-]{36}/)
    await firstAction.click()
    await expect(page.getByText('方案确认')).toBeVisible()
    await page.getByRole('button', { name: '接受执行' }).click()
    await expect(page.getByText('已接受')).toBeVisible()

    const executionSection = page.locator('section').filter({ hasText: '方案执行' })
    const firstActionRow = executionSection.locator('.cursor-pointer').first()
    await firstActionRow.click()
    await page.getByLabel('执行结果').fill('已完成一次最小行动，并记录了当天状态变化。')
    const completedResponse = page.waitForResponse(response =>
      response.url().includes('/api/v1/plans/') &&
      response.url().includes('/actions') &&
      response.request().method() === 'PATCH'
    )
    await executionSection.getByRole('button', { name: '保存并标记完成' }).click()
    expect((await completedResponse).ok()).toBeTruthy()
    await expect(executionSection.getByText('已完成').first()).toBeVisible({ timeout: 15_000 })

    await page.getByLabel('下一步动作').fill('继续观察一周并在周五复盘')
    await page.getByLabel('进展说明').fill('本周已完成一个行动，准备继续跟进。')
    await page.getByRole('button', { name: '保存复盘' }).click()
    await expect(page.getByText('效果 3/5')).toBeVisible()

    await page.getByRole('button', { name: '提交质量反馈' }).click()
    await expect(page.getByText('1 次反馈')).toBeVisible()
  })

  test('学校管理员创建教师账号并查看方案运营看板', async ({ page }) => {
    await login(page, 'school.admin@demo.local')
    await expect(page.getByRole('heading', { name: '学校管理后台' })).toBeVisible()
    const email = `pilot-${Date.now()}@demo.local`
    const response = await page.request.post('/api/v1/school-admin/users', {
      data: { name: '试点教师', email, role: 'teacher', password: 'PilotTeacher@2026' }
    })
    expect(response.ok()).toBeTruthy()
    await page.goto('/school-admin?tab=operations')
    await expect(page.getByRole('heading', { name: '方案运营看板' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '待确认' })).toBeVisible()
    await page.getByRole('button', { name: '退出' }).click()
    await login(page, email, { password: 'PilotTeacher@2026' })
    await expect(page.getByRole('heading', { name: /今天遇到了什么/ })).toBeVisible()
  })

  test('心理专员 MFA 登录并查看 SLA 工作台', async ({ page }) => {
    const totp = new OTPAuth.TOTP({
      issuer: '教师赋能智能平台', label: 'psychologist@demo.local', algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP')
    })
    await login(page, 'psychologist@demo.local', { otp: totp.generate() })
    await expect(page.getByRole('heading', { name: '心理专员工作台' })).toBeVisible()
    await expect(page.getByText('最小必要转介空间')).toBeVisible()
  })

  test('平台管理员权限入口', async ({ page }) => {
    await login(page, 'platform.admin@demo.local')
    await expect(page).toHaveURL(/\/platform-admin/)
    await expect(page.getByRole('heading', { name: '平台管理后台' })).toBeVisible()
    await page.goto('/platform-admin/resources')
    await expect(page.getByRole('heading', { name: '资源导入、校验与发布' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '质量反哺' })).toBeVisible()
  })
})

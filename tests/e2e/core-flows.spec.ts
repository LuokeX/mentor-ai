import { expect, test } from '@playwright/test'
import * as OTPAuth from 'otpauth'

async function login(page: import('@playwright/test').Page, email: string, otp?: string) {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: '安全登录' })
  await expect(submit).toBeEnabled()
  const demoLabels: Record<string, string> = {
    'teacher@demo.local': '李老师（教师）',
    'psychologist@demo.local': '王心理专员',
    'school.admin@demo.local': '学校管理员',
    'platform.admin@demo.local': '平台管理员'
  }
  const demoSelect = page.getByLabel('演示账号')
  if (await demoSelect.isVisible()) {
    await demoSelect.click()
    await page.getByRole('option', { name: demoLabels[email] }).click()
  } else {
    await page.getByLabel('邮箱').fill(email)
  }
  await expect(page.getByLabel('邮箱')).toHaveValue(email)
  await page.getByLabel('密码').fill('Mentor@2026')
  await submit.click()
  if (otp) {
    await page.getByLabel('心理专员动态验证码').fill(otp)
    await submit.click()
  }
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('四角色核心路径', () => {
  test('教师登录、移动导航与 AI 咨询', async ({ page }, testInfo) => {
    await login(page, 'teacher@demo.local')
    await expect(page.getByRole('heading', { name: /今天遇到了什么/ })).toBeVisible()
    if (testInfo.project.name === 'mobile-chromium') await expect(page.getByRole('link', { name: '通知' })).toBeVisible()
    await page.getByLabel('向 AI 赋能助手提问').fill('我想先梳理一下班级纪律反复的问题。')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.getByText('这条回答有帮助吗？').last()).toBeVisible({ timeout: 30_000 })
  })

  test('教师从模块说明进入评估并承接首个行动', async ({ page }) => {
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
    await page.getByRole('button', { name: '提交并生成方案' }).click()

    await expect(page.getByText('评估完成 · 行动方案已创建')).toBeVisible({ timeout: 30_000 })
    const firstAction = page.getByRole('link', { name: '开始执行第一个行动' })
    await expect(firstAction).toHaveAttribute('href', /\/information\/plans\/[0-9a-f-]{36}/)
    await page.getByRole('button', { name: '带着报告问助手' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByLabel('向 AI 赋能助手提问')).toHaveValue(/我刚完成「自我成长赋能」评估/)
  })

  test('学校管理员创建一次性邀请并完成教师激活', async ({ page }) => {
    await login(page, 'school.admin@demo.local')
    await expect(page.getByRole('heading', { name: '学校管理后台' })).toBeVisible()
    const email = `pilot-${Date.now()}@demo.local`
    const response = await page.request.post('/api/v1/school-admin/users', {
      data: { name: '试点教师', email, role: 'teacher' }
    })
    expect(response.ok()).toBeTruthy()
    const invitation = await response.json()
    await page.goto(`/activate?token=${encodeURIComponent(invitation.activationToken)}`)
    await expect(page.getByRole('heading', { name: '账号激活' })).toBeVisible()
    await page.getByLabel('设置密码').fill('PilotTeacher@2026')
    await page.getByLabel('确认密码').fill('PilotTeacher@2026')
    await page.getByRole('button', { name: '继续' }).click()
    await expect(page.getByRole('heading', { name: '账号激活成功' })).toBeVisible()
  })

  test('心理专员 MFA 登录并查看 SLA 工作台', async ({ page }) => {
    const totp = new OTPAuth.TOTP({
      issuer: '教师赋能智能平台', label: 'psychologist@demo.local', algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP')
    })
    await login(page, 'psychologist@demo.local', totp.generate())
    await expect(page.getByRole('heading', { name: '心理专员工作台' })).toBeVisible()
    await expect(page.getByText('最小必要转介空间')).toBeVisible()
  })

  test('平台管理员权限入口', async ({ page }) => {
    await login(page, 'platform.admin@demo.local')
    await expect(page).toHaveURL(/\/platform-admin/)
    await expect(page.getByRole('heading', { name: '平台管理后台' })).toBeVisible()
  })
})

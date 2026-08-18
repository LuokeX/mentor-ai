import { chromium, expect } from '@playwright/test'

const baseURL = 'http://172.16.31.12:3300'
const feedback = `浏览器业务测试反馈 ${new Date().toISOString()}：已按计划执行，学生/班级反应稳定，后续继续观察。`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ baseURL })

try {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: '安全登录' })
  await expect(submit).toBeEnabled()

  const demoSelect = page.getByLabel('演示账号')
  if (await demoSelect.isVisible().catch(() => false)) {
    await demoSelect.click()
    await page.getByRole('option', { name: '李老师（教师）' }).click()
  } else {
    await page.getByLabel('手机号').fill('13900001001')
  }
  await page.getByLabel('密码').fill('Mentor@2026')
  await submit.click()
  await expect(page).not.toHaveURL(/\/login/)

  await page.goto('/module/self_growth')
  await expect(page.getByRole('heading', { name: '班主任状态五问' })).toBeVisible()
  await expect(page.getByText('正在检查未完成草稿……')).toBeHidden()

  const start = page.getByRole('button', { name: '开始完整评估' })
  if (await start.isVisible().catch(() => false)) {
    await start.click()
  } else {
    await page.getByRole('button', { name: '重新开始' }).click()
  }

  for (let index = 0; index < 5; index += 1) {
    await expect(page.getByText(`${index + 1} / 5`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '3 有时', exact: true }).click()
  }

  await page.getByRole('button', { name: '提交并生成方案' }).click()
  // 提交后自动跳转到方案详情页（报告与方案统一在此查看）
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}/, { timeout: 30_000 })

  await expect(page.getByRole('heading', { name: '方案执行' })).toBeVisible()
  await expect(page.getByText(/0\/\d+ 项完成/)).toBeVisible()

  const firstActionTitle = page.locator('section', { hasText: '方案执行' }).locator('p.text-sm.font-medium').first()
  const firstActionText = await firstActionTitle.innerText()
  await firstActionTitle.click()

  await page.getByLabel('执行日期').fill('2026-07-22T15:40')
  await page.getByLabel('执行结果').fill(feedback)
  await page.getByRole('button', { name: '保存并标记完成' }).click()

  await expect(page.getByText('已反馈').first()).toBeVisible()
  await expect(page.getByText(feedback)).toBeVisible()
  await expect(page.getByText(/1\/\d+ 项完成/)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '方案执行' })).toBeVisible()
  await expect(page.getByText('已反馈').first()).toBeVisible()
  await expect(page.getByText(feedback)).toBeVisible()

  console.log(JSON.stringify({
    ok: true,
    url: page.url(),
    firstAction: firstActionText,
    feedbackPersisted: true
  }, null, 2))
} finally {
  await browser.close()
}

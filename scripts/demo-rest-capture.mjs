/**
 * 补齐演示截图：学生详情、危机熔断、心理专员、学校管理员、平台管理员
 * 用法：node scripts/demo-rest-capture.mjs
 */
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3300'
const OUT = 'docs/demo-assets'
const PASSWORD = 'Mentor@2026'

async function shot(page, name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`[ok] ${name}.png`)
}

async function login(page, phone) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('手机号').fill(phone)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '安全登录' }).click()
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 })

// ============ 10 学生详情（张老师）============
try {
  const page = await context.newPage()
  await login(page, '13900001002')
  await page.waitForURL(`${BASE}/`)
  console.log('step: student detail')
  const resp = await context.request.get(`${BASE}/api/v1/information/students?page=1&pageSize=20&q=${encodeURIComponent('王浩然')}`)
  const data = await resp.json()
  const rows = data.rows || data || []
  const student = rows.find((s) => String(s.name || s.displayName || '').includes('王浩然'))
  if (!student?.id) throw new Error('student id not found')
  await page.goto(`${BASE}/information/students/${student.id}`)
  await page.waitForTimeout(2500)
  await shot(page, '10-student-detail')
  await page.close()
} catch (e) { console.log('FAIL 10:', e.message) }

// ============ 11 危机熔断（李老师）============
try {
  const page = await context.newPage()
  await login(page, '13900001001')
  await page.waitForURL(`${BASE}/`)
  await page.getByRole('heading', { name: /今天遇到了什么/ }).waitFor({ timeout: 20000 })
  console.log('step: crisis fuse')
  await page.getByLabel('向 AI 赋能助手提问').fill('班上有个女生最近经常哭，成绩突然大幅下滑，被同学孤立，说自己什么都做不好，不想活了。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByRole('heading', { name: '常规建议已暂停' }).waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500)
  await shot(page, '11-crisis-fuse')
  await page.close()
} catch (e) { console.log('FAIL 11:', e.message) }

// ============ 12 心理专员 ============
try {
  const page = await context.newPage()
  await login(page, '13900001003')
  await page.waitForURL(/\/specialist/, { timeout: 20000 })
  await page.getByRole('heading', { name: '心理专员工作台' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, '12-specialist-workbench')
  await page.close()
} catch (e) { console.log('FAIL 12:', e.message) }

// ============ 13/14 学校管理员 ============
try {
  const page = await context.newPage()
  await login(page, '13900001004')
  await page.waitForURL(/\/school-admin/, { timeout: 20000 })
  await page.getByRole('heading', { name: '学校管理后台' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, '13-school-admin-home')

  await page.goto(`${BASE}/school-admin/classes`)
  await page.getByRole('heading', { name: '班级管理' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '14-school-admin-classes')
  await page.close()
} catch (e) { console.log('FAIL 13/14:', e.message) }

// ============ 15/16/17 平台管理员 ============
try {
  const page = await context.newPage()
  await login(page, '13900001005')
  await page.waitForURL(/\/platform-admin/, { timeout: 20000 })
  await page.getByRole('heading', { name: '平台管理后台' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, '15-platform-admin-home')

  await page.goto(`${BASE}/platform-admin/resources`)
  await page.getByRole('heading', { name: '三库运营台' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '16-platform-resources')

  await page.goto(`${BASE}/platform-admin/schools`)
  await page.getByRole('heading', { name: /学校管理/ }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '17-platform-schools')
  await page.close()
} catch (e) { console.log('FAIL 15/16/17:', e.message) }

await browser.close()
console.log('DONE')
/**
 * 演示截图脚本：驱动真实 UI 走完四角色核心路径，逐环节截图到 docs/demo-assets/
 * 用法：node scripts/demo-capture.mjs
 * 前置：dev server 运行在 3300，数据库已 seed
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

async function logout(page) {
  await page.getByRole('button', { name: '退出' }).click().catch(() => {})
  await page.waitForURL('**/login', { timeout: 15000 }).catch(() => {})
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 })

// ============ 教师主线 ============
{
  const page = await context.newPage()
  await page.goto(`${BASE}/login`)
  await page.waitForTimeout(900)
  await shot(page, '01-login')

  await login(page, '13900001002')
  await page.waitForURL(`${BASE}/`)
  await page.getByRole('heading', { name: /今天遇到了什么/ }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(2500) // 打字机问候动画
  await shot(page, '02-teacher-home')

  // AI 分诊：发送快捷提问 → 进入澄清轮
  await page.getByRole('button', { name: '小明上课经常走神，作业拖拉到半夜，数学计算经常看错符号，考前紧张到手抖，说自己就是学不好。', exact: true }).click()
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText(/追问第\d+轮/).waitFor({ timeout: 60000 })
  await page.waitForTimeout(1200)
  await shot(page, '03-ai-clarification')

  // 选择第一个选项 → 第二轮澄清
  const options = page.locator('div').filter({ hasText: /追问第\d+轮/ }).last().getByRole('button')
  await options.first().click()
  await page.getByText(/追问第2轮/).waitFor({ timeout: 60000 })

  // 结束澄清 → 分析总结
  await page.getByRole('button', { name: '不补充了，直接开始分析' }).click()
  await page.getByText('分析结果').waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500)
  await shot(page, '04-ai-summary')

  // 点击总结卡片中的建议按钮进入模块（文案由模型生成："进入XX模块评估"）
  const moduleBtn = page.getByRole('button', { name: /进入.+评估/ }).first()
  await moduleBtn.click().catch(async () => {
    await page.goto(`${BASE}/module/self_growth`)
  })
  await page.waitForURL(/\/module\//, { timeout: 20000 })
  // 点推荐量表卡（模块页多量表选择器）
  await page.getByRole('button').filter({ hasText: /教师心理资本与状态深度评估/ }).first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.getByText(/准备好后开始完整评估|发现未完成评估/).waitFor({ timeout: 20000 })
  if (await page.getByRole('button', { name: '重新开始' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '重新开始' }).click() // 清掉历史草稿，从零演示
  } else {
    await page.getByRole('button', { name: '开始完整评估' }).click()
  }
  await page.getByText(/1 \/ \d+|\d+ \/ \d+/).first().waitFor({ timeout: 15000 })
  await shot(page, '05-module-assessment')

  // 完成评估：点第 3 档选项，choose() 自动前进到下一题；最后一题后提交按钮可用
  for (let i = 0; i < 20; i++) {
    const submit = page.getByRole('button', { name: '提交并生成方案' })
    if (await submit.isEnabled().catch(() => false)) break
    const opts = page.locator('div.mt-7.space-y-3 button')
    const n = await opts.count()
    if (!n) break
    await opts.nth(Math.min(2, n - 1)).click()
    await page.waitForTimeout(500)
  }
  await page.getByRole('button', { name: '提交并生成方案' }).click()
  // 提交后自动进入方案详情页
  await page.waitForURL(/\/information\/plans\/[0-9a-f-]{36}/, { timeout: 60000 })
  await shot(page, '06-plan-created')

  // 方案确认
  await page.getByText('方案确认').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '接受执行' }).click()
  await page.getByText('已接受').waitFor({ timeout: 15000 })
  await shot(page, '07-plan-confirm')

  // 执行第一个动作
  const execSection = page.locator('section').filter({ hasText: '方案执行' })
  await execSection.locator('.cursor-pointer').first().click()
  await page.getByLabel('执行结果').fill('已完成一次最小行动，并记录了当天状态变化。')
  await execSection.getByRole('button', { name: '保存并标记完成' }).click()
  await execSection.getByText('已完成').first().waitFor({ timeout: 15000 })
  await shot(page, '08-plan-execution')

  // 信息中心：学生列表 + 学生详情
  await page.goto(`${BASE}/information/students`)
  await page.getByRole('heading', { name: '我负责的学生' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '09-information-students')
  console.log('step: student detail via API')
  // 通过 API 拿学生 id 后直接进入详情页（行点击在部分环境不可靠）
  const studentsResp = await context.request.get(`${BASE}/api/v1/information/students?q=${encodeURIComponent('王浩然')}`)
  const studentsData = await studentsResp.json()
  const student = (studentsData.rows || studentsData || []).find((s) => (s.name || '').includes('王浩然') || (s.displayName || '').includes('王浩然'))
  if (!student?.id) throw new Error('王浩然 id 未找到: ' + JSON.stringify(studentsData).slice(0, 300))
  await page.goto(`${BASE}/information/students/${student.id}`)
  await page.waitForTimeout(2000)
  await shot(page, '10-student-detail')
  console.log('step: crisis fuse')

  // ============ 危机熔断 ============
  await logout(page)
  await login(page, '13900001001')
  await page.waitForURL(`${BASE}/`)
  await page.getByRole('heading', { name: /今天遇到了什么/ }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '新对话' }).first().click().catch(() => {})
  await page.getByLabel('向 AI 赋能助手提问').fill('班上有个女生最近经常哭，成绩突然大幅下滑，被同学孤立，说自己什么都做不好，不想活了。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('常规建议已暂停').waitFor({ timeout: 60000 })
  await page.waitForTimeout(1500)
  await shot(page, '11-crisis-fuse')
  await page.close()
}

// ============ 心理专员 ============
{
  const page = await context.newPage()
  await login(page, '13900001003')
  await page.waitForURL(/\/specialist/, { timeout: 20000 })
  await page.getByRole('heading', { name: '心理专员工作台' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, '12-specialist-workbench')
  await page.close()
}

// ============ 学校管理员 ============
{
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
}

// ============ 平台管理员 ============
{
  const page = await context.newPage()
  await login(page, '13900001005')
  await page.waitForURL(/\/platform-admin/, { timeout: 20000 })
  await page.getByRole('heading', { name: '平台管理后台' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, '15-platform-admin-home')

  await page.goto(`${BASE}/platform-admin/resources`)
  await page.getByRole('heading', { name: '资源导入、校验与发布' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '16-platform-resources')

  await page.goto(`${BASE}/platform-admin/schools`)
  await page.getByRole('heading', { name: /学校管理/ }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await shot(page, '17-platform-schools')
  await page.close()
}

await browser.close()
console.log('DONE: all screenshots captured')
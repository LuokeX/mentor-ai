import { expect, test } from '@playwright/test'
import * as OTPAuth from 'otpauth'

async function login(page: import('@playwright/test').Page, phone: string, options: { password?: string, otp?: string } = {}) {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { phone, password: options.password || 'Mentor@2026', ...(options.otp ? { otp: options.otp } : {}) }
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
  // 等待 Vue 挂载完成。注意：Nuxt 4.4 基线不再给 #__nuxt 设置 data-v-app 属性，
  // 因此以根元素上的 __vue_app__ 实例作为挂载标志（两者等价且更稳定）
  await page.waitForFunction(() => !!document.querySelector('#__nuxt')?.__vue_app__)
}

test.describe('四角色核心路径', () => {
  test.describe.configure({ timeout: 90_000 })

  test('教师登录、移动导航与 AI 咨询', async ({ page }, testInfo) => {
    await login(page, '13900001001')
    await expect(page.getByRole('heading', { name: /今天遇到了什么/ })).toBeVisible()
    if (testInfo.project.name === 'mobile-chromium') await expect(page.getByRole('link', { name: '我的方案', exact: true })).toBeVisible()
    await page.getByLabel('向 AI 赋能助手提问').fill('我想先梳理一下班级纪律反复的问题。')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.getByText('这条回答有帮助吗？').last()).toBeVisible({ timeout: 30_000 })
  })

  test('教师从模块说明进入评估、确认方案并完成执行闭环', async ({ page }) => {
    await login(page, '13900001001')
    await page.goto('/module/self_growth')
    await expect(page.getByRole('heading', { name: '班主任状态五问' })).toBeVisible()
    await expect(page.getByText('完成后会生成确定性评估报告、3 天行动方案和 7 天复盘节点；到期动作会进入“今日待办”。')).toBeVisible()

    const start = page.getByRole('button', { name: /^(开始完整评估|重新开始)$/ })
    await expect(start).toBeVisible()
    await start.click()

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

  test('学校管理员邀请并激活教师账号', async ({ page }) => {
    await login(page, '13900001004')
    await expect(page.getByRole('heading', { name: '学校管理后台' })).toBeVisible()
    const phone = `139${String(Date.now()).slice(-8)}`
    const response = await page.request.post('/api/v1/school-admin/users', {
      data: { name: '试点教师', phone, role: 'teacher' }
    })
    expect(response.ok()).toBeTruthy()
    const invitation = await response.json()
    expect(invitation.activationToken).toBeTruthy()
    const activation = await page.request.post('/api/v1/auth/activate', {
      data: { token: invitation.activationToken, password: 'PilotTeacher@2026' }
    })
    expect(activation.ok()).toBeTruthy()
    await page.getByRole('button', { name: '退出' }).click()
    await login(page, phone, { password: 'PilotTeacher@2026' })
    await expect(page.getByRole('heading', { name: /今天遇到了什么/ })).toBeVisible()
  })

  test('统一管理表格 CRUD、并发控制、生命周期与负责人权限', async ({ page }, testInfo) => {
    await login(page, '13900001004')
    const suffix = `${Date.now()}-${testInfo.project.name.replace(/\W+/g, '-')}`
    const teachersResponse = await page.request.get('/api/v1/school-admin/teachers?page=1&pageSize=100&status=active')
    expect(teachersResponse.ok()).toBeTruthy()
    const teachers = await teachersResponse.json() as { rows: Array<{ id: string, phone: string }> }
    const teacher = teachers.rows.find(item => item.phone === '13900001001')
    expect(teacher).toBeTruthy()

    const className = `验收班级-${suffix}`
    const classResponse = await page.request.post('/api/v1/school-admin/classes', {
      data: {
        name: className,
        grade: 7,
        ownerUserId: teacher!.id,
        externalCode: `E2E-C-${suffix}`,
        studentCount: 0,
      },
    })
    expect(classResponse.ok()).toBeTruthy()
    const createdClass = await classResponse.json() as { id: string, updatedAt: string }

    const studentName = `验收学生-${suffix}`
    const studentResponse = await page.request.post('/api/v1/school-admin/students', {
      data: {
        name: studentName,
        classId: createdClass.id,
        ownerUserId: teacher!.id,
        gender: 'unknown',
        externalRef: `E2E-S-${suffix}`,
      },
    })
    expect(studentResponse.ok()).toBeTruthy()
    const createdStudent = await studentResponse.json() as { id: string }

    const guardianName = `验收家长-${suffix}`
    const guardianResponse = await page.request.post('/api/v1/school-admin/guardians', {
      data: {
        name: guardianName,
        phone: '13800000000',
        relation: '监护人',
        externalRef: `E2E-G-${suffix}`,
        ownerUserId: teacher!.id,
      },
    })
    expect(guardianResponse.ok()).toBeTruthy()
    const createdGuardian = await guardianResponse.json() as { id: string }

    const classListResponse = await page.request.get(`/api/v1/school-admin/classes?page=1&pageSize=20&q=${encodeURIComponent(className)}`)
    const classList = await classListResponse.json() as { rows: Array<{ id: string, _capabilities: string[] }> }
    expect(classList.rows.find(item => item.id === createdClass.id)?._capabilities).toEqual(expect.arrayContaining(['edit', 'archive', 'transfer']))

    const studentListResponse = await page.request.get(`/api/v1/school-admin/students?page=1&pageSize=20&q=${encodeURIComponent(studentName)}`)
    const studentList = await studentListResponse.json() as { rows: Array<{ id: string, updatedAt: string, _capabilities: string[] }> }
    const listedStudent = studentList.rows.find(item => item.id === createdStudent.id)
    expect(listedStudent?._capabilities).toEqual(expect.arrayContaining(['edit', 'archive', 'transfer']))

    const guardianListResponse = await page.request.get(`/api/v1/school-admin/guardians?page=1&pageSize=20&q=${encodeURIComponent(guardianName)}`)
    const guardianList = await guardianListResponse.json() as { rows: Array<{ id: string, updatedAt: string, phoneMasked: string, _capabilities: string[] }> }
    const listedGuardian = guardianList.rows.find(item => item.id === createdGuardian.id)
    expect(listedGuardian?.phoneMasked).toBe('138****0000')
    expect(listedGuardian?._capabilities).toEqual(expect.arrayContaining(['edit', 'archive', 'transfer']))

    await page.goto(`/school-admin/classes?q=${encodeURIComponent(className)}`)
    await expect(page.getByRole('heading', { name: '班级管理' })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByText(className, { exact: true })).toBeVisible()

    await login(page, '13900001001')
    await page.goto(`/information/students?q=${encodeURIComponent(studentName)}`)
    await expect(page.getByRole('heading', { name: '我负责的学生' })).toBeVisible()
    await expect(page.getByText(studentName, { exact: true })).toBeVisible()
    const forbidden = await page.request.get('/api/v1/school-admin/classes?page=1&pageSize=20')
    expect(forbidden.status()).toBe(403)

    await login(page, '13900001004')
    const updatedClassName = `${className}-已更新`
    const updateClass = await page.request.patch(`/api/v1/school-admin/classes/${createdClass.id}?expectedUpdatedAt=${encodeURIComponent(createdClass.updatedAt)}`, {
      data: { name: updatedClassName },
    })
    expect(updateClass.ok()).toBeTruthy()
    const updatedClass = await updateClass.json() as { updatedAt: string }
    const staleUpdate = await page.request.patch(`/api/v1/school-admin/classes/${createdClass.id}?expectedUpdatedAt=${encodeURIComponent(createdClass.updatedAt)}`, {
      data: { name: `${updatedClassName}-冲突写入` },
    })
    expect(staleUpdate.status()).toBe(409)

    const updatedStudentName = `${studentName}-已更新`
    const updateStudent = await page.request.patch(`/api/v1/school-admin/students/${createdStudent.id}?expectedUpdatedAt=${encodeURIComponent(listedStudent!.updatedAt)}`, {
      data: { name: updatedStudentName },
    })
    expect(updateStudent.ok()).toBeTruthy()
    const refreshedStudentsResponse = await page.request.get(`/api/v1/school-admin/students?page=1&pageSize=20&q=${encodeURIComponent(updatedStudentName)}`)
    const refreshedStudents = await refreshedStudentsResponse.json() as { rows: Array<{ id: string, updatedAt: string }> }
    const refreshedStudent = refreshedStudents.rows.find(item => item.id === createdStudent.id)
    expect(refreshedStudent).toBeTruthy()

    const updateGuardian = await page.request.patch(`/api/v1/school-admin/guardians/${createdGuardian.id}?expectedUpdatedAt=${encodeURIComponent(listedGuardian!.updatedAt)}`, {
      data: { relation: '父亲' },
    })
    expect(updateGuardian.ok()).toBeTruthy()
    const refreshedGuardiansResponse = await page.request.get(`/api/v1/school-admin/guardians?page=1&pageSize=20&q=${encodeURIComponent(guardianName)}`)
    const refreshedGuardians = await refreshedGuardiansResponse.json() as { rows: Array<{ id: string, updatedAt: string }> }
    const refreshedGuardian = refreshedGuardians.rows.find(item => item.id === createdGuardian.id)
    expect(refreshedGuardian).toBeTruthy()

    const reason = '端到端验收完成后归档测试数据'
    const archiveStudent = await page.request.post(`/api/v1/school-admin/students/${createdStudent.id}/archive`, {
      data: { expectedUpdatedAt: refreshedStudent!.updatedAt, reason },
    })
    expect(archiveStudent.ok()).toBeTruthy()
    const archiveGuardian = await page.request.post(`/api/v1/school-admin/guardians/${createdGuardian.id}/archive`, {
      data: { expectedUpdatedAt: refreshedGuardian!.updatedAt, reason },
    })
    expect(archiveGuardian.ok()).toBeTruthy()
    const archiveClass = await page.request.post(`/api/v1/school-admin/classes/${createdClass.id}/archive`, {
      data: { expectedUpdatedAt: updatedClass.updatedAt, reason },
    })
    expect(archiveClass.ok()).toBeTruthy()

    const archivedClassResponse = await page.request.get(`/api/v1/school-admin/classes?page=1&pageSize=20&status=archived&q=${encodeURIComponent(updatedClassName)}`)
    const archivedClassList = await archivedClassResponse.json() as { rows: Array<{ id: string, _capabilities: string[] }> }
    expect(archivedClassList.rows.find(item => item.id === createdClass.id)?._capabilities).toEqual(expect.arrayContaining(['view', 'restore']))
  })

  test('心理专员 MFA 登录并查看 SLA 工作台', async ({ page }) => {
    const totp = new OTPAuth.TOTP({
      issuer: '教师赋能智能平台', label: '王心理专员', algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP')
    })
    await login(page, '13900001003', { otp: totp.generate() })
    await expect(page.getByRole('heading', { name: '心理专员工作台' })).toBeVisible()
    await expect(page.getByText('最小必要转介空间')).toBeVisible()
  })

  test('平台管理员权限入口', async ({ page }) => {
    await login(page, '13900001005')
    await expect(page).toHaveURL(/\/platform-admin/)
    await expect(page.getByRole('heading', { name: '平台管理后台' })).toBeVisible()
    await page.goto('/platform-admin/resources')
    await expect(page.getByRole('heading', { name: '三库运营台' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '质量反哺' })).toBeVisible()
  })
})

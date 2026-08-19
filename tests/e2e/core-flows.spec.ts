import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page, phone: string, options: { password?: string } = {}) {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { phone, password: options.password || 'Mentor@2026' }
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
    // SSR 首屏 HTML 立即可见，但 Vue 事件要等客户端 hydration 完成才绑定；
    // 不等就直接点卡片，点击会落在未绑定事件的 DOM 上而无效。
    await page.waitForFunction(() => !!document.querySelector('#__nuxt')?.__vue_app__)
    // 模块页为卡片式选量表（入口筛查 + 深度诊断），点五问自评卡片进入评估准备；
    // 已完成的量表可重新作答，不影响后续断言。
    await expect(page.getByRole('heading', { name: '自我成长赋能 评估' })).toBeVisible()
    await page.getByRole('button', { name: /教师自我成长五问自评/ }).click()
    // 等评估准备页出现（组件初始化完成）再开始作答，避免点击落在组件挂载前
    const start = page.getByRole('button', { name: /^(开始完整评估|重新开始)$/ })
    await expect(start).toBeVisible()
    await start.click()

    for (let questionIndex = 0; questionIndex < 5; questionIndex++) {
      await expect(page.getByText(`${questionIndex + 1} / 5`, { exact: true })).toBeVisible()
      // 业务数据的量表题目选项文案随题型变化（频率型「4 经常」/信心型「4 比较有信心」），
      // 统一点中数值为 4 的选项即可。注意不能全选 3 分：绿色兜底作答会触发
      // 「状态良好，无需方案」分支（不生成方案），本用例需要方案闭环，必须选到
      // 能命中归因证据的高分作答。
      await page.getByRole('button', { name: /^4 / }).click()
    }
    const submit = page.getByRole('button', { name: '提交并生成方案' })
    await expect(submit).toBeEnabled()
    await submit.click()

    // 提交后自动跳转到方案详情页（报告与方案统一在此查看，不再停留完成页）
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}/, { timeout: 45_000 })
    // 方案页按「行动方案建议」区块确认；全部方案块逐条决策后按钮才变为「确认方案并开始执行」
    const recommendations = page.locator('section').filter({ has: page.getByRole('heading', { name: '行动方案建议' }) })
    await expect(recommendations).toBeVisible()
    const includeButtons = recommendations.getByRole('button', { name: '接受', exact: true })
    // 每个方案块都需要单独做纳入决策；点击后按钮先进入 loading 再随刷新消失，
    // 循环点第一个「接受」并等待计数下降，直到没有待决策块。
    let firstAccepted = true
    while (await includeButtons.count()) {
      const countBefore = await includeButtons.count()
      await includeButtons.first().click()
      if (firstAccepted) {
        await expect(recommendations.getByText(/^已接受 1$/)).toBeVisible()
        firstAccepted = false
      }
      await expect.poll(async () => recommendations.getByRole('button', { name: '接受', exact: true }).count(), {
        timeout: 15_000
      }).toBeLessThan(countBefore)
    }
    await recommendations.getByRole('button', { name: '确认方案并开始执行' }).click()
    // 页面同时存在「已接受 N」计数与方案块「已接受」徽标，取任意一个即可
    await expect(page.getByText('已接受').first()).toBeVisible()

    const executionSection = page.locator('section').filter({ hasText: '方案执行' })
    const firstActionRow = executionSection.locator('.cursor-pointer').first()
    await firstActionRow.click()
    // 执行表单当前以「证据摘要」记录执行结果（图片/视频证据为可选补充）
    await page.getByLabel('证据摘要').fill('已完成一次最小行动，并记录了当天状态变化。')
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
    // 反馈提交后显示「最近反馈」摘要（旧版为「1 次反馈」计数）
    await expect(page.getByText(/最近反馈：归因/)).toBeVisible()
  })

  test('学校管理员直接添加并激活教师账号', async ({ page }) => {
    await login(page, '13900001004')
    await expect(page.getByRole('heading', { name: '学校管理后台' })).toBeVisible()
    const phone = `139${String(Date.now()).slice(-8)}`
    // 管理员自定义初始密码：创建即激活，不再产生邀请链接
    const response = await page.request.post('/api/v1/school-admin/users', {
      data: { name: '试点教师', phone, role: 'teacher', password: 'PilotTeacher@2026' }
    })
    expect(response.ok()).toBeTruthy()
    const created = await response.json()
    expect(created.id).toBeTruthy()
    expect(created.generatedPassword).toBeUndefined()
    expect(created.activationToken).toBeUndefined()
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

  test('心理专员登录并查看 SLA 工作台', async ({ page }) => {
    await login(page, '13900001003')
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

import { expect, test, type Page } from '@playwright/test'

const id = '11111111-1111-4111-8111-111111111111'
const sse = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
async function setup(page: Page) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const user = { id, schoolId: id, name: '合成教师', role: 'teacher', phone: '', roleLabel: '教师' }
    const body = path.endsWith('/auth/login') || path.endsWith('/auth/me') ? user
      : path.endsWith('/data-governance') ? { effectiveMode: 'redacted', needsConsent: false }
        : path.endsWith('/context-options') ? { students: [], classes: [], guardians: [] }
          : path.endsWith('/plans') ? { rows: [], total: 0 }
            : path.includes('notifications') ? { rows: [], total: 0, unreadCount: 0 } : []
    await route.fulfill({ json: body })
  })
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: '手机号' }).fill('16600000000')
  await page.locator('input[type="password"]').fill('Synthetic@2026')
  await page.getByRole('button', { name: '安全登录', exact: true }).click()
  await expect(page.getByLabel('向 AI 赋能助手提问')).toBeVisible()
}

test('合成聊天：回答、导航、反馈原因与重新生成', async ({ page }) => {
  await setup(page)
  const reply = (text: string) => sse('ack', { sessionId: id }) + sse('answer_start', { mode: 'agent' })
    + sse('answer_delta', { text })
    + sse('action_card', { kind: 'navigate', title: '合成支持方案', content: '查看已有进度。', ctaLabel: '查看方案', to: `/plans/${id}` })
    + sse('answer', { messageId: id, text, mode: 'agent' }) + sse('done', {})
  await page.route('**/api/v1/chat/messages', route => route.fulfill({ contentType: 'text/event-stream', body: reply('可以先确认家长具体担心的事情。') }))
  await page.route('**/api/v1/chat/messages/*/regenerate', route => route.fulfill({ contentType: 'text/event-stream', body: reply('根据补充事实，先核对孩子被忽略的具体场景。') }))
  let feedback: unknown
  await page.route('**/api/v1/chat/messages/*/feedback', async route => { feedback = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }) })
  await page.getByLabel('向 AI 赋能助手提问').fill('家长说我没听懂他的意思，怎么回应？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('button', { name: '没帮助', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '没帮助', exact: true }).click()
  await page.getByLabel('太空泛', { exact: true }).check()
  await page.getByLabel('反馈补充说明').fill('希望话术更贴合场景')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect.poll(() => feedback).toEqual({ rating: 'not_helpful', reasons: ['too_generic'], comment: '希望话术更贴合场景' })
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  await expect(page.getByText('根据补充事实，先核对孩子被忽略的具体场景。')).toBeVisible()
  await page.locator('summary').filter({ hasText: '合成支持方案' }).click()
  await page.getByRole('button', { name: '查看方案', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/plans/${id}$`))
})

test('合成聊天：教师可停止等待中的回答', async ({ page }) => {
  await setup(page)
  let release: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/chat/messages', async route => {
    await waiting
    await route.abort().catch(() => undefined)
  })
  await page.getByLabel('向 AI 赋能助手提问').fill('请帮我核实情况')
  await page.getByRole('button', { name: '发送消息' }).click()
  await page.getByRole('button', { name: /停止/ }).click()
  release?.()
  await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
})

test('合成聊天：流式期间按纯文本追加，answer 到达后才渲染 Markdown', async ({ page }) => {
  await setup(page)
  // 第一次只回流式事件（本轮不发 answer）：气泡应停留在纯文本，Markdown 记号原样保留。
  const streamOnly = sse('ack', { sessionId: id }) + sse('answer_start', { mode: 'agent' })
    + sse('answer_delta', { text: '先看**重点**这一条。' })
  // 第二次补上 answer（文本与流式内容一致）：仍必须切换为 Markdown 渲染。
  const completed = streamOnly + sse('answer', { messageId: id, text: '先看**重点**这一条。', mode: 'agent' }) + sse('done', {})
  let call = 0
  await page.route('**/api/v1/chat/messages', route => route.fulfill({
    contentType: 'text/event-stream',
    body: call++ === 0 ? streamOnly : completed
  }))
  const streamingBubble = page.locator('.whitespace-pre-wrap').filter({ hasText: '**重点**' })

  await page.getByLabel('向 AI 赋能助手提问').fill('先看什么？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(streamingBubble).toContainText('**重点**')
  await expect(page.locator('.markdown-body strong')).toHaveCount(0)

  await page.getByLabel('向 AI 赋能助手提问').fill('那再看一遍')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.markdown-body strong').first()).toHaveText('重点')
})

// 教师没点 @、直接在句子里写了学生姓名时：服务端把本轮对象随 ack 下发，界面显示「本次按…回答」，
// 并提供「固定为本会话对象」。这里只校验前端契约（端点、请求体、提示消失）。
test('合成聊天：本轮对象提示与固定为会话对象', async ({ page }) => {
  await setup(page)
  const studentId = '22222222-2222-4222-8222-222222222222'
  const body = sse('ack', { sessionId: id, turnObject: { type: 'student', id: studentId, label: '张小明' } })
    + sse('answer_start', { mode: 'agent' })
    + sse('answer_delta', { text: '先说这位学生这周的出勤与作业情况。' })
    + sse('answer', { messageId: id, text: '先说这位学生这周的出勤与作业情况。', mode: 'agent' }) + sse('done', {})
  await page.route('**/api/v1/chat/messages', route => route.fulfill({ contentType: 'text/event-stream', body }))
  let bound: unknown
  await page.route('**/api/v1/chat/sessions/*/context', async route => {
    bound = route.request().postDataJSON()
    await route.fulfill({ json: { context: { type: 'student', id: studentId, label: '张小明' } } })
  })
  await page.getByLabel('向 AI 赋能助手提问').fill('张小明这周的作业情况怎么样？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByText('本次按学生「张小明」回答')).toBeVisible()
  await page.getByRole('button', { name: '固定为本会话对象' }).click()
  await expect.poll(() => bound).toEqual({ contextType: 'student', contextId: studentId })
  await expect(page.getByText('本次按学生「张小明」回答')).toBeHidden()
})

// 命中多个候选时不猜：界面列出候选，教师点选后才建立绑定。
test('合成聊天：本轮对象有多个候选时由教师点选', async ({ page }) => {  await setup(page)
  const studentId = '33333333-3333-4333-8333-333333333333'
  const body = sse('ack', {
    sessionId: id,
    turnObjectCandidates: [
      { type: 'student', id: studentId, label: '张小明' },
      { type: 'student', id: '44444444-4444-4444-8444-444444444444', label: '张小军' }
    ]
  }) + sse('answer_start', { mode: 'agent' }) + sse('answer_delta', { text: '这条回答先按通用做法给建议。' })
    + sse('answer', { messageId: id, text: '这条回答先按通用做法给建议。', mode: 'agent' }) + sse('done', {})
  await page.route('**/api/v1/chat/messages', route => route.fulfill({ contentType: 'text/event-stream', body }))
  let bound: unknown
  await page.route('**/api/v1/chat/sessions/*/context', async route => {
    bound = route.request().postDataJSON()
    await route.fulfill({ json: { context: { type: 'student', id: studentId, label: '张小明' } } })
  })
  await page.getByLabel('向 AI 赋能助手提问').fill('张小这两周的情况帮我看一下')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByText('本轮提到的对象可能是以下之一，点选后按它回答：')).toBeVisible()
  await page.getByRole('button', { name: '张小明', exact: true }).click()
  await expect.poll(() => bound).toEqual({ contextType: 'student', contextId: studentId })
})

// 会话已绑定对象、本轮又提到另一个学生：只提示是否切换（不自动切换、不把两个学生的信息混在一轮）
test('合成聊天：已绑定会话提到另一个学生时提示切换', async ({ page }) => {
  await setup(page)
  const boundId = '55555555-5555-4555-8555-555555555555'
  const mentionedId = '66666666-6666-4666-8666-666666666666'
  const body = sse('ack', {
    sessionId: id,
    context: { type: 'student', id: boundId, label: '张小军' },
    suggestedContext: { type: 'student', id: mentionedId, label: '张小明' }
  }) + sse('answer_start', { mode: 'agent' }) + sse('answer_delta', { text: '先说张小军这周的出勤与作业情况。' })
    + sse('answer', { messageId: id, text: '先说张小军这周的出勤与作业情况。', mode: 'agent' }) + sse('done', {})
  await page.route('**/api/v1/chat/messages', route => route.fulfill({ contentType: 'text/event-stream', body }))
  let bound: unknown
  await page.route('**/api/v1/chat/sessions/*/context', async route => {
    bound = route.request().postDataJSON()
    await route.fulfill({ json: { context: { type: 'student', id: mentionedId, label: '张小明' } } })
  })
  await page.getByLabel('向 AI 赋能助手提问').fill('张小明这两周的情况帮我看一下')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByText('本轮提到的学生「张小明」与当前对象不同，是否切换？')).toBeVisible()
  // 「保持当前对象」只是收起提示，不发起换绑
  await page.getByRole('button', { name: '保持当前对象' }).click()
  await expect(page.getByText('本轮提到的学生「张小明」与当前对象不同，是否切换？')).toBeHidden()
  expect(bound).toBeUndefined()

  // 再发一轮并点「切到」：走与 @ 换绑同一条路径
  await page.getByLabel('向 AI 赋能助手提问').fill('还是看张小明')
  await page.getByRole('button', { name: '发送消息' }).click()
  await page.getByRole('button', { name: '切到「张小明」' }).click()
  await expect.poll(() => bound).toEqual({ contextType: 'student', contextId: mentionedId })
})

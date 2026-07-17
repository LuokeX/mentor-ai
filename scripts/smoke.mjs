import * as OTPAuth from 'otpauth'

const baseUrl = process.env.APP_BASE_URL || 'http://127.0.0.1:3100'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function client() {
  let cookie = ''
  return async (path, options = {}) => {
    const headers = new Headers(options.headers)
    if (cookie) headers.set('cookie', cookie)
    if (options.body && typeof options.body !== 'string') {
      headers.set('content-type', 'application/json')
      options.body = JSON.stringify(options.body)
    }
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';', 1)[0]
    const text = await response.text()
    let data = text
    try { data = JSON.parse(text) } catch { /* SSE or empty body */ }
    return { response, data, text }
  }
}

async function login(api, email, otp) {
  const result = await api('/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'Mentor@2026', ...(otp ? { otp } : {}) }
  })
  assert(result.response.ok, `${email} login failed: ${result.text}`)
}

const teacher = client()
const schoolAdmin = client()
const platformAdmin = client()
const psychologist = client()

const live = await teacher('/health/live')
const ready = await teacher('/health/ready')
assert(live.response.ok && ready.response.ok, 'health checks failed')
assert((await teacher('/openapi.json')).response.ok, 'OpenAPI contract unavailable')

await login(teacher, 'teacher@demo.local')
const teacherMe = await teacher('/api/v1/auth/me')
assert(teacherMe.data.role === 'teacher', 'teacher identity mismatch')
assert((await teacher('/api/v1/school-admin/dashboard')).response.status === 403, 'teacher crossed into school admin API')

await login(platformAdmin, 'platform.admin@demo.local')
const knowledgeBase = await platformAdmin('/api/v1/platform-admin/knowledge-bases', {
  method: 'POST', body: { name: `冒烟知识库-${Date.now()}`, description: '端到端检索验证', scope: 'global' }
})
assert(knowledgeBase.response.ok && knowledgeBase.data.id, `knowledge base create failed: ${knowledgeBase.text}`)
const knowledgeDocument = await platformAdmin(`/api/v1/platform-admin/knowledge-bases/${knowledgeBase.data.id}/documents`, {
  method: 'POST', body: {
    title: '家校沟通冒烟手册', sourceType: 'markdown', originalFilename: 'family-school.md', mimeType: 'text/markdown',
    content: '# 家长投诉处理\n\n家长在群里质疑教师时，先保存事实记录，再确认家长的核心关切，随后说明沟通边界并按照学校投诉流程升级。',
    confirmNoPersonalData: true
  }
})
assert(knowledgeDocument.response.ok && knowledgeDocument.data.chunkCount > 0, `knowledge document import failed: ${knowledgeDocument.text}`)
const publishKnowledge = await platformAdmin(`/api/v1/platform-admin/knowledge-bases/${knowledgeBase.data.id}`, { method: 'PATCH', body: { action: 'publish' } })
assert(publishKnowledge.response.ok && publishKnowledge.data.status === 'published', 'knowledge base publish failed')

const assistant = await teacher('/api/v1/chat/messages', { method: 'POST', body: { message: '家长在群里公开质疑我，我应该怎么沟通？' } })
assert(assistant.response.ok && assistant.text.includes('event: answer'), `assistant answer failed: ${assistant.text}`)
assert(assistant.text.includes('event: sources') && assistant.text.includes('家校沟通冒烟手册'), 'assistant did not cite published knowledge')
const assistantSessionId = assistant.text.match(/event: ack\ndata: \{"sessionId":"([^"]+)"/)?.[1]
assert(assistantSessionId, 'assistant session id missing')
const sessionList = await teacher('/api/v1/chat/sessions')
assert(sessionList.response.ok && sessionList.data.some(item => item.id === assistantSessionId), 'assistant session history missing')
const sessionDetail = await teacher(`/api/v1/chat/sessions/${assistantSessionId}`)
assert(sessionDetail.response.ok && sessionDetail.data.messages.some(item => item.role === 'assistant'), 'assistant session detail missing')

const definition = await teacher('/api/v1/assessments/class_system')
const classAnswers = Object.fromEntries(definition.data.questions.map(question => [question.id, 3]))
const firstAnswer = { [definition.data.questions[0].id]: 3 }
const savedDraft = await teacher('/api/v1/assessments/class_system/draft', { method: 'PATCH', body: { answers: firstAnswer } })
assert(savedDraft.response.ok && savedDraft.data.attemptId, `draft save failed: ${savedDraft.text}`)
const restoredDraft = await teacher('/api/v1/assessments/class_system/draft')
assert(restoredDraft.data.id === savedDraft.data.attemptId, 'server draft restore failed')
const assessment = await teacher('/api/v1/assessments/class_system/submit', { method: 'POST', body: { attemptId: savedDraft.data.attemptId, answers: classAnswers } })
assert(assessment.response.ok && assessment.data.result.level === 'norming', `assessment failed: ${assessment.text}`)
const teacherExport = await teacher('/api/v1/information/export')
assert(teacherExport.response.ok && teacherExport.response.headers.get('content-disposition')?.includes('attachment'), 'teacher data export failed')

const crisis = await teacher('/api/v1/chat/messages', { method: 'POST', body: { message: '学生刚刚说他不想活了，我需要帮助。' } })
assert(crisis.response.ok && crisis.text.includes('event: fuse'), `crisis fuse failed: ${crisis.text}`)

const totp = new OTPAuth.TOTP({
  issuer: '教师赋能智能平台', label: 'psychologist@demo.local', algorithm: 'SHA1', digits: 6, period: 30,
  secret: OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP')
})
await login(psychologist, 'psychologist@demo.local', totp.generate())
const referrals = await psychologist('/api/v1/specialist/referrals')
assert(referrals.response.ok && referrals.data.length > 0, 'assigned psychologist did not receive referral')
assert(!JSON.stringify(referrals.data).includes('passwordHash'), 'specialist package leaked account fields')

await login(schoolAdmin, 'school.admin@demo.local')
assert((await schoolAdmin('/api/v1/information/export')).response.status === 403, 'school administrator could use teacher export')
const schoolDashboard = await schoolAdmin('/api/v1/school-admin/dashboard')
assert(schoolDashboard.response.ok, 'school dashboard failed')
const pilotMetrics = await schoolAdmin('/api/v1/school-admin/pilot-metrics')
assert(pilotMetrics.response.ok && pilotMetrics.data.assistant && pilotMetrics.data.firstTask, `pilot metrics failed: ${pilotMetrics.text}`)
const teacherRow = schoolDashboard.data.users.find(user => user.role === 'teacher')
const ownAdminRow = schoolDashboard.data.users.find(user => user.role === 'school_admin')
assert(teacherRow && ownAdminRow, 'seed school users missing')
const selfDisable = await schoolAdmin(`/api/v1/school-admin/users/${ownAdminRow.id}`, { method: 'PATCH', body: { status: 'disabled' } })
assert(selfDisable.response.status === 404, 'school administrator could disable an administrator account')
const withoutGrant = await schoolAdmin(`/api/v1/admin-access/records/teacher_profile/${teacherRow.id}`)
assert(withoutGrant.response.status === 403, 'school admin viewed sensitive record without reason/grant')
const schoolAccess = await schoolAdmin('/api/v1/admin-access/requests', {
  method: 'POST', body: { targetType: 'teacher_profile', targetId: teacherRow.id, reasonCategory: 'school_duty', reasonText: '校内封闭试用权限流程验证' }
})
assert(schoolAccess.response.ok && schoolAccess.data.grant?.id, `school grant failed: ${schoolAccess.text}`)
const sensitive = await schoolAdmin(`/api/v1/admin-access/records/teacher_profile/${teacherRow.id}`, {
  headers: { 'x-admin-access-grant': schoolAccess.data.grant.id }
})
assert(sensitive.response.ok, `school sensitive read failed: ${sensitive.text}`)
assert(sensitive.response.headers.get('cache-control')?.includes('no-store'), 'sensitive response can be cached')
const printAudit = await schoolAdmin('/api/v1/admin-access/events', {
  method: 'POST', headers: { 'x-admin-access-grant': schoolAccess.data.grant.id },
  body: { targetType: 'teacher_profile', targetId: teacherRow.id, action: 'print_attempt' }
})
assert(printAudit.response.ok, 'print attempt audit failed')

const platformMe = await platformAdmin('/api/v1/auth/me')
const platformDashboard = await platformAdmin('/api/v1/platform-admin/dashboard')
assert(platformDashboard.response.ok && platformDashboard.data.schools.length > 0, 'platform dashboard failed')
const deniedPlatformRead = await platformAdmin(`/api/v1/admin-access/records/teacher_profile/${teacherRow.id}`)
assert(deniedPlatformRead.response.status === 403, 'platform admin viewed school data without approval')
const platformRequest = await platformAdmin('/api/v1/admin-access/requests', {
  method: 'POST', body: {
    schoolId: teacherMe.data.schoolId, targetType: 'teacher_profile', targetId: teacherRow.id,
    reasonCategory: 'data_correction_verification', reasonText: '验证平台应急访问审批与过期边界'
  }
})
assert(platformRequest.response.ok && platformRequest.data.request.status === 'pending', 'platform request was not pending')
const approvalDashboard = await schoolAdmin('/api/v1/school-admin/dashboard')
const pendingRequest = approvalDashboard.data.pendingRequests.find(item => item.id === platformRequest.data.request.id)
assert(pendingRequest && pendingRequest.requesterId === platformMe.data.id, 'request did not reach corresponding school')
const approval = await schoolAdmin(`/api/v1/school-admin/access-requests/${pendingRequest.id}/review`, {
  method: 'POST', body: { decision: 'approved' }
})
assert(approval.response.ok && approval.data.grant?.id, `platform approval failed: ${approval.text}`)
const platformSensitive = await platformAdmin(`/api/v1/admin-access/records/teacher_profile/${teacherRow.id}`, {
  headers: { 'x-admin-access-grant': approval.data.grant.id }
})
assert(platformSensitive.response.ok, `approved platform read failed: ${platformSensitive.text}`)

process.stdout.write(JSON.stringify({
  ok: true,
  checks: ['health and OpenAPI', 'teacher ownership and export', 'knowledge import and citation', 'multi-turn session history', 'server draft restore', 'deterministic assessment', 'crisis fuse', 'specialist assignment', 'privacy-safe pilot metrics', 'school reason grant', 'print audit', 'platform break-glass approval']
}, null, 2) + '\n')

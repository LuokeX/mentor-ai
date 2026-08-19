import { z } from 'zod'
import {
  adminAccessRequestSchema,
  chatMessageSchema,
  moduleIdSchema,
  reasonCategorySchema,
  roleSchema,
  routeDecisionSchema,
  targetTypeSchema
} from '../../shared/contracts'
import { assessmentReportSchema, planReviewCreateSchema } from '../../shared/reports'

const jsonSchema = (schema: z.ZodType) => {
  const value = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete value.$schema
  return value
}

export default defineEventHandler(() => ({
  openapi: '3.1.0',
  info: {
    title: '教师赋能智能平台 API',
    version: '0.1.0-rc',
    description: '封闭试用版 API。管理员敏感详情需要目标级 X-Admin-Access-Grant。'
  },
  components: {
    securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'mentor_session' } },
    schemas: {
      Role: jsonSchema(roleSchema),
      ModuleId: jsonSchema(moduleIdSchema),
      TargetType: jsonSchema(targetTypeSchema),
      ReasonCategory: jsonSchema(reasonCategorySchema),
      AdminAccessRequest: jsonSchema(adminAccessRequestSchema),
      ChatMessage: jsonSchema(chatMessageSchema),
      RouteDecision: jsonSchema(routeDecisionSchema),
      AssessmentReport: jsonSchema(assessmentReportSchema),
      PlanReviewCreate: jsonSchema(planReviewCreateSchema)
    }
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/health/live': { get: { security: [], summary: '进程存活检查', responses: { 200: { description: 'Live' } } } },
    '/health/ready': { get: { security: [], summary: '数据库就绪检查', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },
    '/api/v1/auth/login': { post: { security: [], summary: '账号密码登录', responses: { 200: { description: 'Logged in' }, 401: { description: 'Invalid credentials' } } } },
    '/api/v1/auth/activate': { get: { security: [], summary: '校验 72 小时一次性激活码', responses: { 200: { description: 'Invitation valid' }, 410: { description: 'Expired' } } }, post: { security: [], summary: '设置密码并激活账号', responses: { 200: { description: 'Activated' } } } },
    '/api/v1/chat/messages': { post: { summary: '安全检查、受控上下文和首页 AI 分诊（SSE）', responses: { 200: { description: 'SSE events: ack(dataGovernance), answer_start, answer_delta, answer, route, clarification_round, clarification_summary, fuse, done' }, 409: { description: 'Session context cannot be switched silently' } } } },
    '/api/v1/chat/context-options': { get: { summary: '取得当前教师可绑定到 AI 咨询的学生、班级和家长对象', responses: { 200: { description: 'Context options' } } } },
    '/api/v1/chat/status': { get: { summary: '取得 AI 分诊配置状态', responses: { 200: { description: 'Triage assistant status' } } } },
    '/api/v1/chat/data-governance': { get: { summary: '取得学校 AI 数据模式、有效回退模式和教师告知状态', responses: { 200: { description: 'AI governance state' } } } },
    '/api/v1/chat/context-preview': { get: { summary: '预览本次咨询将发送的业务上下文和始终排除字段', responses: { 200: { description: 'Sanitized context preview' } } } },
    '/api/v1/chat/consent': { post: { summary: '教师确认学校完整上下文隐私告知版本', responses: { 200: { description: 'Consent recorded' } } } },
    '/api/v1/chat/messages/{id}/feedback': { post: { summary: '提交回答有帮助/没帮助及结构化原因', responses: { 200: { description: 'Feedback saved' } } } },
    '/api/v1/chat/messages/{id}/plan-suggestions/{index}/confirm': { post: { summary: '教师确认后应用单条 AI 方案更新建议', responses: { 200: { description: 'Suggestion applied' }, 409: { description: 'Already applied' } } } },
    '/api/v1/chat/sessions': { get: { summary: '当前教师的对话历史', responses: { 200: { description: 'Owned sessions' } } } },
    '/api/v1/chat/sessions/{id}': { get: { summary: '当前教师拥有的对话及消息', responses: { 200: { description: 'Owned session detail' }, 404: { description: 'Not found or not owned' } } } },
    '/api/v1/assessments/{module}': { get: { summary: '取得版本化问卷定义', parameters: [{ name: 'module', in: 'path', required: true, schema: { $ref: '#/components/schemas/ModuleId' } }], responses: { 200: { description: 'Definition' } } } },
    '/api/v1/assessments/{module}/draft': {
      get: { summary: '恢复当前教师的服务端草稿', responses: { 200: { description: 'Draft or null' } } },
      patch: { summary: '自动保存当前教师的部分答卷', responses: { 200: { description: 'Saved' } } }
    },
    '/api/v1/assessments/{module}/submit': { post: { summary: '确定性计分、正式方案报告或安全熔断，可关联学生/班级/家长/来源对话', responses: { 200: { description: 'Assessment result with linked planId and report when not fused' } } } },
    '/api/v1/plans/{id}': { get: { summary: '读取当前由该教师负责的正式方案、稳定 ID 动作和完整复盘时间线', responses: { 200: { description: 'Plan detail with actions and reviews' }, 404: { description: 'Not found or not responsible' } } }, patch: { summary: '更新方案复盘时间或完成/关闭状态', responses: { 200: { description: 'Plan updated' } } } },
    '/api/v1/plans/{id}/actions': { patch: { summary: '按 actionId 更新动作；试用期兼容 actionIndex', responses: { 200: { description: 'Action updated' } } } },
    '/api/v1/plans/{id}/reviews': { post: { summary: '为当前由该教师负责的方案新增复盘记录', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PlanReviewCreate' } } } }, responses: { 200: { description: 'Review created' }, 404: { description: 'Plan not found or not responsible' } } } },
    '/api/v1/school-admin/information': { get: { summary: '学校管理员查看本校班级、学生、家长、沟通、方案和移交历史，用于负责教师分配', responses: { 200: { description: 'School-owned records with current responsible teacher' } } } },
    '/api/v1/school-admin/information/assign': { post: { summary: '学校管理员调整学校业务档案的当前负责教师，并记录移交历史', responses: { 200: { description: 'Assigned' }, 404: { description: 'Target not found' } } } },
    '/api/v1/school-admin/information/students/{id}/class': { patch: { summary: '学校管理员给学生分班、转班或移出班级，并同步负责教师和移交历史', responses: { 200: { description: 'Student class updated' }, 404: { description: 'Student not found' } } } },
    '/api/v1/school-admin/information/students/{id}/owner': { patch: { summary: '学校管理员单独调整学生当前负责教师，并同步相关沟通记录', responses: { 200: { description: 'Student owner updated' }, 404: { description: 'Student not found' } } } },
    '/api/v1/school-admin/imports/preview': { post: { summary: 'CSV 上传预检，返回行号错误、影响数量与 checksum', responses: { 200: { description: 'Import preview' } } } },
    '/api/v1/school-admin/imports/commit': { post: { summary: '重新校验 checksum 后单事务提交 CSV', responses: { 200: { description: 'Import committed' }, 409: { description: 'File changed' }, 422: { description: 'Validation failed and rolled back' } } } },
    '/api/v1/workbench/today': { get: { summary: '教师今日待办、首次使用清单和未读通知聚合', responses: { 200: { description: 'Today workbench' } } } },
    '/api/v1/notifications': { get: { summary: '当前用户站内通知，最多 50 条', responses: { 200: { description: 'Notifications' } } } },
    '/api/v1/specialist/referrals/{id}': { get: { summary: '心理专员取得最小必要工单详情和不可变处置时间线', responses: { 200: { description: 'Referral detail' } } }, patch: { summary: '按状态机确认、处置或关闭工单', responses: { 200: { description: 'Referral transitioned' }, 409: { description: 'Invalid transition' } } } },
    '/api/v1/school-admin/referrals/{id}/assign': { patch: { summary: '学校管理员不查看正文地转派未确认工单', responses: { 200: { description: 'Referral reassigned' } } } },
    '/api/v1/school-admin/pilot-metrics': { get: { summary: '不含业务正文的学校试点聚合指标', responses: { 200: { description: 'Pilot metrics' } } } },
    '/api/v1/information/students/{id}': { get: { summary: '教师读取当前负责学生详情、关联家长和沟通时间线', responses: { 200: { description: 'Student detail' }, 404: { description: 'Not found or not responsible' } } }, patch: { summary: '教师更新当前负责学生基础信息和所属班级', responses: { 200: { description: 'Student updated' } } } },
    '/api/v1/information/students/{id}/guardians': { post: { summary: '教师给当前负责学生关联已有家长', responses: { 200: { description: 'Guardian linked' } } } },
    '/api/v1/information/students/{id}/guardians/{guardianId}': { delete: { summary: '教师解除当前负责学生和家长的关联', responses: { 200: { description: 'Guardian unlinked' } } } },
    '/api/v1/information/students/{id}/communications': { post: { summary: '教师为当前负责学生新增家校沟通记录', responses: { 200: { description: 'Communication created' } } } },
    '/api/v1/information/guardians/{id}': { get: { summary: '教师读取当前负责家长详情、关联学生和沟通时间线', responses: { 200: { description: 'Guardian detail' }, 404: { description: 'Not found or not responsible' } } }, patch: { summary: '教师更新当前负责家长基础信息', responses: { 200: { description: 'Guardian updated' } } } },
    '/api/v1/information/guardians/{id}/students': { post: { summary: '教师给当前负责家长关联已有学生', responses: { 200: { description: 'Student linked' } } } },
    '/api/v1/information/guardians/{id}/students/{studentId}': { delete: { summary: '教师解除当前负责家长和学生的关联', responses: { 200: { description: 'Student unlinked' } } } },
    '/api/v1/information/guardians/{id}/communications': { post: { summary: '教师为当前负责家长新增家校沟通记录', responses: { 200: { description: 'Communication created' } } } },
    '/api/v1/information/export': { get: { summary: '教师导出当前由自己负责或参与的业务档案；管理员角色无权调用', responses: { 200: { description: 'JSON attachment' }, 403: { description: 'Teacher only' } } } },
    '/api/v1/admin-access/requests': { post: { summary: '创建学校管理员短时授权或平台 Break-glass 申请', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminAccessRequest' } } } }, responses: { 200: { description: 'Request and optional grant' } } } },
    '/api/v1/admin-access/records/{targetType}/{targetId}': { get: { summary: '在有效目标级授权内只读查看', parameters: [{ name: 'X-Admin-Access-Grant', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'No-store sensitive record' }, 403: { description: 'Missing, mismatched or expired grant' } } } }
  }
}))

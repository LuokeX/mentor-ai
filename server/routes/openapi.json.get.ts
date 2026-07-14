import { z } from 'zod'
import {
  adminAccessRequestSchema,
  chatMessageSchema,
  knowledgeBaseActionSchema,
  knowledgeBaseCreateSchema,
  knowledgeDocumentImportSchema,
  moduleIdSchema,
  reasonCategorySchema,
  roleSchema,
  routeDecisionSchema,
  targetTypeSchema
} from '../../shared/contracts'

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
      KnowledgeBaseCreate: jsonSchema(knowledgeBaseCreateSchema),
      KnowledgeBaseAction: jsonSchema(knowledgeBaseActionSchema),
      KnowledgeDocumentImport: jsonSchema(knowledgeDocumentImportSchema),
      RouteDecision: jsonSchema(routeDecisionSchema)
    }
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/health/live': { get: { security: [], summary: '进程存活检查', responses: { 200: { description: 'Live' } } } },
    '/health/ready': { get: { security: [], summary: '数据库就绪检查', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },
    '/api/v1/auth/login': { post: { security: [], summary: '账号密码登录；心理专员还需 TOTP', responses: { 200: { description: 'Logged in' }, 428: { description: 'MFA required' } } } },
    '/api/v1/chat/messages': { post: { summary: '安全检查、知识检索、完整 AI 回答、引用与模块建议（SSE）', responses: { 200: { description: 'SSE events: ack, answer, sources, route, fuse, done' } } } },
    '/api/v1/chat/status': { get: { summary: '取得 DeepSeek 配置状态和可用知识库数量', responses: { 200: { description: 'Assistant status' } } } },
    '/api/v1/chat/sessions': { get: { summary: '当前教师的对话历史', responses: { 200: { description: 'Owned sessions' } } } },
    '/api/v1/chat/sessions/{id}': { get: { summary: '当前教师拥有的对话及消息', responses: { 200: { description: 'Owned session detail' }, 404: { description: 'Not found or not owned' } } } },
    '/api/v1/platform-admin/knowledge-bases': { post: { summary: '平台管理员创建全局或校级知识库草稿', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeBaseCreate' } } } }, responses: { 200: { description: 'Knowledge base created' } } } },
    '/api/v1/platform-admin/knowledge-bases/{id}/documents': { post: { summary: '导入 Markdown、TXT 或 JSON 并自动分块', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeDocumentImport' } } } }, responses: { 200: { description: 'Document imported as draft' }, 409: { description: 'Duplicate document' } } } },
    '/api/v1/platform-admin/knowledge-bases/{id}/documents/{documentId}': { delete: { summary: '删除离线知识库中的文档和知识片段', responses: { 200: { description: 'Document deleted' }, 409: { description: 'Published knowledge base must be archived first' } } } },
    '/api/v1/platform-admin/knowledge-bases/{id}': {
      get: { summary: '取得知识库、文档和知识片段预览', responses: { 200: { description: 'Knowledge base detail' } } },
      patch: { summary: '发布、停用或恢复知识库', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeBaseAction' } } } }, responses: { 200: { description: 'Knowledge base updated' } } }
    },
    '/api/v1/assessments/{module}': { get: { summary: '取得版本化问卷定义', parameters: [{ name: 'module', in: 'path', required: true, schema: { $ref: '#/components/schemas/ModuleId' } }], responses: { 200: { description: 'Definition' } } } },
    '/api/v1/assessments/{module}/draft': {
      get: { summary: '恢复当前教师的服务端草稿', responses: { 200: { description: 'Draft or null' } } },
      patch: { summary: '自动保存当前教师的部分答卷', responses: { 200: { description: 'Saved' } } }
    },
    '/api/v1/assessments/{module}/submit': { post: { summary: '确定性计分、方案或安全熔断', responses: { 200: { description: 'Assessment result' } } } },
    '/api/v1/information/export': { get: { summary: '教师导出仅属于自己的完整数据；管理员角色无权调用', responses: { 200: { description: 'JSON attachment' }, 403: { description: 'Teacher only' } } } },
    '/api/v1/admin-access/requests': { post: { summary: '创建学校管理员短时授权或平台 Break-glass 申请', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminAccessRequest' } } } }, responses: { 200: { description: 'Request and optional grant' } } } },
    '/api/v1/admin-access/records/{targetType}/{targetId}': { get: { summary: '在有效目标级授权内只读查看', parameters: [{ name: 'X-Admin-Access-Grant', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'No-store sensitive record' }, 403: { description: 'Missing, mismatched or expired grant' } } } }
  }
}))

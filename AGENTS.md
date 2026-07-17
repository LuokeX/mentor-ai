# AGENTS.md — 教师赋能智能平台

本文件面向在本仓库中工作的 AI 编程助手。目标是让修改符合当前代码、权限边界和校内封闭试用要求。除非任务明确要求，不要把本项目扩展成通用聊天、通用教务或医疗诊断系统。

## 1. 项目定位

这是一个校内封闭试用版教师赋能平台，当前是可运行的 RC 基线，不等同于正式生产合规验收。

- 技术形态：Nuxt 4 + Vue 3 + Nitro 单仓全栈应用。
- 角色：`teacher`、`psychologist`、`school_admin`、`platform_admin`。
- 四个可执行模块：`self_growth`、`class_system`、`home_school`、`student_case`。
- 核心能力：教师 AI 助手、确定性量表与规则、信息中心、方案跟踪、安全熔断、心理转介、学校后台、平台后台、知识库检索。
- 业务边界和当前未实现范围见 `README.md`；它是实现说明，不是完整 PRD。

不要新增第五业务模块、医疗/心理诊断、自动替代人工处置或新的管理员数据权限，除非任务有明确业务依据和授权。

## 2. 事实来源与冲突处理

不要只根据本文件猜测实现。开始修改前先读取目标代码及相邻实现。

事实来源按以下顺序理解：

1. 运行代码、测试、`package.json`、`nuxt.config.ts`、`docker-compose.yml`。
2. `server/db/schema.ts` 和已提交的 `drizzle/*.sql`。
3. `shared/contracts.ts`、`shared/assessments.ts`、`shared/reports.ts` 中的共享契约和确定性逻辑。
4. `docs/ROLE_MATRIX.md`、`docs/DEVELOPMENT_AND_PRODUCTION.md`、`docs/AI_ASSISTANT_AND_KNOWLEDGE.md`、`docs/OPERATIONS.md`。
5. `README.md` 和本文件中的概览性描述。

如果文档、脚本和实现不一致：

- 不要静默选择一个版本继续扩展。
- 先以当前可执行代码确认实际行为，并在结果中指出差异。
- 若修正文档或配置属于当前任务范围，应与代码在同一变更中同步；否则只做必要修改，不顺手扩大范围。

## 3. 当前技术基线

- Node.js `>=24 <25`，包管理器固定为 pnpm 11.7；不要使用 npm 或 yarn 改写锁文件。
- Nuxt `^4.4.0`、Vue 3、Nitro、Nuxt UI、Tailwind CSS v4、Lucide Iconify 图标。
- TypeScript `strict: true`，运行 `nuxt typecheck`。
- PostgreSQL 18 + pgvector 0.8.5，Drizzle ORM；数据库结构集中在 `server/db/schema.ts`。
- Zod 用于请求、模型输出和共享契约校验。
- 敏感字段使用 AES-256-GCM 应用层加密；密码使用 Argon2id；心理专员登录使用 TOTP。
- DeepSeek 用于受限的回答和语义辅助；Ollama `qwen3-embedding:0.6b` 生成 1024 维知识向量。
- Vitest 是当前实际单元测试框架。`test:e2e` 脚本已声明，但仓库当前没有 Playwright 用例。

依赖版本以 `package.json` 和 `pnpm-lock.yaml` 为准，不要在说明中复制容易过期的 `latest` 版本号。

## 4. 仓库地图

```text
app/
  pages/                  页面：教师端、信息中心、心理专员、学校后台、平台后台
  components/             可复用 Vue 组件
  composables/            useAuth、Markdown 等前端逻辑
  layouts/                默认布局、水印和打印控制
  middleware/             前端路由守卫
  assets/css/             Tailwind/Nuxt UI 样式入口
server/
  api/v1/                 Nitro REST/SSE 接口，按业务领域组织
  db/schema.ts            唯一 Drizzle Schema 文件
  domain/                 规则、安全、知识、报告、管理员授权等业务逻辑
  integrations/           DeepSeek、Ollama 集成
  middleware/security.ts  安全响应头和 API no-store
  plugins/                配置校验、通知 Outbox 轮询
  routes/                 健康检查和 OpenAPI
  utils/                  数据库、认证、加密、审计
shared/                   前后端共享契约、评估和报告逻辑
drizzle/                  已生成并提交的数据库迁移
scripts/                  环境、迁移、种子、知识和备份脚本
tests/                    Vitest 测试
docs/                     开发发布、权限、AI/知识库和运维说明
infra/                    PostgreSQL 初始化和 Nginx 配置
```

当前通知消费者实现在 `server/plugins/notification-worker.ts`，会随 Nitro 应用启动。不要在没有同步修改实现和部署配置的情况下假设存在独立的 `pnpm worker` 进程。

## 5. 开始修改前

1. 先执行 `git status --short`，保留用户已有改动，不覆盖、不回滚无关文件。
2. 阅读目标文件、相邻路由/组件、相关共享契约和已有测试。
3. 涉及角色权限、敏感数据、危机规则、数据库或部署时，再阅读对应 `docs/` 文件。
4. 优先做最小且完整的变更；不要顺手重构无关代码。
5. 行为变化应补测试。修复缺陷时优先增加能复现问题的回归测试。

除非用户明确要求，不提交、不推送、不重写 Git 历史，不启动会下载大模型或改写本地数据的流程。

## 6. 服务端 API 约定

### 6.1 路由与基本模板

接口放在 `server/api/v1/`，使用 Nuxt 文件路由命名：

```text
resource.get.ts
resource.post.ts
[id].get.ts
[id].patch.ts
[id].delete.ts
```

新增受保护接口时使用以下顺序，并以相邻路由的返回结构为准：

```typescript
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = requestSchema.parse(await readBody(event))
  const db = useDb(event)

  const [record] = await db.select().from(schema.example).where(and(
    eq(schema.example.id, id),
    eq(schema.example.schoolId, user.schoolId),
    eq(schema.example.ownerUserId, user.id)
  )).limit(1)

  if (!record) throw createError({ statusCode: 404, message: '记录不存在' })

  // 管理操作、敏感读取或重要业务变更时写审计；普通读取按相邻实现决定。
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'example.read',
    targetType: 'example',
    targetId: id
  })

  return record
})
```

关键点：

- `requireUser` 是异步函数，必须 `await requireUser(...)`。
- 前端路由守卫只是用户体验层；服务端每个受保护路由仍必须独立认证和鉴权。
- 当前公开入口仅包括登录、容错退出、健康检查和 `/openapi.json`。新增公开接口必须有明确理由。
- 角色用 `requireUser(event, roles)` 限制，不要自行读取或解析会话 Cookie。
- 请求体、路径参数和查询参数都要校验。跨端复用的契约放在 `shared/contracts.ts`；单路由专用契约可内联。
- 仓库现有路由主要使用 Zod `.parse()`；需要自定义错误映射时可用 `.safeParse()`。
- 所有用户可见的业务错误使用中文。不要把 SQL、密钥、内部堆栈或模型原始错误返回给用户。
- 当前 API 没有统一 `{ ok, data }` 包装；不要未经整体设计擅自建立第二套返回约定。

### 6.2 租户、归属和关联校验

- 教师业务查询必须同时约束学校和当前负责教师，通常是 `schoolId + ownerUserId`。
- 更新、删除也要在最终 `where` 中带上归属条件，不能只依赖前置查询。
- 关联学生、班级、家长、会话、方案前，要验证关联对象属于同一学校且属于当前教师；不要只校验 UUID 存在。
- 心理专员只能读取和更新 `psychologistId === user.id` 的转介工单。
- 学校管理员只能管理本校账号、设置和档案分配；平台管理员只能管理平台级学校、内容和知识配置。
- 返回 `404` 时可隐藏越权目标是否存在，避免通过错误差异枚举其他租户数据。

### 6.3 数据库访问、事务和审计

- 普通业务代码使用 `useDb(event)` 和 Drizzle，不要新建 `Pool`。
- 只有确需向量 SQL、`FOR UPDATE SKIP LOCKED` 或底层事务控制的代码才使用 `usePool(event)`；沿用 `knowledge.ts` 和通知插件的封装。
- 多表写入只要必须“全部成功或全部失败”，就使用数据库事务。危机熔断、授权创建、学校创建、内容发布等尤其如此。
- 管理操作、敏感读取、权限变化、危机动作和重要业务变更必须写审计。审计元数据不能包含密钥或完整敏感正文。
- 集合接口必须设置合理上限或分页。`50` 是多处敏感集合的现行上限，不是所有查询都机械套用的全局常量。

## 7. 敏感数据和权限不变量

这些边界不可为了“方便开发”绕过。

### 7.1 加密与最小披露

- `nameEnc`、`phoneEnc`、`profileEnc`、`notesEnc`、`contentEnc`、`summaryEnc`、`descriptionEnc`、`totpSecretEnc`、`handlingNoteEnc` 等字段写入前使用 `encryptSensitive`，读取时使用 `decryptSensitive`。
- 需要精确检索姓名时使用 `searchableHash`；不要额外保存明文搜索列。
- API 响应不得泄露 `*Enc`、搜索哈希、密码哈希、TOTP secret 或会话 token。解密后构造明确的响应对象；手机号只在已授权且业务确有需要的教师详情中返回，其他场景应脱敏。
- 日志、审计、模型调用记录、通知正文和测试快照遵循最小披露原则。
- `.env`、证书、备份和真实业务数据不得提交。不要打印环境变量或密钥值。

### 7.2 管理员受控只读访问

- 学校管理员查看本校敏感业务档案前，必须填写至少 10 个字符的事由；授权绑定操作者、学校、目标类型和目标 UUID，有效 15 分钟。
- 平台管理员只能申请目标级访问，须由目标学校管理员批准，授权最长 30 分钟。
- 敏感详情接口必须校验 `X-Admin-Access-Grant`，并记录 `adminAccessEvents`。
- “业务档案只读”不等于“后台完全只读”：账号启停、学校设置、档案负责教师/班级分配、学校与内容配置是各角色明确允许的管理操作。
- 管理员不得修改或删除教师业务正文，也不得批量导出业务数据。教师可以通过现有接口导出自己的数据。
- 保留敏感页面的 `no-store`、动态水印、打印隐藏正文和打印尝试审计。

完整权限矩阵以 `docs/ROLE_MATRIX.md` 为准。

## 8. AI、知识库和安全熔断

- 本地危机关键词和硬规则必须先于常规模型回答执行；语义模型只能补充识别，不能削弱本地规则。
- 红线命中后停止常规回答，并在同一事务中创建 `safetyEvents`、`referrals`、`notificationOutbox` 和 `auditLogs`。
- 量表计分、业务分级、危机熔断和管理员授权必须由确定性代码执行，不能交给 LLM 决定。
- 发送给外部模型的教师输入和历史消息必须先经 `redactPii`；不要把完整电话、邮箱、姓名或未授权业务正文放入 Prompt。
- 模型调用日志只记录必要元数据，不记录完整 Prompt 或教师原文。
- 助手只能检索已发布知识库中的 ready 文档，并按全局/本校范围隔离。
- 模型引用必须限制在本次检索返回的 chunk UUID 中；不得展示模型虚构来源。
- 知识导入禁止包含真实个人业务数据。红线、计分阈值和制度要求即使存在于知识库，也必须同步到确定性规则和测试。
- DeepSeek 或 Ollama 不可用时保留现有本地/关键词降级路径，不得让安全规则依赖外部服务可用性。

涉及这部分的修改应同时阅读 `docs/AI_ASSISTANT_AND_KNOWLEDGE.md`、`server/domain/safety.ts`、`server/domain/rules-executor.ts` 和相关测试。

## 9. 数据库与迁移约定

- Schema 的唯一代码事实来源是 `server/db/schema.ts`，不要拆成多个 schema 文件。
- 沿用现有表语义。多数实体表使用 UUID 主键，但关联表和单例设置表存在复合/外键主键；不是每张表都必须套用同一模板。
- 根据数据生命周期选择时间字段。业务实体通常有 `createdAt`/`updatedAt`，事件和审计表可能只有 `createdAt`。
- JSONB 必须使用 `.$type<...>()` 给出 TypeScript 类型。
- 外键删除策略必须显式评估 `cascade`、`restrict` 或 `set null`，敏感和审计历史不得被意外级联删除。
- Schema 变更流程：修改 `server/db/schema.ts` → `pnpm db:generate` → 人工检查新 SQL → `pnpm db:migrate` → 验证。
- 已在共享环境执行过的 migration 不得修改、重命名或删除；修正必须新增 migration。
- 不使用 `drizzle-kit push` 代替迁移，不直接向正式库手写未纳入仓库的 DDL。
- Schema、migration、应用代码和测试应在同一功能变更中保持一致。

数据库或部署任务必须先阅读 `docs/DEVELOPMENT_AND_PRODUCTION.md`。不要在正式环境执行 `pnpm db:seed`、`pnpm env:init`、`pnpm dev` 或 `pnpm preview`。

## 10. 前端约定

- Vue 文件统一使用 `<script setup lang="ts">`，不新增 Options API。
- 初始/SSR 数据使用 `useFetch`，提交和其他 mutation 使用 `$fetch`；SSE 使用原生 `fetch` + `ReadableStream`。
- 新代码为 props、emits、API 响应和本地状态提供明确类型。现有页面仍有部分 `any`，修改相关区域时应逐步收窄，不要继续扩散。
- 状态优先使用 `ref`、`reactive`、`computed` 和 composable；项目当前没有 Pinia/Vuex。
- 优先使用 Nuxt UI 和 Tailwind utility，图标使用 `<UIcon name="i-lucide-...">`。
- 编程导航使用 `navigateTo`，声明式导航使用 `NuxtLink`。
- 不在页面中复制服务端权限逻辑。`app/middleware/auth.global.ts` 负责路由体验，真正权限仍由 API 保证。
- 聊天 SSE 客户端需要兼容当前事件：`ack`、`answer_start`、`answer_delta`、`answer`、`sources`、`route`、`fuse`、`error`、`done`。
- 修改管理员敏感页面时保留授权头、水印、过期处理、打印控制和访问事件上报。

## 11. 常用命令

```bash
pnpm dev                 # 本地 Nuxt 开发服务器
pnpm build               # 生产构建
pnpm typecheck           # Nuxt/TypeScript 类型检查
pnpm test                # Vitest 单元测试
pnpm test:watch          # Vitest 监听模式
pnpm test:e2e            # Playwright；需要已有用例和浏览器环境
pnpm env:init            # 仅本地首次初始化/补全 .env
pnpm db:up               # 启动数据库、Ollama、迁移和向量补全
pnpm db:generate         # 从 Schema 生成 migration
pnpm db:migrate          # 执行未运行的 migration
pnpm db:seed             # 仅本地或获批测试环境的演示数据
pnpm knowledge:import    # 受控导入知识
pnpm knowledge:reindex   # 重建知识向量
```

`pnpm db:up` 可能拉取镜像和约 639 MB 的 Embedding 模型，`db:seed` 会写入数据；除非任务需要并且环境合适，不要把它们当成普通验证命令自动执行。

## 12. 验证与交付

按改动风险选择验证，不要只因为命令存在就全部运行：

- 仅文档：检查链接、路径、命令和 `git diff --check`。
- 前端组件/页面：相关交互检查 + `pnpm typecheck`。
- 共享契约、规则或服务端业务：相关 Vitest + `pnpm test` + `pnpm typecheck`。
- API、认证、数据库、Nuxt 配置、依赖或部署：在上述基础上运行 `pnpm build`。
- 数据库变更：检查生成 SQL；条件允许时从空库和现有数据副本验证迁移。
- 权限变更：验证四角色、跨学校、跨教师、过期授权、只读限制和审计。
- 危机变更：验证常规路径和熔断路径，并确认四类记录在同一事务中生成。
- AI 变更：验证正常模型、无密钥、超时/非法响应、知识无结果和引用过滤降级。

交付时说明：

1. 改了什么以及为什么。
2. 实际运行了哪些验证及结果。
3. 哪些验证因环境限制未运行。
4. 发现但未纳入本次范围的仓库差异或风险。

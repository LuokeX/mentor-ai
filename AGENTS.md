# AGENTS.md — 教师赋能智能平台

本文件面向在本仓库中工作的 AI 编程助手。目标是让修改符合当前代码、权限边界和校内封闭试用要求。除非任务明确要求，不要把本项目扩展成通用聊天、通用教务或医疗诊断系统。

## 1. 项目定位

这是一个校内封闭试用版教师赋能平台，当前是可运行的 RC 基线，不等同于正式生产合规验收。

- 技术形态：Nuxt 4 + Vue 3 + Nitro 单仓全栈应用。
- 角色：`teacher`、`psychologist`、`school_admin`、`platform_admin`。
- 五个可执行模块：`self_growth`、`class_system`、`home_school`、`student_case`、`learning_problem`。
- 核心能力：首页 AI 澄清分诊、确定性量表与归因规则、三库资源运营（XLSX 模板导入 + 版本发布）、信息中心、方案跟踪、安全熔断、心理转介、学校后台、平台后台、统一管理框架。
- 业务边界和当前未实现范围见 `README.md`；它是实现说明，不是完整 PRD。

不要新增第六业务模块、医疗/心理诊断、自动替代人工处置或新的管理员数据权限，除非任务有明确业务依据和授权。

## 2. 事实来源与冲突处理

不要只根据本文件猜测实现。开始修改前先读取目标代码及相邻实现。

事实来源按以下顺序理解：

1. 运行代码、测试、`package.json`、`nuxt.config.ts`、`docker-compose.yml`、`playwright.config.ts`。
2. `server/db/schema.ts` 和已提交的 `drizzle/*.sql`。
3. 共享契约与确定性逻辑：`shared/contracts.ts`、`shared/assessments.ts`、`shared/reports.ts`、`shared/management.ts`。
4. 专题文档：`docs/ROLE_MATRIX.md`、`docs/MANAGEMENT_FRAMEWORK.md`、`docs/AI_ASSISTANT_AND_KNOWLEDGE.md`、`docs/DEVELOPMENT_AND_PRODUCTION.md`、`docs/OPERATIONS.md`、`docs/PILOT_ROLLOUT.md`、`docs/business/**`。
5. `README.md` 和本文件中的概览性描述。

如果文档、脚本和实现不一致：

- 不要静默选择一个版本继续扩展。
- 先以当前可执行代码确认实际行为，并在结果中指出差异。
- 若修正文档或配置属于当前任务范围，应与代码在同一变更中同步；否则只做必要修改，不顺手扩大范围。

已知的文档/实现偏差（修改相关代码时按代码为准，顺手纠正需说明）：

- `docs/MANAGEMENT_FRAMEWORK.md` 描述并发控制用请求体 `ManagedPatch<T>`；当前 PATCH 路由实际从查询参数读取 `expectedUpdatedAt`（见 `server/api/v1/school-admin/classes/[id].patch.ts`）。
- `server/utils/db-helpers.ts` 的 `findOwned` 目前没有调用方；`apiContext`、`uuidParam` 也只在少数路由使用。它们是可选简化，不是必须迁移的强制约定。
- `README.md` 写的是 `http://localhost:3000`，`nuxt.config.ts` 的 `devServer.port` 是 `3300`，Playwright 用 `3100`。

## 3. 当前技术基线

- Node.js `>=24 <25`，进入仓库后先执行 `nvm use 24` 再运行 pnpm 命令；若非交互 Shell 未加载 nvm，先执行 `source /home/llai01/.nvm/nvm.sh`。包管理器固定为 pnpm 11.7；不要使用 npm 或 yarn 改写锁文件。
- Nuxt `^4.4.0`、Vue 3、Nitro（`node-server` preset，`experimental.tasks` 打开）、Nuxt UI、Tailwind CSS v4、Lucide Iconify 图标。
- 组件自动导入配置为 `pathPrefix: false`：`app/components/management/TableToolbar.vue` 直接写作 `<TableToolbar>`，新增组件注意重名。
- TypeScript `strict: true` 且 `typeCheck: true`，运行 `pnpm typecheck`。
- PostgreSQL 18 + pgvector 0.8.5，Drizzle ORM；数据库结构集中在 `server/db/schema.ts`（当前 48 张表）。
- Zod 用于请求、模型输出和共享契约校验。
- 敏感字段使用 AES-256-GCM 应用层加密；密码使用 Argon2id；心理专员登录使用 TOTP（`otpauth`）。
- DeepSeek 用于受限的澄清分诊和语义辅助；Ollama `qwen3-embedding:0.6b` 生成 `vector(1024)` 向量，当前只用于 `module_resource_chunks`，且需要 `EMBEDDING_ENABLED=true`。
- `xlsx@0.18.5` 用于三库模板解析（`scripts/import-business-data/xlsx-reader.ts` 与平台后台文件导入）。
- Vitest 是单元测试框架（`tests/*.test.ts`）。Playwright E2E 已有真实用例：`tests/e2e/core-flows.spec.ts`，覆盖 `desktop-chromium` 和 `mobile-chromium` 两个 project，`webServer` 会以 `pnpm dev --port 3100` 拉起应用，因此需要可用数据库和种子数据。

依赖版本以 `package.json` 和 `pnpm-lock.yaml` 为准，不要在说明中复制容易过期的 `latest` 版本号。

## 4. 仓库地图

```text
app/
  pages/                  教师首页与模块页、信息中心、心理专员、学校后台、平台后台
  components/
    management/           统一管理框架组件（ManagementPage、ManagedDataTable 等）
    platform-admin/       平台后台专用组件
  composables/            useAuth、useCapabilities、useManagedList、useRowEditor、
                          useDisplayLabels、useModuleScores、useMarkdown
  layouts/default.vue     默认布局、水印和打印控制
  middleware/auth.global.ts  前端路由守卫（体验层，不是权限来源）
  assets/css/             Tailwind/Nuxt UI 样式入口
server/
  api/v1/                 Nitro REST/SSE 接口，按业务领域分目录
                          （auth、chat、assessments、plans、information、workbench、
                           notifications、module-resources、admin-access、terms、
                           school-admin、platform-admin、specialist）
  db/schema.ts            唯一 Drizzle Schema 文件
  domain/                 业务逻辑：safety、rules、rules-executor、capabilities、
                          lifecycle、admin-access、ai-governance、assistant-context、
                          chat-clarification、plan-actions、plan-operations、reports、
                          module-resource-*（校验/投影/文档/文件导入）、school-management、
                          school-imports、invitations、pilot-acceptance、product-events
  integrations/           deepseek.ts（含 redactPii）、ollama.ts
  middleware/security.ts  安全响应头和 API no-store
  plugins/                validate-config、error-handler、notification-worker
  routes/                 health 探针和 openapi.json
  utils/                  db、auth、crypto、audit、handler(apiContext)、
                          pagination(paginateResult)、params(uuidParam)、db-helpers(findOwned)
shared/                   contracts、assessments、reports、management（前后端共享）
drizzle/                  已生成并提交的数据库迁移
scripts/                  env/migrate/seed/backup/restore、reindex、scaffold-management、
                          import-business-data/（xlsx-reader、transformers、importers、quality）
business-libraries/       三库 XLSX 模板与导入源数据（templates/ 下为 v4 填写模板）
tests/                    Vitest 单元测试 + tests/e2e/ Playwright 用例 + tests/fixtures/
docs/                     权限矩阵、管理框架、AI/三库、开发发布、运维、试点手册、business/
infra/                    PostgreSQL 初始化和 Nginx 配置
```

通知消费者实现在 `server/plugins/notification-worker.ts`，随 Nitro 应用启动。不存在独立的 `pnpm worker` 进程，不要在没有同步修改实现和部署配置的情况下假设它存在。

## 5. 开始修改前

1. 先执行 `git status --short`，保留用户已有改动，不覆盖、不回滚无关文件。
2. 阅读目标文件、相邻路由/组件、相关共享契约和已有测试。
3. 涉及角色权限、敏感数据、危机规则、管理框架、数据库或部署时，再阅读对应 `docs/` 文件。
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

- `requireUser` 是异步函数，必须 `await requireUser(...)`；这是当前 150 个路由文件中的主流写法。
- `server/utils/` 下的 `apiContext`、`uuidParam`、`findOwned` 是可选简化封装。新代码可以使用，但不要为了统一风格批量改写既有路由；`findOwned` 只适用于同时具备 `id + schoolId + ownerUserId` 的表。
- 前端路由守卫只是用户体验层；服务端每个受保护路由仍必须独立认证和鉴权。
- 当前公开入口仅包括登录、账号激活、容错退出、健康检查和 `/openapi.json`。新增公开接口必须有明确理由。
- 角色用 `requireUser(event, roles)` 限制，不要自行读取或解析会话 Cookie。
- 请求体、路径参数和查询参数都要校验。跨端复用的契约放在 `shared/contracts.ts` 或 `shared/management.ts`；单路由专用契约可内联。
- 仓库现有路由主要使用 Zod `.parse()`；需要自定义错误映射时可用 `.safeParse()`。
- 所有用户可见的业务错误使用中文。结构化错误码放 `statusMessage`（取值见 `shared/management.ts` 的 `ERROR_CODES`），中文说明放 `message`。
- 不要把 SQL、密钥、内部堆栈或模型原始错误返回给用户。
- 当前 API 没有统一 `{ ok, data }` 包装；列表类接口统一为 `ManagedListResult`（见 6.4）。不要未经整体设计擅自建立第三套返回约定。

### 6.2 租户、归属和关联校验

- 教师业务查询必须同时约束学校和当前负责教师，通常是 `schoolId + ownerUserId`。
- 更新、删除也要在最终 `where` 中带上归属条件，不能只依赖前置查询。
- 关联学生、班级、家长、会话、方案前，要验证关联对象属于同一学校且属于当前教师；不要只校验 UUID 存在。
- 心理专员只能读取和更新 `psychologistId === user.id` 的转介工单。
- 学校管理员只能管理本校账号、设置和档案分配；平台管理员只能管理平台级学校、内容和知识配置。
- 返回 `404` 时可隐藏越权目标是否存在，避免通过错误差异枚举其他租户数据。

### 6.3 数据库访问、事务和审计

- 普通业务代码使用 `useDb(event)` 和 Drizzle，不要新建 `Pool`。
- 只有确需向量 SQL、`FOR UPDATE SKIP LOCKED` 或底层事务控制的代码才使用 `usePool(event)`；当前仅 `server/plugins/notification-worker.ts` 这样用，脚本侧参考 `scripts/reindex-module-resource-embeddings.ts`。
- 多表写入只要必须"全部成功或全部失败"，就使用数据库事务。危机熔断、授权创建、学校创建、内容/资源发布等尤其如此。
- 管理操作、敏感读取、权限变化、危机动作和重要业务变更必须写审计。审计元数据不能包含密钥或完整敏感正文。
- 集合接口必须设置合理上限或分页。管理框架列表用 `page/pageSize`（20/50/100，上限 100）；`50` 是若干敏感详情集合的现行上限，不是全局常量。

### 6.4 统一管理框架接口约定

实体管理类接口遵循 `docs/MANAGEMENT_FRAMEWORK.md` 和 `shared/management.ts`。参考实现：`server/api/v1/information/classes/index.get.ts`。

- 列表返回 `ManagedListResult<T>`：`{ rows, page, pageSize, total, capabilities }`，每行附带 `_capabilities`。
- 行级能力用 `resolveCapabilities()`（`server/domain/capabilities.ts`）解析，页面级能力用 `resolvePageCapabilities()`。解析顺序：角色 → 学校 → 负责人/分配关系 → 记录状态 → 临时授权 → 具体动作。前端按钮只反映服务端能力，不得自行推断权限。
- 排序字段必须走 `createSortWhitelist()` + `validateSort()`，不能把用户输入直接拼进 `orderBy`。
- 分页统一用 `paginateResult()` + `offsetFrom()` + `countSql`（后两者在 `server/domain/school-management.ts`）。
- 并发控制：PATCH 接受 `expectedUpdatedAt`，冲突时抛 `409` 且 `statusMessage: 'EDIT_CONFLICT'`。最终 `UPDATE` 的 `where` 必须再次包含租户、归属、状态和 `updatedAt`，不能只靠前置查询判断。
- 归档/恢复/移交走 `server/domain/lifecycle.ts` 的 `archiveRecord()` / `restoreRecord()` / `validateLifecycleAction()`。业务档案、审计、安全事件、访问事件、方案事件、转介事件禁止物理删除；`DELETE` 仅允许用于从未激活的邀请账号。
- 新增管理模块可用 `pnpm scaffold:management --area <area> --entity <entity>` 生成骨架，生成物是 TODO 占位，必须补齐查询字段、排序白名单、写接口、审计和测试。
- 统一组件不是通用低代码 CRUD 引擎：可写动作仍由各领域 API 独立实现和校验。

## 7. 敏感数据和权限不变量

这些边界不可为了"方便开发"绕过。

### 7.1 加密与最小披露

- `nameEnc`、`phoneEnc`、`profileEnc`、`notesEnc`、`contentEnc`、`summaryEnc`、`descriptionEnc`、`totpSecretEnc`、`handlingNoteEnc` 等字段写入前使用 `encryptSensitive`，读取时使用 `decryptSensitive`。
- 需要精确检索姓名时使用 `searchableHash`；不要额外保存明文搜索列。
- API 响应不得泄露 `*Enc`、搜索哈希、密码哈希、TOTP secret 或会话 token。解密后构造明确的响应对象；手机号只在已授权且业务确有需要的教师详情中返回，其他场景用 `maskPhone` / `SENSITIVE_PLACEHOLDER` 脱敏。
- 日志、审计、模型调用记录、通知正文和测试快照遵循最小披露原则。
- `.env`、证书、备份和真实业务数据不得提交。不要打印环境变量或密钥值。

### 7.2 管理员受控只读访问

- 学校管理员查看本校敏感业务档案前，必须填写至少 10 个字符的事由；授权绑定操作者、学校、目标类型和目标 UUID，有效 15 分钟。
- 平台管理员只能申请目标级访问，须由目标学校管理员批准，授权最长 30 分钟。
- 敏感详情接口必须校验 `X-Admin-Access-Grant`，并记录 `adminAccessEvents`。
- "业务档案只读"不等于"后台完全只读"：账号启停、学校设置、档案负责教师/班级分配、学校与内容配置是各角色明确允许的管理操作。
- 管理员不得修改或删除教师业务正文，也不得批量导出业务数据。教师可以通过 `server/api/v1/information/export.get.ts` 导出自己的数据。
- 保留敏感页面的 `no-store`（`nuxt.config.ts` 的 `routeRules` 覆盖 `/school-admin`、`/platform-admin`、`/specialist`、`/information`）、动态水印、打印隐藏正文和打印尝试审计。

完整权限矩阵以 `docs/ROLE_MATRIX.md` 为准。

## 8. AI 分诊、三库和安全熔断

### 8.1 安全与模型边界

- 本地危机关键词和硬规则必须先于常规模型回答执行；语义模型只能补充识别，不能削弱本地规则。
- 红线命中后停止常规回答，并在同一事务中创建 `safetyEvents`、`referrals`、`notificationOutbox` 和 `auditLogs`。
- 量表计分、业务分级、危机熔断、归因和管理员授权必须由确定性代码执行，不能交给 LLM 决定。
- 发送给外部模型的教师输入和历史消息必须先经 `redactPii`（`server/integrations/deepseek.ts`）；不要把完整电话、邮箱、姓名或未授权业务正文放入 Prompt。
- 学校级数据模式 `local | redacted | full_context` 由 `server/domain/ai-governance.ts` 控制；`full_context` 需要协议版本、学校审批和教师确认同一告知版本，任一门禁不满足自动回退 `redacted`。
- 模型调用日志（`aiModelCalls`）只记录必要元数据，不记录完整 Prompt 或教师原文。
- DeepSeek 或 Ollama 不可用时保留现有本地/关键词降级路径，不得让安全规则依赖外部服务可用性。

### 8.2 首页澄清分诊

- 首页 AI 只做澄清与分诊：多轮澄清问题、给出模块占比、说明理由和评估准备事项；不能生成正式方案，不能跳过量表，不能替代归因规则。
- 会话状态机在 `server/api/v1/chat/messages.post.ts` 与 `server/domain/chat-clarification.ts`：`clarificationState.phase` 为 `clarifying | summarizing | done`，`moduleScores` 记录模块占比。
- SSE 事件当前为：`ack`、`answer_start`、`answer_delta`、`answer`、`clarification_round`、`clarification_summary`、`route`、`fuse`、`error`、`done`。改动事件名必须同时更新前端消费方。

### 8.3 三库资源

- 三库固定为 `assessment`、`attribution`、`tool`，运行时发布版本来自 `moduleResourceLibraries` 和 `moduleResourceVersions`，明细落在 `moduleResourceAssessmentItems`、`moduleResourceAttributionRules`、`moduleResourceToolItems`，文档与切块在 `moduleResourceDocuments`、`moduleResourceChunks`。
- 导入链路：XLSX 模板（`business-libraries/templates/`）→ `scripts/import-business-data/`（`xlsx-reader` → `transformers/*` → `quality` → `importers`）或平台后台的 `server/domain/module-resource-file-import.ts`。
- 业务填写模板当前为 **v4**（`三库填写模板_v4.xlsx`，23 个 sheet）。改模板必须走 `pnpm template:build` 重新生成，再 `pnpm template:split` 同步 `public/templates/` 下的分库模板；两条链路的 sheet 名匹配（`module-resource-file-import.ts` 与 `transformers/*`）要一起改，否则新 sheet 会被静默丢弃或误认。测试数据用 `pnpm testdata:build` 重出。
- 写入前必须经 `validateModuleResourcePayload()` 校验、`previewModuleResourcePayload()` 预览，发布时用 `projectModuleResourcePayload()` / `rebuildModuleResourceProjection()` 生成运行时投影。不要绕过校验直接写明细表。
- 运行时读取用 `resolvePublishedModuleResource()` 等函数，并遵守 `scope`（全局/校级）可见性规则。
- 量表计分、等级、主归因、次归因、工具匹配、方案结构和风险判断必须由确定性代码执行。
- 资源导入禁止包含真实个人业务数据。红线、计分阈值和制度要求必须同步到确定性规则和测试（`tests/rules*.test.ts`、`tests/module-resources*.test.ts`、`tests/fixtures/business-resource-golden.ts`）。
- 三库字段规范见 `docs/business/library-standards/*.md`，跨模块依赖见 `docs/business/cross-module-dependencies.md`。

涉及这部分的修改应同时阅读 `docs/AI_ASSISTANT_AND_KNOWLEDGE.md`、`server/domain/safety.ts`、`server/domain/rules-executor.ts` 和相关测试。

## 9. 数据库与迁移约定

- Schema 的唯一代码事实来源是 `server/db/schema.ts`，不要拆成多个 schema 文件。
- 沿用现有表语义。多数实体表使用 UUID 主键，但关联表和单例设置表存在复合/外键主键；不是每张表都必须套用同一模板。
- 生命周期字段沿用现有语义：`status`（`active | archived | graduated | disabled`）、`archivedAt`/`archivedBy`，`users` 另有 `disabledAt`/`disabledBy`/`disabledReason`。
- 根据数据生命周期选择时间字段。业务实体通常有 `createdAt`/`updatedAt`，事件和审计表可能只有 `createdAt`。管理框架的并发控制依赖 `updatedAt`，新增可编辑实体必须带 `updatedAt`。
- JSONB 必须使用 `.$type<...>()` 给出 TypeScript 类型；向量列沿用 `vector(1024)` 自定义类型。
- 外键删除策略必须显式评估 `cascade`、`restrict` 或 `set null`，敏感和审计历史不得被意外级联删除。
- Schema 变更流程：修改 `server/db/schema.ts` → `pnpm db:generate` → 人工检查新 SQL → `pnpm db:migrate` → 验证。
- 已在共享环境执行过的 migration 不得修改、重命名或删除；修正必须新增 migration。
- 不使用 `drizzle-kit push` 代替迁移，不直接向正式库手写未纳入仓库的 DDL。
- Schema、migration、应用代码和测试应在同一功能变更中保持一致；`tests/management-migrations.test.ts` 会校验管理框架相关结构。

数据库或部署任务必须先阅读 `docs/DEVELOPMENT_AND_PRODUCTION.md`。不要在正式环境执行 `pnpm db:seed`、`pnpm env:init`、`pnpm dev` 或 `pnpm preview`。

## 10. 前端约定

- Vue 文件统一使用 `<script setup lang="ts">`，不新增 Options API。
- 初始/SSR 数据使用 `useFetch`，提交和其他 mutation 使用 `$fetch`；SSE 使用原生 `fetch` + `ReadableStream`。
- 新代码为 props、emits、API 响应和本地状态提供明确类型。现有页面仍有部分 `any`，修改相关区域时应逐步收窄，不要继续扩散；管理框架相关新代码不得新增 `any`。
- 状态优先使用 `ref`、`reactive`、`computed` 和 composable；项目当前没有 Pinia/Vuex。
- 实体管理页面统一用 `ManagementPage` + `ManagedDataTable` + `TableToolbar` / `TablePagination` / `RowActions` / `BulkActionBar` / `EntityFormDrawer` / `EntityDetailDrawer` / `LifecycleDialog`，配合 `useManagedList`（URL 查询同步、防抖、分页）和 `useCapabilities`（解释服务端能力数组）。字段编辑走抽屉显式提交，敏感字段和复杂关联不在表格中直接暴露或隐式保存。
- 优先使用 Nuxt UI 和 Tailwind utility，图标使用 `<UIcon name="i-lucide-...">`。
- 编程导航使用 `navigateTo`，声明式导航使用 `NuxtLink`。
- 不在页面中复制服务端权限逻辑。`app/middleware/auth.global.ts` 负责路由体验，真正权限仍由 API 保证。
- 聊天 SSE 客户端需要兼容 8.2 列出的全部事件。
- 修改管理员敏感页面时保留授权头、水印、过期处理、打印控制和访问事件上报。

## 11. 常用命令

```bash
pnpm dev                  # 本地 Nuxt 开发服务器（devServer 端口 3300）
pnpm build                # 生产构建
pnpm typecheck            # Nuxt/TypeScript 类型检查
pnpm test                 # Vitest 单元测试
pnpm test:watch           # Vitest 监听模式
pnpm test:e2e             # Playwright；会自行拉起 3100 端口的 dev server，需要数据库和种子数据
pnpm env:init             # 仅本地首次初始化/补全 .env
pnpm db:up                # 启动 postgres、ollama、模型拉取、迁移和向量补全
pnpm db:generate          # 从 Schema 生成 migration
pnpm db:migrate           # 执行未运行的 migration
pnpm db:seed              # 仅本地或获批测试环境的演示数据
pnpm import:business-data # 三库 XLSX 导入，支持 --dry-run --publish --strict-quality
                          # --require-complete --include-legacy-raw --module= --type=
pnpm resources:reindex    # 重建模块资源向量（需 EMBEDDING_ENABLED=true）
pnpm scaffold:management  # 生成管理模块骨架 --area <area> --entity <entity>
```

`pnpm db:up` 可能拉取镜像和约 639 MB 的 Embedding 模型，`db:seed`、`import:business-data`（不带 `--dry-run`）和 `test:e2e` 会写入数据；除非任务需要并且环境合适，不要把它们当成普通验证命令自动执行。导入类脚本先用 `--dry-run` 确认结果。

## 12. 验证与交付

按改动风险选择验证，不要只因为命令存在就全部运行：

- 仅文档：检查链接、路径、命令和 `git diff --check`。
- 前端组件/页面：相关交互检查 + `pnpm typecheck`。
- 共享契约、规则或服务端业务：相关 Vitest + `pnpm test` + `pnpm typecheck`。
- API、认证、数据库、Nuxt 配置、依赖或部署：在上述基础上运行 `pnpm build`。
- 管理框架、四角色核心路径或导航变更：在数据库可用时运行 `pnpm test:e2e`（桌面 + 手机双 project）。
- 数据库变更：检查生成 SQL；条件允许时从空库和现有数据副本验证迁移。
- 权限变更：验证四角色、跨学校、跨教师、过期授权、只读限制、状态冲突和审计。
- 管理框架变更：额外验证分页上限、排序白名单、`EDIT_CONFLICT` 并发冲突、归档/恢复状态流转和能力驱动的按钮显隐。
- 危机变更：验证常规路径和熔断路径，并确认四类记录在同一事务中生成。
- AI 变更：验证正常模型、无密钥、超时/非法响应、澄清多轮状态机和降级路径。
- 三库变更：`--dry-run` 导入 + 校验/预览/投影相关测试 + golden fixture 比对。

交付时说明：

1. 改了什么以及为什么。
2. 实际运行了哪些验证及结果。
3. 哪些验证因环境限制未运行。
4. 发现但未纳入本次范围的仓库差异或风险。

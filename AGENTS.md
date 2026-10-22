# AGENTS.md — 教师赋能智能平台

本文件面向在本仓库中工作的 AI 编程助手。目标是让修改符合当前代码、权限边界和校内封闭试用要求。除非任务明确要求，不要把本项目扩展成通用聊天、通用教务或医疗诊断系统。

## 1. 项目定位

这是一个校内封闭试用版教师赋能平台，当前是可运行的 RC 基线，不等同于正式生产合规验收。

- 技术形态：Nuxt 4 + Vue 3 + Nitro 单仓全栈应用。
- 角色：`teacher`、`psychologist`、`school_admin`（学校管理员，含账号开通/权限维护与平台使用量看板）、`division_principal`（学部校长）、`moral_education_director`（德育主任）、`grade_director`（年级主任）、`platform_admin`；中间三者是只读数据驾驶舱角色（一校一学部：校长与德育主任看本校，年级主任按 `user_roles.scope.grades` 只看所辖年级，可多选；兼容旧 `scope.grade`）。一个账号可持有多个角色，但同一时刻只有一个「激活角色」生效（见 `docs/ROLE_MATRIX.md`）。
- 五个可执行模块：`self_growth`、`class_system`、`home_school`、`student_case`、`learning_problem`。
- 核心能力：首页 AI 助手（回答先行）、确定性量表与归因规则、三库资源运营（XLSX 模板导入 + 版本发布）、信息中心、方案跟踪、安全熔断、心理转介、学校后台、平台后台、统一管理框架。
- 业务边界和当前未实现范围见 `README.md`；它是实现说明，不是完整 PRD。

不要新增第六业务模块、医疗/心理诊断、自动替代人工处置或新的管理员数据权限，除非任务有明确业务依据和授权。

## 2. 事实来源与冲突处理

不要只根据本文件猜测实现。开始修改前先读取目标代码及相邻实现。

事实来源按以下顺序理解：

1. 运行代码、测试、`package.json`、`nuxt.config.ts`、`docker-compose.yml`、`playwright.config.ts`。
2. `server/db/schema.ts` 和已提交的 `drizzle/*.sql`。
3. 共享契约与确定性逻辑：`shared/contracts.ts`、`shared/assessments.ts`、`shared/reports.ts`、`shared/management.ts`、`shared/business-wizard.ts`。
4. 专题文档：`docs/ROLE_MATRIX.md`、`docs/MANAGEMENT_FRAMEWORK.md`、`docs/AI_ASSISTANT_AND_KNOWLEDGE.md`、`docs/DEVELOPMENT_AND_PRODUCTION.md`、`docs/OPERATIONS.md`、`docs/PILOT_ROLLOUT.md`、`docs/business/**`。
5. `README.md` 和本文件中的概览性描述。

AI 提示词与运行时配置的事实来源补充：提示词正文的唯一代码事实来源是 `server/domain/ai-prompt-baselines.ts`（编码/名称/占位符元数据在 `server/domain/ai-config.ts` 的 `PROMPT_REGISTRY`）；运行时参数来自环境变量与代码默认值。数据库 `ai_prompt_templates`、`ai_runtime_settings` 已随迁移 `drizzle/0051_sour_hellfire_club.sql` 删除，不要再依据这两张表判断行为。

如果文档、脚本和实现不一致：

- 不要静默选择一个版本继续扩展。
- 先以当前可执行代码确认实际行为，并在结果中指出差异。
- 若修正文档或配置属于当前任务范围，应与代码在同一变更中同步；否则只做必要修改，不顺手扩大范围。

已知的文档/实现偏差（修改相关代码时按代码为准，顺手纠正需说明）：

- `docs/MANAGEMENT_FRAMEWORK.md` 描述并发控制用请求体 `ManagedPatch<T>`；当前 PATCH 路由实际从查询参数读取 `expectedUpdatedAt`（见 `server/api/v1/school-admin/classes/[id].patch.ts`）。
- `server/utils/db-helpers.ts` 的 `findOwned` 目前没有调用方；`apiContext`、`uuidParam` 也只在少数路由使用。它们是可选简化，不是必须迁移的强制约定。
- 本地 dev 端口 `3305`（`nuxt.config.ts` 的 `devServer.port`），Playwright 用 `3100`；容器内 App 端口 `3300`；正式环境唯一入口是 `docker-compose.yml` 的 nginx（3300 明文 307 跳 3301 HTTPS，`/health/*` 明文直通），应用容器不发布宿主端口；测试环境宿主端口 `3400`（HTTPS `3401`），与正式环境同一套入口规律。

## 3. 当前技术基线

- Node.js `>=24 <25`，进入仓库后先执行 `nvm use 24` 再运行 pnpm 命令；若非交互 Shell 未加载 nvm，先执行 `source /home/llai01/.nvm/nvm.sh`。包管理器固定为 pnpm 11.7；不要使用 npm 或 yarn 改写锁文件。
- Nuxt `^4.4.0`、Vue 3、Nitro（`node-server` preset，`experimental.tasks` 打开）、Nuxt UI、Tailwind CSS v4、Lucide Iconify 图标。
- 组件自动导入配置为 `pathPrefix: false`：`app/components/management/TableToolbar.vue` 直接写作 `<TableToolbar>`，新增组件注意重名。
- TypeScript `strict: true`，运行 `pnpm typecheck`（这是类型门禁的唯一来源：`nuxt.config.ts` 里 `typescript.typeCheck: false`，因为接口路由超过 200 个后 Nuxt/Nitro 的开发态类型浮层会对所有 `$fetch`/`useFetch` 误报 “Type instantiation is excessively deep”，见上游 nuxt/nuxt#33735；IDE 的诊断与 `pnpm typecheck` 都不受影响，不要为此去改业务代码）。
- PostgreSQL 18 + pgvector 0.8.5，Drizzle ORM；数据库结构集中在 `server/db/schema.ts`（当前 59 张表）。
- Zod 用于请求、模型输出和共享契约校验。
- 敏感字段使用 AES-256-GCM 应用层加密；密码使用 Argon2id。
- DeepSeek 用于受限的 Agent 助手回答与语义辅助；向量化当前走百炼 DashScope（`text-embedding-v4`，`vector(1024)`），只用于 `module_resource_chunks`，且需要 `EMBEDDING_ENABLED=true`。代码仍支持 `EMBEDDING_PROVIDER=ollama`，但正式 compose 已不再内置 ollama。
- `xlsx@0.18.5` 用于三库模板解析（`scripts/import-business-data/xlsx-reader.ts` 与平台后台文件导入）。
- Vitest 是单元测试框架（`tests/*.test.ts`）。Playwright E2E 已有真实用例：`tests/e2e/core-flows.spec.ts`，覆盖 `desktop-chromium` 和 `mobile-chromium` 两个 project，`webServer` 会以 `pnpm dev --port 3100` 拉起应用，因此需要可用数据库和种子数据。

依赖版本以 `package.json` 和 `pnpm-lock.yaml` 为准，不要在说明中复制容易过期的 `latest` 版本号。

## 4. 仓库地图

```text
app/
  pages/                  教师首页与模块页、信息中心、心理专员、学校后台、平台后台、
                          数据驾驶舱（pages/dashboard/，学部校长只读看板）、
                          平台使用量（pages/usage/，学校管理员 S1/S2/S4）
  components/
    management/           统一管理框架组件（ManagementPage、ManagedDataTable 等，
                          学校后台导航按激活角色路径域过滤）
    platform-admin/       平台后台专用组件
    dashboard/            驾驶舱专用组件（DashboardLineChart / DashboardDonutChart /
                          DashboardGroupBarChart / DashboardRankTable / DashboardStatCard /
                          DashboardPeriodPicker / DashboardNav；纯 SVG，无图表依赖）
  composables/            useAuth、useCapabilities、useManagedList、useRowEditor、
                          useDisplayLabels、useModuleScores、useMarkdown、useDashboardRange、
                          useDashboardFilters（看板全局下钻，URL 即状态）
  layouts/default.vue     默认布局、水印和打印控制
  middleware/auth.global.ts  前端路由守卫（体验层，不是权限来源）
  assets/css/             Tailwind/Nuxt UI 样式入口
server/
  api/v1/                 Nitro REST/SSE 接口，按业务领域分目录
                          （auth、chat、assessments、plans、information、workbench、
                           notifications、module-resources、admin-access、dashboard、
                           school-admin、platform-admin、specialist、usage；
                           dashboard 下为只读看板：context/overview/comparison/
                           ai-questions/plans/alerts/export/individual；
                           school-admin 下的 usage.get.ts 是学校管理员的平台使用量看板，
                           usage/heartbeat.post.ts 是全部登录角色的使用量活跃心跳上报；
                           platform-admin 下含 ai-center、delegated-management、
                           module-resources 三库运营台）
  db/schema.ts            唯一 Drizzle Schema 文件
  domain/                 业务逻辑：safety、rules、rules-executor、capabilities、
                          lifecycle、admin-access、ai-governance、ai-config、
                          assistant-context、chat-clarification、plan-actions、
                          plan-operations、reports、assessment-instruments、
                          chat-session-contexts（会话对象集）、chat-transfer-source（对话转存来源校验）、
                          instrument-recommendation、business-wizard（编译/解编译/模拟）、
                          entity-snapshots、module-resource-*（校验/投影/文档/交叉引用/
                          文件导入/知识检索/导出）、school-management、school-imports、
                          information-record-targets（记录多对象校验）、
                          invitations、pilot-acceptance、product-events、
                          dashboard-scope（学部范围解析）、dashboard-metrics（看板口径）、
                          platform-usage（使用量 S2 心跳口径与聚合）、
                          question-category（提问 6 分类与关键词）、user-roles（一人多角色）
  integrations/           deepseek.ts（含 redactPii）、ollama.ts
  middleware/security.ts  安全响应头和 API no-store
  plugins/                validate-config、error-handler、notification-worker、
                          usage-heartbeat.client（使用量活跃心跳上报）
  routes/                 health 探针和 openapi.json
  utils/                  db、auth、crypto、audit、handler(apiContext)、
                          pagination(paginateResult)、params(uuidParam)、db-helpers(findOwned)
shared/                   contracts、assessments、reports、management、
                          business-wizard、dashboard（看板契约与东八区自然日工具，
                          前后端共享）
drizzle/                  已生成并提交的数据库迁移
scripts/                  env/migrate/seed/backup/restore、backup-to-oss（阿里云 OSS 自动备份）、
                          reindex、scaffold-management、
                          template:build/split/guide、testdata:build、
                          import-business-data/（xlsx-reader、transformers、importers、quality）
business-libraries/       三库 XLSX 模板与导入源数据（templates/ 下为 v4 填写模板、
                          test-data/ 测试素材、wizard-inputs/ 向导输入）
tests/                    Vitest 单元测试 + tests/e2e/ Playwright 用例 + tests/fixtures/
docs/                     权限矩阵、管理框架、AI/三库、开发发布、运维、试点手册、business/
                          （驾驶舱口径与只读约束见 docs/ROLE_MATRIX.md「数据驾驶舱」章节）
infra/                    PostgreSQL 初始化和 Nginx 配置
```

原始业务资料（量表/工具/术语库源 Excel 与 Word）不随版本库分发，存放在 `临时文件/` 目录（git 忽略），参考时按实际文件名查找。

通知消费者实现在 `server/plugins/notification-worker.ts`，随 Nitro 应用启动。不存在独立的 `pnpm worker` 进程，不要在没有同步修改实现和部署配置的情况下假设它存在。

## 5. 开始修改前

1. 先执行 `git status --short`，保留用户已有改动，不覆盖、不回滚无关文件。
2. 阅读目标文件、相邻路由/组件、相关共享契约和已有测试。
3. 涉及角色权限、敏感数据、危机规则、管理框架、数据库或部署时，再阅读对应 `docs/` 文件。
4. 优先做最小且完整的变更；不要顺手重构无关代码。
5. 行为变化应补测试。修复缺陷时优先增加能复现问题的回归测试。

除非用户明确要求，不提交、不推送、不重写 Git 历史，不启动会下载大模型或改写本地数据的流程。

### 开发-发布工作流授权（必须遵守）

默认工作流是「本地 dev 实时查看」，每一步发布动作都需要用户明确授权：

1. 所有改动默认只在本地 dev（3305）热更新生效，改完立即可让用户实时查看；不部署测试、不部署正式。本地 dev 统一用 `bash scripts/dev-server.sh start` 启动（systemd 用户单元 `mentor-ai-dev`，cgroup 硬上限 MemoryMax 16G，固定连本地开发库 `localhost:5434/mentor_ai_dev`，指向见 `.env.dev`）。不要用裸 `pnpm dev` 长期运行：`NODE_OPTIONS` 只约束 V8 堆，2026-09-10 曾因非堆内存涨到 34.4 GiB 触发内核全局 OOM；`pnpm dev --port 3100` 只留给 Playwright。
2. 提交 git：只有用户明确说「提交」时才执行；多个独立改动必须拆分为多个主题提交，一次提交一个主题，不合并提交。
3. 推送远端：随用户确认的提交执行（用户另有指示时按指示办）。
4. 部署测试环境（3400）：只有用户明确说「部署测试环境」时才执行；只重建镜像、执行 migration 并重启，构建与部署同样显式传 `IMAGE_TAG=<当次构建标签>`（如当天日期）引用版本镜像、不用 `latest`，**不得用正式库备份覆盖测试库数据**（`scripts/refresh-test-db.sh` 仅限特殊场景经授权手动使用，见 `docs/DEVELOPMENT_AND_PRODUCTION.md` 第 8.4 节）。
5. 部署正式环境（Nginx 入口 3300/3301）：只有用户明确说「部署正式环境」时才执行。

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

- `requireUser` 是异步函数，必须 `await requireUser(...)`；这是当前 182 个路由文件中的主流写法。
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
- **角色权限配置（平台后台）**：`roles.permissions` 的能力白名单唯一事实来源是 `shared/management.ts` 的 `TARGET_CAPABILITY_MATRIX`（前端只渲染白名单内的项，PATCH 写入前用 `sanitizeRolePermissions()` 清洗并把清掉的项写审计）；库里没有的目标类型在运行时回退到 `server/domain/roles.ts` 的默认清单，因此编辑器必须用 `effectiveRolePermissions()` 按生效值展示并标注「继承默认」——不能把「缺键」当成「未授权」渲染，否则保存一次就会把缺键写成显式空数组、静默关掉回退逻辑。新增目标类型时同步更新分组、白名单、默认清单、迁移与测试。

## 7. 敏感数据和权限不变量

这些边界不可为了"方便开发"绕过。

### 7.1 加密与最小披露

- `nameEnc`、`phoneEnc`、`profileEnc`、`notesEnc`、`contentEnc`、`summaryEnc`、`descriptionEnc`、`handlingNoteEnc` 等字段写入前使用 `encryptSensitive`，读取时使用 `decryptSensitive`。
- 需要精确检索姓名时使用 `searchableHash`；不要额外保存明文搜索列。
- API 响应不得泄露 `*Enc`、搜索哈希、密码哈希或会话 token。解密后构造明确的响应对象；手机号只在已授权且业务确有需要的教师详情中返回，其他场景用 `maskPhone` / `SENSITIVE_PLACEHOLDER` 脱敏。
- 日志、审计、模型调用记录、通知正文和测试快照遵循最小披露原则。
- `.env`、证书、备份和真实业务数据不得提交。不要打印环境变量或密钥值。

### 7.2 管理员受控只读访问

- 学校管理员查看本校敏感业务档案前，必须填写至少 10 个字符的事由；授权绑定操作者、学校、目标类型和目标 UUID，有效 15 分钟。
- 平台管理员只能申请目标级访问，须由目标学校管理员批准，授权最长 30 分钟。
- 敏感详情接口必须校验 `X-Admin-Access-Grant`，并记录 `adminAccessEvents`。
- "业务档案只读"不等于"后台完全只读"：账号启停、学校设置、档案负责教师/班级分配、学校与内容配置是各角色明确允许的管理操作。
- 管理员不得修改或删除教师业务正文，也不得批量导出业务数据。教师可以通过 `server/api/v1/information/export.get.ts` 导出自己的数据。
- 保留敏感页面的 `no-store`（`nuxt.config.ts` 的 `routeRules` 覆盖 `/school-admin`、`/platform-admin`、`/specialist`、`/information`）、动态水印、打印隐藏正文和打印尝试审计。

### 7.3 数据驾驶舱（只读聚合）

- **组织模型**：学部与学校同级，每个学部是一所独立学校（`六力学校-小学部` / `-初中部` / `-高中部` 分别是 `schools` 记录），跨学部即跨租户。存量拆分脚本 `scripts/split-schools-by-section.ts`。
- 看板角色 `division_principal`（学部校长）、`moral_education_director`（德育主任）、`grade_director`（年级主任）都是只读角色：只看驾驶舱（`/dashboard` 四个页面），不进入统一管理框架，不读写业务正文。看板权限在平台后台「角色权限配置」的四个页面级目标类型下（`dashboard` 数据总览/入口、`dashboard_ai_questions`、`dashboard_plans`、`dashboard_alerts`，三个角色默认勾选，逐页取消后该页接口返回 403 且导航与 `context.pages` 同步收敛）；权限模型细节与留痕口径见 `docs/ROLE_MATRIX.md` 的「驾驶舱权限模型」小节。
- **学校管理员（`school_admin`）不是看板角色**：由平台侧开通，负责校内账号开通/维护与业务管理，并承载平台使用量看板（`/usage`，S1/S2/S4；2026-10-08 起原「学校系统管理员」角色 `system_admin` 已并入本角色，迁移 `drizzle/0065_merge_school_system_admin.sql`）。业务档案仍是事由授权的受控只读。开通方式见 `docs/ROLE_MATRIX.md` 的「学校管理员」小节。
- 账号维护：德育主任与年级主任在学校级账号管理界面开通（学校后台「账号管理」、平台后台「学校管理 → 账号」），角色下拉里选角色，年级主任必填「所辖年级」（写入 `user_roles.scope.grades`，可多选；看板据此收窄）；可维护的角色集合是 `server/domain/user-roles.ts` 的 `SCHOOL_MANAGED_ROLES`（教师、心理专员、德育主任、年级主任），集合外的账号（学校管理员/平台管理员/学部校长）在列表里不给编辑与停用按钮，学部校长仍由平台侧 `scripts/create-account.ts --roles division_principal --section <学部>` 开通。看板角色没有业务数据，停用走「停用账号」而无需业务移交（接口仍是 `transfer-and-disable`，不传 `toUserId`）。
- **业务数据归属与角色变更**：班级/学生/家长/沟通/方案/量表作答/学生事件/AI 会话等记录都靠 `owner_user_id` 挂在教师名下，"能不能改"由「激活角色 + 负责人是不是我」共同决定。因此账号不再持有教师/心理专员角色、却仍有业务数据时会形成"没人能维护"的孤儿数据——换角色或停用前必须先把责任链移交给接收教师：
  - 学校后台「账号管理」换角色时，若账号名下有业务数据且新角色不是业务角色，必须选择「业务接收教师」，服务端在同一次操作（同一事务）里完成移交 + 换角色 + 写 `record_assignments` 移交留痕 + 审计 `school_admin.user.update`；
  - 停用走「移交并停用」（审计 `school_admin.user.transfer_and_disable`）；
  - 两条链路共用 `server/domain/user-transfer.ts`（`userOwnsBusinessData` 判断是否有数据、`transferUserBusinessData` 执行移交），避免口径漂移；
  - 兼任（多角色）账号的角色集合只能在平台后台维护（见下）。
- **平台后台「角色维护」**（`PATCH /api/v1/platform-admin/users/{id}/roles`，UI 在「学校管理 → 学校 → 账号」每行的「角色维护」按钮）：给任意本校账号覆盖式写入角色集合与主角色（例如给学部校长账号加 `teacher` 兼任，之后他在顶栏切换身份即可使用 AI 助手），支持年级主任所辖年级、换角色时一并移交业务数据、未结转介指定新心理专员。只有 `platform_admin` 可调用；不能维护平台管理员账号，也不能通过该入口授予 `platform_admin`（防提权/自锁）；写审计 `platform_admin.user.roles.update`（含 previousRoles 与事由）。
- 看板范围默认就是「本校全部班级」；账号在 `user_roles.scope.section` 声明了具体学部时按该学部收窄，`user_roles.scope.grades` 声明了年级时按这些年级收窄（可多选，兼容旧 `scope.grade`；年级主任未配置年级时返回 400，不放行全校），解析收口在 `server/domain/dashboard-scope.ts`（班级归属优先 `classes.section`，为空或 `all` 时按 `classes.grade` 折算）。路由不得自行拼班级范围。
- 所有看板查询必须 `schoolId + classIds` 双约束；前端传的班级筛选要与本校班级取交集，不允许越界取数。看板默认只到班级维度：不返回提问原文、学生姓名、教师业务正文；预警明细的学生列按周期内首次出现顺序编号为「学生 A/B/C」。**唯一的例外是个体明细下钻**：平台后台按校方授权给角色开通 `dashboard` 记录级的 `view_sensitive`（默认关闭）后，操作时自填事由（≥10 字）换 15 分钟目标级授权。个体明细支持三类目标（`student` / `teacher_profile` / `guardian`，见 PRD W7）：学生给身份 + 学生事件 + 方案风险 + 沟通结构化字段 + 量表等级与主归因 + 提问摘要（≤80 字、已脱敏）；教师只给身份 + 负责范围 + 近 30 天计数；家长给身份 + 关系 + 关联学生 + 沟通结构化字段。三类都**不返回沟通正文与摘要、量表原始作答、助手回答正文**，响应 `no-store` 并带水印，每次读取写管理员访问事件与审计 `dashboard.individual_view`；越界与不存在同样返回 404，并写审计 `dashboard.access_denied`。
- 学生事件与家校沟通支持关联多名学生/家长（2026-10-16）：主对象写主列（看板聚合、通知跳转与导入按主对象读取，一条记录不会在多个班级重复计数），其余写 `student_event_students` / `communication_students` / `communication_guardians`；个体明细下钻对「主对象或关联对象命中」的记录都返回。
- 预警看板（PRD W4/W5）合并六类来源：安全事项（对话助手 / 量表提交）、学生事件（E1–E6）、高风险家校沟通（`communications.risk_level` 为 `crisis`/`high`，未归档=待解决、已归档=已关闭，只给渠道/风险等级/时间/脱敏学生标号，不读正文）、执行项逾期（`plan_actions.due_at` 到期且未完成、已纳入执行）、复盘逾期（`plans.next_review_at` 到期且方案未闭环）。逾期不计入「高危未闭环」，单独统计 `kpis.overdueOpen`（高风险家校沟通计入高危）；逾期行不返回方案标题与执行项正文，只给方案模块名。
- 总览页聚合卡（W2 / W3 / W4-1 / W4-2 / W5，2026-10-10 补齐）：`GET /api/v1/dashboard/overview` 额外返回 `analysis` 分组——W2 AI 问答分布（6 类 + TOP 问题关键词，最多 6 个）、W3 心理测评与方案执行（方案按模块折算的 5 大类，与量表与方案页「量表分类占比」同源）、W4-1 学生事件类型分布（E1–E6）、W4-2 家校沟通渠道分布、W5 高危未闭环 + 方案逾期未闭环。口径复用三个二级页的同一批过滤构造与聚合 SQL（`loadOverviewAnalysis`），不维护第二套统计；**分组随二级页权限收敛**（`requireDashboardEntry` 只下发可访问看板页对应的分组，`dashboard_alerts` 承载 W4-1/W4-2/W5 三组），二级页被取消后聚合卡与入口卡一起消失；无班级范围时给结构一致、数值全 0 的兜底。年级 / 班级筛选同时作用于卡片：预警看板的高危闭环率、事件导入教师数、沟通覆盖率与重点学生等聚合区块此前忽略年级筛选，本次一并收口（与明细和四类计数一致）。
- 年级 / 班级对比（PRD W8）：`GET /api/v1/dashboard/comparison` 默认按年级聚合、传 `grade` 下钻到班级，返回 AI 提问数 / 方案数 / 方案及时率 / 高危未闭环四个指标，排序在服务端完成（比率指标只进排名表，分组柱状图只画三个计数指标）；口径与总览一致，年级主任只出现本年级的行。
- 德育主任（`moral_education_director`）按德育口径裁剪：白名单常量 `DASHBOARD_MORAL_LINE`（提问分类/方案模块/学生事件类型三组），安全事项不裁剪、趋势与年级/班级对比不裁剪、沟通记录不裁剪（德育线没有沟通维度），前端显示「德育口径」徽标。
- 留痕与告警：查看类行为**同时写审计 `dashboard.view`**（每次访问一条）与低敏产品事件 `dashboard_view`；导出、个体明细走审计与管理员访问事件；越权访问尝试（页权限缺失、无 `view_sensitive`、目标越界、跨租户）写审计 `dashboard.access_denied`，跨租户或同一账号 10 分钟内重复 ≥3 次时按去重键通知本校学校管理员与平台管理员，教师端不显示任何告警痕迹。
- 区间上限由服务端校验（总览 31 天、AI 问答 31 天、方案 90 天、预警 365 天），超限返回 400，不做静默截断；总览与 AI 问答的 31 天只为容纳自然月「本月」，固定窗口最长 30 天；默认区间与东八区自然日工具在 `shared/dashboard.ts`，前后端共用同一份。
- 时间粒度：四个看板页都提供「本周 / 本月」自然区间预设（周一起、月 1 日起，预警页另加「近半年」），只有在该页上限内放得下的粒度才提供（自然月按 31 天判断）。环比对照随预设切换：查询参数 `compare=rolling|week|month`（默认 `rolling` = 紧邻等长区间），`week/month` 取「上一自然周 / 上一自然月」（`previousWeekRange` / `previousMonthRange`），对照区间长度可以与本期间不同，页面显式展示对照区间。
- 全局层级下钻（学校 › 年级 › 班级）：`grade` / `classIds` 存在 URL 查询里，四个看板页共用 `app/composables/useDashboardFilters.ts`（页面里的年级下拉、班级多选与页头面包屑读写同一份状态，切页与刷新不丢筛选）；总览的「年级 / 班级对比」下钻也写这份状态；服务端 `overview` / `comparison` / `ai-questions` / `plans` / `alerts` 都接受这两个参数，班级越界由服务端与本校班级取交集，年级主任的可见年级仍由 scope 收窄。
- 明细导出只允许 AI 问答与方案两张表（预警不导出），文件名带操作人与时间戳，内容末尾追加数据水印行（导出人/时间/数据范围/区间），每次写审计 `dashboard.export`；总览页另有 KPI（本期 + 上期）CSV 导出。明细导出的表头跟随页面的「表头维度」勾选（`dims=grade,className,category,date`，全不勾用 `dims=none` 只导周期总计一行）。
- 明细表「表头维度」勾选控制的是**聚合维度**（服务端 group by），不只是列显隐：未勾选的维度既不参与聚合也不出现在表头，全部不勾时只出一行周期总计（日期列展示统计区间）；固定指标列不参与勾选。新增明细表时按 `server/domain/dashboard-metrics.ts` 的 `TABLE_DIMENSION_COLUMNS` + `parseTableDimParam` 实现，比率类排序列必须同时出现在分组子查询里（否则页面能点、服务端 `order by` 报列不存在）。
- 已知口径细节：安全事件的 `severity` 现行写法是 `red`（`server/domain/safety.ts`），看板高危判定按 `red/high/crisis` 兼容；方案风险等级取 `plans.report.risk.severity` 的 `low/medium/high/crisis`；量表与方案页的「问题风险等级分布」（原型 W3 卡片式区块）按明细表同源的三档展示——安全关注（crisis）并入高风险、原型四档里的「健康」在现行方案报告口径里没有独立取值（并入低风险），`riskDistribution` 三档合计等于方案总数。
- 派生指标（PRD 6.1，2026-10-09 落地）：AI 问答页给活跃教师数 / 人均提问（提问 ÷ 活跃教师）/ 平均会话轮次（提问 ÷ 有提问的会话）；量表与方案页给方案接受率（`plans.acceptance_decision = 'accepted'` ÷ 方案总数）与提醒触达率（周期内站内通知已读 ÷ 通知总数，按记录人主班级归属）；预警看板给高危闭环率（已关闭高危 ÷ 高危总数，含已关闭记录，**不受页面状态筛选影响**）、心理高风险学生数（复用量表页等级折算）、危机沟通数（风险等级分布折算）、沟通覆盖率（有沟通记录的去重学生 ÷ 范围内在册学生）、重点学生与其沟通条数（重点学生 = 周期内出现高危学生事件 / 高风险量表等级 / 高风险沟通的学生）、事件导入教师数。人均类与比率类分母为 0 一律返回 null（页面显示「—」）。
- 使用量看板 S2 埋点（2026-10-09 落地）：客户端每 5 分钟一次活跃心跳（`app/plugins/usage-heartbeat.client.ts` → `server/api/v1/usage/heartbeat.post.ts`，仅页面可见时上报、服务端按会话节流 4 分钟），落 `product_events` 的 `platform_active_beat`（metadata 只含会话 id，属低敏运营数据）；聚合口径在 `server/domain/platform-usage.ts`（访问人次按空闲 30 分钟切段、人均时长按 5 分钟心跳折算并单人单日封顶 24 小时）。心跳上线前没有访问时长数据。
- 验证入口：`pnpm tsx scripts/dashboard-smoke.ts`（三所学校的学部校长账号，跨校隔离断言）。

完整权限矩阵以 `docs/ROLE_MATRIX.md` 为准。

## 8. AI 助手、三库和安全熔断

### 8.1 安全与模型边界

- 本地危机关键词和硬规则必须先于常规模型回答执行；语义模型只能补充识别，不能削弱本地规则。
- **首页助手（聊天链路）的安全命中一律只做后台预警**，不停答、教师端不显示任何预警痕迹（2026-09-17 业务确认）：本地硬规则（明确措辞）与语义层（首轮识别 + 复核两轮都成立）命中时，都在同一事务中创建 `safetyEvents`、`referrals`、`notificationOutbox` 和 `auditLogs`，回答照常生成。复核调用失败时保留首轮判定；复核清空时只记 `assistant_semantic_safety_cleared` 产品事件，不建事件与转介。**量表提交的熔断不受影响**：红线命中仍停答并让教师端进入转介指引（`assessments/[module]/submit.post.ts` 的 `fuse` 载荷）。
- 量表计分、业务分级、危机熔断、归因和管理员授权必须由确定性代码执行，不能交给 LLM 决定。
- 发送给外部模型的教师输入和历史消息必须先经 `redactPii`（`server/integrations/deepseek.ts`）；不要把完整电话、邮箱、姓名或未授权业务正文放入 Prompt。
- 学校级数据模式 `local | redacted | full_context` 由 `server/domain/ai-governance.ts` 控制；`full_context` 需要协议版本、学校审批和教师确认同一告知版本，任一门禁不满足自动回退 `redacted`。
- 模型调用日志（`aiModelCalls`）只记录必要元数据，不记录完整 Prompt 或教师原文。
- DeepSeek 或 Ollama 不可用时保留现有本地/关键词降级路径，不得让安全规则依赖外部服务可用性。

### 8.2 首页 AI 助手（回答先行）

- 首页 AI 只做分析与建议：先给出当下可执行的初步判断，信息不足时在回答末尾问一个能改变判断的具体问题（哪个学生或哪类班级、最近一次发生的时间与场合、家长原话、教师已试过的做法），不用方向二选一或泛泛的感受题代替追问；能从工具与上下文查到的事实不要反问教师。必要时推荐量表或建议进入模块；不能生成正式方案，不能跳过量表，不能替代归因规则。
- 所有消息统一走 Agent 图（`server/agent/graph.ts`），没有 Agent 开关。入口只做认证、装配与 SSE 转发，图执行、回答校验与落库在共享流水线 `server/domain/chat-stream.ts`（普通提问与「重新生成」复用同一份）。Agent 本轮无产出时自动整轮重试一次，重试轮追加一条不落库的临时提示（传输层另有 SDK 自动重试）；模型以空正文结束或工具预算用尽而本轮已有工具结果时，先补一次不绑定工具的收尾回答（不再整轮重试，避免重复展示工具过程）；补答仍失败由入口发 `error` 事件，不生成兜底回答、不回退其它提示词。
- 只读工具共 14 个，按上下文裁剪（`server/agent/tools/index.ts`），数据读取集中在 `server/domain/assistant-readers.ts`：知识检索、模块分诊（含模块 playbook）、量表推荐（与模块页同一套门禁，被锁改推前置；对象级量表——`per_case`、红线检查，以及班级系统这类评估对象是班级/学生/家长的模块——的完成状态与触发条件只认当前会话绑定的同一咨询对象，未绑定对象时按「未对该对象做过」处理，触发依据给的是实测均分与结论等级而不是规则原文）、实体记忆（跨会话读取同一咨询对象的相关历史：限定当前教师/学校/对象，最多 20 个会话、120 条候选，按当前问题相关性与纠正信息选取最多 12 条、6000 token，逐条带来源消息；未传参数时用当前会话绑定的对象，会话未绑定时用本轮识别到的对象）、咨询对象档案、学生检索/档案、方案与复盘、评估历史、沟通记录、班级概览、教师待办、三库资源目录与三库明细（`resource_detail`：按模块 + 现象关键词/名称返回归因项的表现、成因、建议动作与工具卡的适用症状、关键步骤，单次最多 6 条；只读已发布版本 payload、版本切换自动跟随，证据规则/分级规则/红线/禁忌规则不返回，正文字段命中 `server/domain/knowledge-text-guard.ts` 的禁用措辞即置空、名称含红线词整条丢弃）；其中方案、评估历史与沟通记录默认按当前会话绑定的咨询对象集收口（主对象 + 关联对象，最多 5 个；主对象写在 `chat_sessions.context_type/context_id`，其余在 `chat_session_objects`，见 `server/domain/chat-session-contexts.ts`），会话未绑定对象时用本轮消息里识别出的对象集兜底（`server/domain/assistant-object-mention.ts`：按当前教师负责的在册名单做包含匹配，可同时命中多名学生，只有同名多条档案或超过 5 个才把候选交界面点选；识别结果不改变会话绑定，已绑定会话提到不同的一组对象只提示是否切换）（`plan_lookup` / `assessment_history` / `communication_lookup` 返回逐条带 `object` 标签，未指定对象时不把别的学生/家长/班级的记录混进来；请求声明不带档案（`withoutRecord`）或该工具不支持该对象类型——沟通记录没有班级维度——时退回教师维度并逐条标注；多对象时逐对象取并集，未收口不混算）。工具启用清单与轮次上限来自 `AI_AGENT_ENABLED_TOOLS` / `AI_AGENT_MAX_TOOL_ROUNDS`。同轮内相同 (工具, 参数) 的重复调用复用结果，单次工具执行默认 10 秒超时并按失败回传模型自愈。**新增数据能力一律走只读工具**：写操作仍由既有 REST 路由执行，不新增写工具。
- SSE 事件当前为：`ack`（额外带会话绑定对象集 `contexts`、本轮对象集 `turnObjects`/候选、切换提示 `suggestedContexts`，并保留 `context`/`turnObject`/`suggestedContext` 作为主对象别名；事件名不变）、`answer_start`、`thinking`、`tool_call`、`tool_result`、`sources`、`action_card`、`answer_delta`、`module_proportions`、`answer`、`error`、`done`。聊天链路不再发送 `fuse`（安全命中只做后台预警）；改动事件名必须同时更新前端消费方。
- 历史消息仍可能带旧的 `route`、`clarification_round`、`clarification_summary` 元数据，前端只作只读回看渲染，不再产生新数据。
- 对话记忆按「只追加前缀 + token 预算」装载（`server/domain/chat-history.ts`，预算见 `AI_AGENT_HISTORY_TOKEN_BUDGET`）：不要重新引入按条数滑窗（历史 `limit(8)` 与图内 `slice(-12)` 已删除），否则每轮请求前缀都会分叉，DeepSeek 前缀缓存全部落空。超预算时由 `server/domain/chat-compaction.ts` 做低频大块压缩（摘要加密落库，原始消息保留不删），再用 `server/agent/tool-trace.ts` 回放最近一轮工具轨迹。
- 咨询对象档案不进 system prompt（保持前缀稳定），由 `record_snapshot` 工具按需查询；外发内容按学校数据模式脱敏（`server/domain/ai-governance.ts` 的 `redactOutboundText`），`local` 模式不调用外部模型。
- 模型调用（含每次工具往返与摘要调用）写 `ai_model_calls`：只记元数据、输入/输出/缓存命中 token 与结束原因（`finish_reason`），不记 Prompt 与正文；以空正文结束的异常往返记 `failed` + `empty_round:<finish_reason>`；AI 中心「调用审计」按缓存命中列观察命中率、按结束原因列分辨上游中断，概览页按 `assistant_tool_called` 产品事件展示工具使用。
- 回答先经确定性校验再落库（`server/agent/answer-guard.ts`）：清理来源标注、时长信息、模块英文 ID 与内部字段名；诊断性表述、无依据的「平台规定」类表述、疑似密钥只告警不改写；清理后为空则回退原文。命中写 `assistant_answer_flagged` 产品事件与消息 metadata。
- 教师可中断本轮生成（前端 `AbortController`，服务端落库前检查中断标记，中断则不写库并记 `assistant_answer_aborted`）；`POST /api/v1/chat/messages/[id]/regenerate` 可重新生成一条回答（旧回答软删，事件流不变）。空态「今日建议」由 `GET /api/v1/chat/assistant-brief` 确定性生成（不调用模型）。

### 8.3 三库资源

- 三库固定为 `assessment`、`attribution`、`tool`，运行时发布版本来自 `moduleResourceLibraries` 和 `moduleResourceVersions`，明细落在 `moduleResourceAssessmentItems`、`moduleResourceAttributionRules`、`moduleResourceToolItems`，文档与切块在 `moduleResourceDocuments`、`moduleResourceChunks`。
- 导入链路：XLSX 模板（`business-libraries/templates/`）→ `scripts/import-business-data/`（`xlsx-reader` → `transformers/*` → `quality` → `importers`）或平台后台的 `server/domain/module-resource-file-import.ts`。
- 业务填写模板当前为 **v4**（`三库填写模板_v4.xlsx`，23 个 sheet）。改模板必须走 `pnpm template:build` 重新生成，再 `pnpm template:split` 同步 `public/templates/` 下的分库模板；两条链路的 sheet 名匹配（`module-resource-file-import.ts` 与 `transformers/*`）要一起改，否则新 sheet 会被静默丢弃或误认。测试数据用 `pnpm testdata:build` 重出。
- 写入前必须经 `validateModuleResourcePayload()` 校验、`previewModuleResourcePayload()` 预览，发布时用 `projectModuleResourcePayload()` / `rebuildModuleResourceProjection()` 生成运行时投影。不要绕过校验直接写明细表。
- 运行时读取用 `resolvePublishedModuleResource()` 等函数，并遵守 `scope`（全局/校级）可见性规则。
- 学段可见性（`shared/school-section.ts`）：量表/工具/知识库文档都带「适用学部」（all/primary/junior/senior/repeat，未标注按 all）。教师侧读取按 `users.teaching_grades` 折算学段过滤：标了具体学部的只对同学段可见，未标注或 all 的始终可见，教师未填任教年级时不过滤，过滤后为空则回退全部。**开关默认关闭**：`SCHOOL_SECTION_FILTER_ENABLED`（compose 里同名 + `NUXT_` 前缀）为 false 时所有请求都不过滤（任何教师看到全部内容），内容按学段细分后再置 true。开关与查看者学段统一走 `server/utils/stage-filter.ts` 的 `viewerSchoolSections(event, grades)`——不要在调用点直接调 `schoolSectionsOfGrades()`，否则会绕过开关。接入点在 `listAssessmentInstruments` / `listInstrumentOptions` / `listPublishedModuleTools` / `readPublishedResourceCatalog` / 知识检索 SQL（`schoolSectionVisibility`）。管理端（平台后台、运营台、导出、交叉校验）不做学段过滤。知识库文档的学段维护入口：批量导入模板与导出 XLSX 都带「适用学部」列（列名一致，可导出改完再导入）、平台后台知识库列表与文档详情可见且详情可改（`PATCH /api/v1/platform-admin/module-resources/documents/{id}` 在同一事务同步文档与全部切块 metadata，只动这一个键、不重建向量）、「从三库导入」按版本 payload 继承（`schoolSectionOfResourceRows`：整版同一具体学部才采用，混杂/缺失按 all）、存量用 `pnpm backfill:school-section --library-types=knowledge`（`--mark-ready` 顺带把历史 draft 独立文档置 ready）。
- 量表计分、等级、主归因、次归因、工具匹配、方案结构和风险判断必须由确定性代码执行。
- 资源导入禁止包含真实个人业务数据。红线、计分阈值和制度要求必须同步到确定性规则和测试（`tests/rules*.test.ts`、`tests/module-resources*.test.ts`、`tests/fixtures/business-resource-golden.ts`）。
- 三库字段规范见 `docs/business/library-standards/*.md`，跨模块依赖见 `docs/business/cross-module-dependencies.md`。

### 8.4 AI 中心与三库向导

- 平台后台 AI 中心（`server/api/v1/platform-admin/ai-center/` + `server/domain/ai-config.ts`）：提示词正文随代码发布（`prompts` 只读列表，正文唯一来源是 `server/domain/ai-prompt-baselines.ts`，改文案走代码评审与发版）、模型调用审计（`model-calls`，只记元数据）、运行时配置只读展示与联调测试（`runtime`，参数来自环境变量与代码默认值）。
- 提示词与运行时配置都不再有库内来源：`ai_prompt_templates`、`ai_runtime_settings` 已随迁移 `drizzle/0051_sour_hellfire_club.sql` 删除，不要再为 AI 中心新增写接口或依赖这两张表。
- 没有 Agent 开关：所有消息一律走 Agent 图；新增 AI 能力时不要再引入「经典 / Agent」双模式分支。
- 三库向导（`server/api/v1/platform-admin/module-resources/wizard-*` + `server/domain/business-wizard*.ts`）：以 `business-libraries/wizard-inputs/` 为输入，走编译 → 校验/预览 → 模拟 → 导入链路，与 XLSX 导入共用同一套校验与投影，禁止绕过校验直接写明细表。

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
bash scripts/dev-server.sh start   # 本地开发服务器（3305）标准启动方式：systemd 单元 + cgroup 内存上限
bash scripts/dev-server.sh status  # 单元状态、内存上限、健康检查（stop / restart / logs 同理）
pnpm dev                  # 裸启动 Nuxt（无内存上限，只用于临时调试；见第 5 节说明）
pnpm build                # 生产构建
pnpm typecheck            # Nuxt/TypeScript 类型检查
pnpm test                 # Vitest 单元测试
pnpm test:watch           # Vitest 监听模式
pnpm test:e2e             # Playwright；会自行拉起 3100 端口的 dev server，需要数据库和种子数据
pnpm env:init             # 仅本地首次初始化/补全 .env
pnpm db:up                # 启动 postgres 并执行迁移（正式 compose；向量化走 DashScope，不再拉取本地模型）
pnpm db:generate          # 从 Schema 生成 migration
pnpm db:migrate           # 执行未运行的 migration
pnpm db:seed              # 仅本地或获批测试环境的演示数据
pnpm import:business-data # 三库 XLSX 导入，支持 --dry-run --publish --strict-quality
                          # --require-complete --include-legacy-raw --module= --type=
pnpm resources:reindex    # 重建模块资源向量（需 EMBEDDING_ENABLED=true）
pnpm backup:oss           # 数据库 + 代码 + 提交历史备份到阿里云 OSS（--check / --list / --dry-run）
                          # 配置在仓库根 .env.backup（模板 .env.backup.example）；cron 见 scripts/install-backup-cron.sh
pnpm scaffold:management  # 生成管理模块骨架 --area <area> --entity <entity>
pnpm tsx scripts/dashboard-smoke.ts  # 学部校长看板三校隔离冒烟（只读业务数据）
                          # 学校/账号缺失时打印下一步命令（迁校脚本 / 开通账号）
pnpm tsx scripts/split-schools-by-section.ts          # 按学部把「六力学校」拆成三所学校（默认 dry-run）
                          # 加 --apply 写库；教师与业务数据随人迁移，判断不出的账号留在原校
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
- AI 变更：验证正常模型、无密钥、超时/非法响应、Agent 自动重试与重试耗尽后的 `error` 路径。不使用「澄清多轮状态机」验证项，该状态机已删除。
- 三库变更：`--dry-run` 导入 + 校验/预览/投影相关测试 + golden fixture 比对。

交付时说明：

1. 改了什么以及为什么。
2. 实际运行了哪些验证及结果。
3. 哪些验证因环境限制未运行。
4. 发现但未纳入本次范围的仓库差异或风险。

## 13. 部署正式版（固定流程）

当用户说「部署正式版/部署正式环境/上线」时，必须遵守：

1. **先向用户询问本次发布的版本号（`vX.Y.Z` 格式），得到确认前不得开始部署**，不得擅自沿用或选择版本号。
2. **三处版本号保持一致**：`shared/app-version.ts` 的 `APP_VERSION`（登录页等页面展示的版本号）、git 标签、docker 镜像标签使用同一个 `vX.Y.Z`，缺一不可；展示号在打标签前随代码提交（`chore(release): 版本号更新 vX.Y.Z`）。
3. 询问版本号的同时提醒核对上线配置项（短信网关非 mock、DeepSeek 连通性、危机配置真实值、演示账号清理），未就绪需用户明确放行。
4. 构建与部署显式传 `IMAGE_TAG=vX.Y.Z` 引用版本镜像，**不使用 `latest` 部署**（`latest` 只作兜底别名，部署后让它跟随本次版本）：`IMAGE_TAG=vX.Y.Z docker compose build app migrate` → 把 `latest` 指向该版本 → `IMAGE_TAG=vX.Y.Z docker compose up -d --no-build` → `IMAGE_TAG=vX.Y.Z docker compose ps` 核对镜像标签。执行顺序与验证要求以 `docs/OPERATIONS.md`「发布与回滚」章节为准（版本标签 → 备份 → 构建 → 部署 → 验证）。
5. 部署完成汇报：展示号、git tag、docker tag（app 与 migrate）、备份文件、迁移结果、健康检查与冒烟结果。
6. 回滚显式引用上一版本镜像（`IMAGE_TAG=v<上一版本> docker compose up -d --no-build`），不依赖 `latest`。

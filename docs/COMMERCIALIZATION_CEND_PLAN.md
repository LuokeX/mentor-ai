# 商业化 C 端（注册 + 积分 + 会员）开发计划

> 依据：`临时文件/班助AI 注册+积分/班主任智能体-注册积分-简版V1.docx`、`班主任智能体-注册积分页面.html`、`班主任智能体 协议隐私文件-参考.docx`。
> 本文是开发计划，不是 PRD 替代；开始编码前需确认文末「待确认事项」。

## 1. 目标与已确认方向

### 1.1 目标

为校外 C 端教师提供独立入口：手机号注册/登录、完善资料、积分、签到、任务、会员（线下开通），并按次扣减 AI 问答/量表方案的积分。

### 1.2 已确认决策

| 决策 | 结论 |
|---|---|
| 租户模型 | **B：真正多租户**：一个账号、一行用户，可属于多个租户/工作区 |
| C 端租户 | 所有 C 端用户共用一个「C 端学校」租户 |
| 账号体系 | 同一手机号一个账号；学校老师开通 C 端后，顶栏切换「学校工作区 / C 端工作区」 |
| MVP 登录 | 手机号 + 密码 + 图形验证码，不接短信 |
| 会员开通 | 平台后台 C 端运营页，运营线下打标（月/季/半年/年） |
| 扣费规则 | 先冻结、成功结算、失败/中断/空回答退回 |
| 忘记密码/换绑/注销 | MVP 不做自助，运营人工处理 |

### 1.3 不在本期范围

- 短信验证码、忘记密码/换绑/注销的短信校验
- 在线支付/自动续费
- PC 扫码登录
- 复杂风控/设备指纹
- 备课能力（`临时文件/备课产品设计(1)/` 是另一条商业化能力，单独排期）

## 2. 现状与关键约束

1. **`users.school_id` 是单值**：当前一个账号只属于一所学校。
2. **聊天/消息表强制 school_id**：`chat_sessions.school_id`、`chat_messages.school_id` 均 NOT NULL；聊天入口要求 `user.schoolId`。
3. **`user_roles` 没有 school_id**：唯一约束是 `(user_id, role_code)`，无法表达“同一角色在不同租户”。
4. **`sessions` 只有 `active_role`**：没有“当前激活租户”，多租户切换缺少会话状态。
5. **无积分/会员/任务/签到/C 端资料表**。
6. **无登录短信/图形验证码基础设施**：现有短信只用于通知 Outbox（默认 mock）。
7. **现有学校功能必须零回归**：教师、心理专员、学校管理员、驾驶舱、平台后台全部要保持现有行为。
8. **业务档案禁止物理删除**：C 端注销在 MVP 先人工处理，避免与现有保留策略冲突。

## 3. 目标架构

### 3.1 核心思路

保留 `AuthUser.schoolId` 字段，但它的值改为**当前激活租户**，不再直接取 `users.school_id`。这样聊天、量表、方案、信息中心等业务路由大部分不用改，改动集中在认证、角色和后台。

```
users（手机号全局唯一，一行）
  ├─ user_roles(school_id=小学部, role=teacher)
  └─ user_roles(school_id=C端学校, role=teacher)

sessions.active_school_id = 当前工作区
AuthUser.schoolId = 当前工作区
```

### 3.2 租户与账号规则

- `users.school_id` 保留为「默认/主租户」：
  - 纯 C 端用户：`users.school_id = C端学校`；
  - 学校老师：保持原学校；C 端身份通过 `user_roles(school_id=C端学校, role=teacher)` 表达。
- 登录后默认工作区：
  - 学校入口：主租户（`users.school_id`）；
  - C 端入口：C 端租户（若用户有 C 端角色，否则提示开通/注册）。
- 顶栏工作区切换：只展示用户实际持有角色的租户。
- 学校老师第一次使用 C 端：
  - 手机号已存在学校账号时，C 端注册/开通需校验学校账号密码（无短信时的身份证明）；
  - 校验通过后只增加 C 端角色，不复制用户。
- 纯 C 端用户：注册时创建 `users` 行（`school_id=C端学校`）+ `user_roles(teacher)`。

### 3.3 数据隔离

- 所有业务查询继续用 `AuthUser.schoolId`（= 激活租户）+ `ownerUserId` 约束。
- 学校后台只能看到主租户为本校的用户；C 端运营页按 `user_roles.school_id=C端学校` 查询。
- C 端用户只授予 `teacher` 角色，不授予 `school_admin`/看板角色。
- 上线前必须验证：
  - C 端用户 A 不能看到 B 的班级、学生、对话、方案、量表；
  - 学校管理员不能看到 C 端业务数据；
  - C 端运营页不返回对话/方案正文。

## 4. 数据模型与迁移

### 4.1 新增/修改表

| 表 | 变更 | 说明 |
|---|---|---|
| `schools` | 新增 `kind` | `school` / `cend`；平台后台学校列表默认过滤 `cend` |
| `sessions` | 新增 `active_school_id` | 当前激活租户；为空时回落 `users.school_id` |
| `user_roles` | 新增 `school_id` | 角色按租户隔离；唯一约束改为 `(user_id, school_id, role_code)` |
| `cend_profiles` | 新增 | 昵称、学科、年级、教材版本、地区、教龄、角色、完善时间 |
| `cend_point_accounts` | 新增 | 当前余额、版本号；原子更新用 |
| `cend_point_transactions` | 新增 | 流水：类型、金额、状态（pending/settled/refunded）、幂等键、关联消息/方案、余额快照 |
| `cend_task_completions` | 新增 | 一次性任务完成记录；唯一 `(user_id, task_key)` |
| `cend_checkins` | 新增 | 每日签到；唯一 `(user_id, checkin_date)`；连续天数、奖励 |
| `cend_activity_days` | 新增 | 连续使用 7 天统计；唯一 `(user_id, activity_date)` |
| `cend_memberships` | 新增 | 会员等级、起止时间、状态、操作人、事由 |
| `cend_agreements` | 新增 | 协议类型、版本、接受时间、IP |
| `cend_feedback` | 新增（可选） | 站内反馈表单；用于“提交产品反馈”任务 |

### 4.2 任务定义

任务清单建议用代码常量（不做后台可编辑），避免运营误改奖励：

| taskKey | 奖励 | 触发 |
|---|---|---|
| `first_question` | +100 | 首次成功完成 AI 问答 |
| `complete_profile` | +200 | 注册后首次提交完善资料弹窗 |
| `submit_feedback` | +300 | 提交站内反馈 |
| `use_7_days` | +400 | 连续 7 个自然日有成功 AI 问答 |

### 4.3 迁移步骤

1. 修改 `server/db/schema.ts`。
2. `pnpm db:generate` 生成 migration。
3. 人工检查 SQL：
   - `user_roles.school_id` 先加 nullable → 用 `users.school_id` 回填 → 再设 NOT NULL（platform_admin 等无学校账号单独处理）；
   - 删除旧唯一索引，建 `(user_id, school_id, role_code)` 唯一索引；
   - `sessions.active_school_id` 加 FK/索引，允许 NULL。
4. 在本地开发库和测试库现有数据副本上演练。
5. 测试环境通过后再谈正式环境；正式发布需另行授权。

## 5. 认证与多租户改造

### 5.1 会话与身份

- `createSession(event, userId, { activeSchoolId? })`：
  - 默认 `activeSchoolId = users.school_id`；
  - C 端登录传 C 端学校 id。
- `currentAuth`：
  - 读取 `sessions.active_school_id`，为空回落 `users.school_id`；
  - 校验用户在该租户有角色；
  - 加载该租户下的角色集合与 scope；
  - 返回 `AuthUser.schoolId = activeSchoolId`。
- `switch-role`：只在当前激活租户的角色集合内切换。
- `POST /api/v1/auth/switch-tenant`：校验目标租户角色后更新 `sessions.active_school_id`，并重置 `active_role` 为该租户的角色之一。
- `GET /api/v1/auth/me`：增加 `tenants` 列表（学校 id、名称、可用角色、是否当前）。

### 5.2 角色写入

- `applyUserRoles` / `addUserRole` / `removeUserRole` 增加 `schoolId` 参数：
  - 只新增/更新/删除该租户的角色行；
  - **绝不能删除其他租户的角色**。
- 调用方逐个更新：
  - 学校后台建号/改角色：传本校 schoolId；
  - 平台后台角色维护：传目标账号的主学校或指定租户；
  - `scripts/create-account.ts`、`scripts/split-schools-by-section.ts`、seed：传对应 schoolId；
  - C 端开通：传 C 端 schoolId。
- `userHasRole` / `userHasAnyRole` 增加可选 `schoolId` 条件；审计所有调用点，避免跨租户误判。

### 5.3 登录/注册入口

- 学校入口：保持 `/login` 与现有 `POST /api/v1/auth/login`。
- C 端入口：`/cend/login`，调用 `POST /api/v1/cend/auth/login`（或现有登录接口加 `entry=cend`）。
- C 端注册：`POST /api/v1/cend/auth/register`：
  - 手机号不存在：创建用户（`school_id=C端学校`）+ C 端角色 + 新手积分；
  - 手机号已存在学校账号：校验学校密码 → 只增加 C 端角色 + 新手积分；
  - 已存在 C 端角色：提示直接登录。
- 图形验证码：服务端生成、服务端校验、一次性、带过期时间；MVP 不接短信。
- 基础频控：注册/登录按 IP+手机号限流；验证码错误次数限制。

## 6. C 端功能与页面

| 页面/路由 | 内容 |
|---|---|
| `/cend/login` | 登录/注册 Tab、密码登录、图形验证码、协议勾选 |
| `/cend` | AI 对话首页、积分入口、工作区/头像菜单 |
| `/cend/points` | 签到、任务中心、积分流水 |
| `/cend/profile` | 个人资料、修改密码入口（人工/二期） |
| `/cend/agreements/*` | 服务协议/隐私政策占位页 |
| 顶栏工作区切换 | 学校工作区 / C 端工作区（仅展示有权限的租户） |
| `/platform-admin/cend` | C 端用户列表、会员打标、积分调整、流水、反馈 |

## 7. API 清单（草案）

### C 端

- `GET /api/v1/cend/captcha`：图形验证码
- `POST /api/v1/cend/auth/register`
- `POST /api/v1/cend/auth/login`
- `GET /api/v1/cend/me`：C 端资料 + 积分 + 会员状态
- `PATCH /api/v1/cend/profile`
- `GET /api/v1/cend/points`：余额 + 流水（分页）
- `GET /api/v1/cend/tasks`
- `POST /api/v1/cend/tasks/:taskKey/claim`（一次性任务；自动触发的任务可不暴露）
- `POST /api/v1/cend/checkins`
- `POST /api/v1/cend/feedback`
- `POST /api/v1/auth/switch-tenant`
- `GET /api/v1/auth/me`（扩展 `tenants`）

### 平台后台

- `GET /api/v1/platform-admin/cend/users`
- `GET /api/v1/platform-admin/cend/users/:id`
- `GET /api/v1/platform-admin/cend/users/:id/transactions`
- `PATCH /api/v1/platform-admin/cend/users/:id/membership`（等级/起止/事由）
- `POST /api/v1/platform-admin/cend/users/:id/points/adjust`（补/扣 + 事由）
- `GET /api/v1/platform-admin/cend/feedback`

### 内部服务（非公开 API）

- `reservePoints(userId, amount, idempotencyKey, reference)`
- `settlePoints(transactionId)`
- `refundPoints(transactionId, reason)`
- `grantTaskReward(userId, taskKey)`
- `checkIn(userId)`
- `activeMembership(userId)`

## 8. 积分与扣费设计

### 8.1 流水类型

`signup_bonus` / `checkin` / `checkin_streak` / `task_reward` / `ai_question` / `assessment_plan` / `refund` / `admin_adjust`

### 8.2 扣费流程

1. 非会员发起 AI 问答：创建 `pending` 冻结流水（100 积分），幂等键 = 用户消息 id。
2. 回答成功落库：`settle`。
3. 失败/中断/空回答：`refund`。
4. 会员：跳过冻结；仍写一条 `member_exempt` 事件或审计（不扣积分）。
5. 量表 + 方案：建议在“生成方案”时冻结 200，成功 settle，失败 refund。
6. 余额扣减用原子 SQL（`UPDATE ... WHERE balance >= amount`）或行锁；并发请求不能双花。
7. 所有积分变更写审计/流水；管理员调整必须有事由。

### 8.3 签到与任务

- 签到：东八区自然日唯一；连续天数从昨天记录 +1；第 7 天额外 +400；断签重置。
- 首次问答/首次完善资料/反馈：唯一 `(user_id, task_key)`，重复提交不重复发。
- 连续使用 7 天：`cend_activity_days` 记录当天是否有成功 AI 问答；连续 7 天发 +400。
- 新手 1000 积分：注册时一次性，幂等键 `signup:<userId>`。

## 9. 实施阶段与工期

> 估算按 1 名熟悉仓库的后端/全栈开发，含自测；不含需求评审等待时间。

### Phase 0：方案与迁移设计（1–2 天）

- 确认文末待确认事项。
- 定稿表结构、索引、迁移 SQL、回滚方案。
- 产出：迁移草案、接口契约、测试清单。

### Phase 1：多租户认证与角色（5–7 天）

- `schools.kind`、`sessions.active_school_id`、`user_roles.school_id`。
- `currentAuth`、`createSession`、`switch-tenant`、`switch-role`。
- 角色写入按租户隔离；`userHasRole` 审计。
- 前端 `useAuth` 增加 tenants；顶栏工作区切换。
- 退出标准：学校现有登录/权限/E2E 不回归；同一账号可切换两个租户；跨租户数据隔离测试通过。

### Phase 2：C 端租户、注册登录与资料（5–7 天）

- 创建 C 端学校租户；C 端注册/登录；图形验证码。
- C 端资料表与完善资料弹窗/页面。
- 新手积分、默认“我的班级”。
- 退出标准：新用户注册→登录→完善资料→进入 C 端首页；学校老师开通 C 端后可切换。

### Phase 3：积分、签到、任务、会员（5–7 天）

- 积分账户/流水、冻结/结算/退回。
- 签到、连续签到、任务、连续使用 7 天。
- 会员表与有效期判断；平台后台会员打标/积分调整。
- 退出标准：积分流水可追溯、幂等、并发不双花；会员免扣；后台操作有审计。

### Phase 4：AI/量表扣费接入（3–5 天）

- 聊天入口冻结/结算/退回；会员豁免。
- 量表+方案生成扣费；失败退回。
- 首次问答任务触发。
- 退出标准：正常/失败/中断/重试/并发/会员五类场景通过。

### Phase 5：C 端页面与运营后台（4–6 天）

- `/cend` 首页、积分中心、任务中心、资料页、协议页。
- 平台后台 C 端运营页。
- 退出标准：按 HTML 原型完成主流程；移动端/PC 端可用。

### Phase 6：联调、回归与测试环境（2–3 天）

- `pnpm typecheck`、`pnpm test`、`pnpm build`。
- `pnpm test:e2e`（学校核心路径回归）。
- 新增 C 端 E2E：注册→资料→积分→问答扣费→积分不足→会员免扣→切换学校。
- 部署测试环境（3400/3401），冒烟后交付验收。

**合计：约 6–8 周。**

## 10. 测试计划

### 10.1 单元测试

- `user_roles` 按租户增删改；切换租户后角色正确。
- `currentAuth` 激活租户/角色解析。
- 积分流水幂等、冻结/结算/退回、并发扣减。
- 签到连续天数/断签/第 7 天奖励。
- 任务一次性、连续使用 7 天。
- 会员有效期（未开始/生效/过期）。

### 10.2 集成/E2E

- 同一手机号：学校登录 → C 端登录 → 工作区切换 → 数据隔离。
- 学校管理员改角色不影响 C 端角色；C 端运营改会员不影响学校角色。
- C 端用户 A 不能读取 B 的班级/学生/对话/方案/量表。
- 提问成功扣 100；失败/中断退回；会员不扣；积分不足弹窗。
- 量表+方案扣 200；失败退回。
- 注册已存在学校手机号：密码校验通过才开通 C 端；错误密码拒绝。

### 10.3 回归

- 学校四角色核心路径（教师、心理专员、学校管理员、驾驶舱）跑 `pnpm test:e2e`。
- 迁移后用现有测试库数据验证登录、班级、学生、方案、看板。

## 11. 发布与回滚

- 新增环境开关 `CEND_ENABLED`（默认 false）；学校部署不开启时 C 端入口不出现、注册接口 404。
- 先发测试环境（3400/3401），按仓库流程显式 `IMAGE_TAG`；正式环境需另行授权与版本号。
- 迁移只做加法（新列/新表/回填/新索引），不做破坏性删除；旧唯一索引在回填完成后替换。
- 回滚：关闭 `CEND_ENABLED` + 回滚上一镜像；已写入的积分/会员数据保留，不回滚数据。
- 会员/积分操作全部审计；C 端运营页只读业务正文。

## 12. 待确认事项（开始编码前）

1. **量表+方案 200 积分**：在“生成方案”时扣（建议）还是“开始量表”时扣？
2. **连续使用 7 天**：按“当天至少一次成功 AI 问答”（建议）、登录还是任意页面访问？
3. **同一手机号两端密码**：共用学校账号密码（建议）还是 C 端单独密码？
4. **提交产品反馈 +300**：站内表单（建议）还是外部问卷？外部问卷无法可靠确认提交。
5. **服务协议/隐私政策**：最终文本和版本号；参考文档目前只有两个外链。
6. **C 端入口与品牌**：独立域名/路径（建议 `/cend`）还是与学校端同页；C 端品牌是否用“班主任智能体”。
7. **C 端学校名称/代码**：建议 `code=cend`、名称“班主任智能体 C 端”。
8. **纯 C 端用户默认班级的年级**：完善资料时用第一个所选年级（建议）；跳过资料时用“一年级”占位。

## 13. 实现进度（2026-10-23）

已实现并发布测试环境（镜像 `20261023-4`）：

- **多租户底座**：`schools.kind`、`sessions.active_school_id`、`user_roles.school_id`；迁移回填存量角色；`AuthUser.schoolId` 改为「当前激活租户」。
- **工作区切换**：`POST /api/v1/auth/switch-tenant`；`/auth/me` 返回 `tenants`；顶栏学校/C 端切换器。
- **C 端租户**：`code=cend` 的共用租户；平台后台学校列表与平台总览默认排除 C 端租户。
- **统一登录页**：`/login` 顶部切换「学校账户 / 个人账户」；`/cend/login` 兼容跳转到 `/login?account=personal`；学校账户下的「选择测试账户」默认折叠。
- **C 端注册/登录**：手机号 + 密码 + 图形验证码；已有学校账号校验原密码后只追加 C 端角色；注册自动建「我的班级」。
- **C 端资料**：`cend_profiles` + 完善资料页；首次提交 +200 积分。
- **积分**：`cend_point_accounts` / `cend_point_transactions`；注册 +1000、签到 +200（连续 7 天 +400）、任务奖励、运营补/扣；冻结/结算/退回；会员免扣。
- **AI 问答扣费**：C 端非会员提问前冻结 100，成功结算，失败/中断/空回答退回；学校租户不扣。
- **量表+方案扣费**：C 端新建方案时扣 200（会员免扣），与方案写入同一事务；合并已有方案不重复扣。
- **平台后台 C 端运营页**：用户列表、会员线下开通/续期、积分调整、流水。
- **安全兜底**：C 端租户没有学校管理员/心理专员，安全事件除创建转介外，额外通知平台管理员跟进。
- **登录频控**：同一 IP + 手机号 10 分钟内失败 10 次后临时锁定。
- **协议占位页**：`/cend/agreements/service|privacy`，注册勾选并记录版本。
- **验证**：typecheck、Vitest、构建、测试环境健康检查与四角色实时冒烟通过。
  - Playwright 全量套件：23 passed / 9 failed，失败均与本次改动无关：7 条 `assistant-upgrade`（旧断言仍期望 `contextType/contextId`，前端已发送 `contexts`；其中 1 条 desktop 为 3100 dev server 启动超时），2 条 CRUD（用例依赖 `16688096890` 在小学部，当前开发库该账号在初中部，属学校拆分后的测试数据漂移）。未在本期修改这些测试。

尚未完成 / 上线前必须处理：

- **C 端安全事件升级路径**：已加平台管理员站内通知兜底；上线前仍需指定明确的 C 端安全负责人/线下处置流程。
- **协议与隐私政策**：已加占位页并记录 `cend_agreements` v1；正式文本仍需法务提供并替换。
- **登录/注册频控**：登录已加单进程内存频控；多实例部署前需换成共享存储，注册侧仍建议加 IP 限流。
- **会员购买引导**：当前积分页展示会员权益与「联系运营」说明，尚未做原型中的会员弹窗/二维码占位。
- **忘记密码/换绑手机号/账号注销**：按已确认决策，MVP 由运营人工处理。
- **C 端数据删除策略**：注销仍为人工；需要与现有「业务档案禁止物理删除」口径对齐。
- **备课能力**：另一个商业化需求，未在本期实现。

C 端验收修复（2026-10-26，测试环境镜像 `20261026-4`）：

- 注册后不再跳独立资料页，落到首页 `/?welcome=1` 并在 AI 助手页上方弹出完善资料弹窗（半透明蒙版、可关闭/跳过），保存后清除查询参数。
- 顶栏积分按钮显示剩余积分；问答完成、签到、保存资料后刷新。新增 `GET /api/v1/cend/points/balance` 轻量接口。
- 教材版本改为下拉（原型预设版本 + 「其他」补填全称），完善资料弹窗与个人资料页共用同一组字段。
- 去掉登录页「个人账户 · 注册即送 1000 积分」副标题与登录表单底部说明。
- 401 全局拦截排除 `/api/v1/cend/auth/`：登录/注册的密码错误不再被误写成「登录已过期」。
- 验收中修复：弹窗内多选下拉层级被遮挡；教材版本选「其他」后回退为未选择；顶栏余额在 SSR 阶段无 Cookie 请求导致刷新跳登录。
- 验证：`pnpm typecheck`、`pnpm test`（85 files / 1143 tests）、`pnpm build` 通过；测试环境 migrate 退出码 0、3400/3401 健康检查 200；浏览器实际点击完成注册→弹窗→资料保存→积分扣减→错误密码提示→刷新会话保持的验收。

测试环境发布记录（2026-10-23）：

- 镜像：`mentor-ai-test-app:20261023-4` / `mentor-ai-test-migrate:20261023-4`，`latest` 已跟随；上一版 `20261023-3` 保留作回滚点。
- migrate 退出码 0（0072 租户字段回填 + C 端租户、0073 C 端表）。
- 健康检查：3400 / 3401 均 200；`/cend/login`、协议占位页 200。
- 冒烟：C 端注册/登录/资料/签到/积分/会员、平台后台 C 端运营、学校教师双工作区切换、四角色学校端登录、C 端跨用户班级隔离（A 读 B 返回 404）均通过。
- 安全兜底：C 端聊天命中安全关键词后，平台管理员收到「C 端安全事件待跟进」站内通知。

测试环境验收账号（仅测试库）：

- C 端纯新用户：`13900000097` / `CendTest@2026`（已有 1100 积分 + 月度会员 + 我的班级）。
- 学校教师兼 C 端：`16688096890` / `Mentor@2026`（学校工作区 + C 端工作区，可验证顶栏切换）。
- 平台后台 C 端运营页：用平台管理员 `13800000000` 登录后进入「平台管理 → C 端运营」。

### 备课能力第一块（2026-10-27）

- 首页 AI 助手增加「对话 / 备课」Tab；备课模式复用现有会话、流式回答、安全规则与 C 端积分（100 积分/次，会员免扣）。
- 新增 `assistant_lesson_prep` 提示词与 `buildLessonPrepFormatInstruction`，支持日常教案、赛课、班会、项目化四种输出结构。
- 新增 `app/utils/lesson-prep.ts` 三个提示词模板（学情/班情、赛课、班会）；模式随提问落库，重新生成按原模式重跑。
- 新增「导出 Word」：助手消息按 OOXML 生成 `.docx`（标题、段落、列表、表格等），只导出本人回答，写审计与产品事件。
- Phase 2：备课资料上传（txt/md/docx，≤20MB）、会话工作区绑定、4 个工作区工具（list/read/write/delete），默认 `SANDBOX_ENABLED=false`；上传/删除写审计与产品事件。
- Phase 3a：备课回答自动写入工作区 `备课方案-<id>.md`；Word 导出优先读工作区产物（教师/Agent 修改生效），产物缺失时回退消息正文。
- 本期未做：PPT/Excel/图片导出、xlsx/pptx 解析、案例/视频推荐、学习中心与付费链路；后续按 PRD 分块推进。
- 详细说明见 `docs/AI_ASSISTANT_AND_KNOWLEDGE.md` 第 3.3 节。

## 14. 交付物

- `server/db/schema.ts` + 新 migration（人工检查 SQL）。
- 多租户 auth/roles 改造 + `switch-tenant`。
- C 端注册/登录/资料/积分/签到/任务/会员 API + 页面。
- AI/量表扣费接入（冻结/结算/退回）。
- 平台后台 C 端运营页。
- 单元/集成/E2E 测试。
- 文档更新：`AGENTS.md`、`docs/ROLE_MATRIX.md`、`README.md`、`docs/DEVELOPMENT_AND_PRODUCTION.md`（`CEND_ENABLED`）。
- 测试环境部署记录与验收清单。

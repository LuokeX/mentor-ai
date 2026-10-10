# 教师赋能智能平台

依据《教师赋能智能平台 PRD V2.0》实现的校内封闭试用版代码基线。项目采用 Nuxt 4、Vue 3、Nitro、PostgreSQL 和 Drizzle；通知消费者作为 Nitro 插件随 App 运行，包含教师、心理专员、学校管理员（含账号开通/权限维护与平台使用量看板）、数据驾驶舱角色（学部校长 / 德育主任 / 年级主任）、平台管理员等角色（一个账号可持有多个角色，同一时刻只有一个激活角色）。

## 已实现范围

- AI 分诊助手：首页只负责澄清问题、推荐模块、说明理由和提示评估准备；本地危机规则先行、PII 脱敏、DeepSeek 分诊辅助、Zod 校验、失败自动降级、会话历史和教师确认主模块。
- 三库运营台：平台管理员按五模块维护 `assessment`、`attribution`、`tool` 三类库，支持标准 Excel/JSON 导入、预检、发布、全局/校级范围、重复校验和审计。
- 五个业务模块：动态问卷、确定性计分/分级、规则归因、工具匹配、方案生成和跟踪复盘；自我成长的连续四次低意义感紫色规则由历史记录计算。一个模块可编排多张量表（入口筛查 → 深度诊断 → 专项情境），由前置/互斥/触发条件编排，多张量表的结果在评估组内聚合，全部做完后统一生成一份方案。
- 问卷草稿同时保存在浏览器和服务端，可跨会话恢复；共享 Zod 契约生成 `/openapi.json`。
- 账号入校：72 小时一次性激活链接、管理员重新邀请/停用，以及 users/classes/students/guardians 四类 CSV 预检和事务导入；学校管理员还可用同一入口导入家校沟通 / 学生事件记录两类业务记录（Excel 模板、严格预检，只新增不覆盖，记录归属学生负责教师）。
- 信息中心：状态、班级、学生、家长、沟通记录和方案记录；教师可下载 Excel 模板批量导入学生、家长、家校沟通与学生事件记录（只限自己负责的学生，任一错误行整批不写入）；个人字段使用 AES-256-GCM 加密，教师可导出自己的完整 JSON 数据，管理员不能调用该导出。
- 执行闭环：稳定 UUID 方案动作、今日/逾期待办、7 天复盘节点、个人站内通知和 AI 回答反馈；方案结论不由 AI 自动改写。
- AI 数据治理：学校级 `local | redacted | full_context` 模式、供应商协议和学校审批门禁、教师版本化告知、发送前上下文预览和“不带档案咨询”。
- 安全熔断：风险事件、转介、短信 Outbox 和审计在单一事务中生成；危机短信只含事件号和登录提示，支持 5 分钟确认 SLA、15 分钟升级 SLA、转派和不可变处置时间线。
- 心理专员工作台：只能处理分配给本人的最小转介包，展示状态、优先级、SLA 倒计时、处置记录和关闭原因。
- 学校后台：校内账号、心理专员配置、敏感业务档案只读访问、访问事由、15 分钟目标级授权、平台访问审批和访问审计。
- 平台后台：学校及学校管理员创建、学校启停、内容包发布/停用/回滚、服务状态、学校批准的 30 分钟 Break-glass 访问。
- 防扩散控制：敏感响应 `no-store`、动态水印、打印正文隐藏、打印尝试审计、管理员无批量导出接口、详情集合最多返回 50 条。
- 试点运营：不记录业务正文的产品事件、学校聚合指标面板、桌面与手机双视口 Playwright 核心路径。
- 数据驾驶舱：只读看板，供学部校长、德育主任、年级主任三类角色使用。组织模型是「学部 = 学校」（`六力学校-小学部` 等各是一所学校），看板默认按本校全部班级取数，账号显式配置 `user_roles.scope.section` 时才收窄到该学部，年级主任按 `user_roles.scope.grade` 只看所辖年级。总览 KPI（AI 问答次数、推荐量表作答率、总体方案量、方案完成度、方案执行及时率、高危未闭环）与 AI 问答分析、量表与方案两页的 KPI 均带环比对照；二级页含 AI 问答分布与推荐量表作答转化、关键词 Top 榜、高风险对话数、量表作答与方案执行完成度/回填率/风险分布、安全事项 / 学生事件 / 方案逾期（执行项与复盘）预警与趋势、学生事件类型分布、家校沟通渠道分布、年级与班级对比下钻；学生列脱敏为编号，明细导出仅限问答与方案两张表并逐次审计；个体明细下钻（学生 / 负责教师 / 家长）默认关闭，开通后需每次填写事由换 15 分钟授权。
- 学校管理员：校内账号开通与维护、学校后台各项管理，并查看平台使用量看板（账号开通量与角色分布、使用量趋势、本校操作审计日志）；账号能力与业务管理同属一个角色（原「学校系统管理员」已并入），业务档案为事由授权的受控只读，不进入数据驾驶舱。
- 统一身份登录：OIDC 授权码 + PKCE 接入学校统一身份平台，与账密登录并存，角色仍由本系统维护；对接说明见 [docs/SSO_OIDC.md](docs/SSO_OIDC.md)。
- 部署：Node 24、PostgreSQL 18、Nginx/TLS、Docker Compose、健康检查、迁移、备份和恢复脚本。

## 本地启动

前置条件：Node.js 24、pnpm 11、Docker Desktop。以下是首次初始化流程：

```bash
cp .env.example .env
pnpm install
pnpm env:init
pnpm db:up:local
pnpm db:seed
pnpm dev
```

`pnpm env:init` 会替换模板占位值、生成互不相同的随机本地密钥，并为已有 `.env` 补充新配置，不会打印密钥或覆盖已有值。本地开发使用独立的 PostgreSQL 容器（`docker-compose.local.yml`，端口 5434，库名 `mentor_ai_dev`），与正式环境数据库物理隔离；Ollama 复用正式实例，Embedding 模型无需重复下载。`pnpm db:migrate`、`pnpm db:seed` 和 `pnpm dev` 会自动读取 `.env`；通知消费随 App 启动，无独立 `pnpm worker` 命令。

日常开发通常只需：

```bash
pnpm db:up:local
pnpm dev
```

`db:seed` 只导入本地演示数据，不得在正式环境执行；**禁止在开发机上执行 `pnpm db:up`**（它会操作正式环境 compose 与正式数据库）。数据库 Schema 变更、应用发布、生产迁移、备份恢复和禁止事项见 [数据库与应用开发、发布和运行规范](docs/DEVELOPMENT_AND_PRODUCTION.md)。

访问 `http://localhost:3305`。演示账号的初始密码均为 `Mentor@2026`（与正式库一致的演示账号，`db:seed` 保证存在）：

| 角色 | 账号（手机号） |
|---|---|
| 平台管理员 | `13800000000` |
| 学校管理员 | `13800000001`（六力学校管理员） |
| 心理专员 | `13800000002`（张心理） |
| 教师 | `16688096890`（张忠程） |

教师账号由学校管理员按班级导入或邀请开通（参见 `scripts/import-class-teachers.ts`）；`db:seed` 仅为本地/测试环境预置上述四个演示账号，不额外创建教师。

测试/UAT 环境（`docker-compose.test.yml`，3400 → 3401）的登录页额外提供「选择测试账户」入口，可一键填入平台管理员、三学部管理员、心理专员、三学部校长等预置测试账号（清单见 `app/utils/test-accounts.ts`）；正式环境不注入开关、不显示该入口。

若没有配置 `DEEPSEEK_API_KEY`，系统自动使用本地分诊降级规则；Ollama 不可用时模块资源向量处理会降级，不影响量表、归因和工具匹配；`SMS_PROVIDER=mock` 时短信仅写入 App 的通知插件日志。

## 校内服务器部署

1. 复制 `.env.example` 为 `.env`，分别替换数据库管理员密码、应用数据库密码、`SESSION_SECRET`、`ENCRYPTION_KEY`、域名、DeepSeek 和短信配置。所有密钥建议使用 `openssl rand -base64 48` 独立生成，且不要复用。
2. 将证书放到 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`；没有域名或学校签发证书时，用 `scripts/gen-cert.sh --env=prod` 生成本地自签证书（设备需信任 `infra/certs/ca.pem` 才能使用语音输入）。
3. 执行：

```bash
docker compose build
docker compose up -d
curl -fsS http://localhost:3300/health/ready
```

PostgreSQL 首次初始化会创建无建库/建表权限的 `mentor_app` 运行账户；只有 `migrate` 和备份恢复使用数据库管理员。`migrate` 成功后 App 启动，通知消费者随 App 一起运行。Nginx 是唯一入口：3300 明文 307 跳转到 3301 HTTPS（访问地址需显式带 `:3301`），并对登录接口限速；应用容器不再直接发布明文端口。

## 质量检查

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

当前单元测试覆盖五模块关键阈值、反向计分、连续四次紫色规则、危机关键词、邀请过期、方案节点、CSV 解析和 AI 数据模式；Playwright 覆盖四角色的桌面与手机视口核心路径。正式 UAT 仍需业务方提供完整题库、120 条路由黄金样本和规则黄金样本。分批准入、指标口径和演练记录见 [校内试点验收手册](docs/PILOT_ROLLOUT.md)。

## 数据运维

备份：

```bash
BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh         # 发布前的快速本地备份（仅数据库）
pnpm backup:oss                                      # 数据库 + 代码 + 提交历史 → 阿里云 OSS（每日 03:00 由 cron 执行）
```

`pnpm backup:oss` 需要先在仓库根创建 `.env.backup`（模板见 `.env.backup.example`），并保持 OSS bucket 为私有读写；配置项、连通性自检（`--check` / `--list` / `--dry-run`）、cron 安装（`./scripts/install-backup-cron.sh`）和从 OSS 恢复的步骤见[运维手册](docs/OPERATIONS.md)。

恢复会覆盖现有对象，必须显式确认并应先在隔离环境演练：

```bash
CONFIRM_RESTORE=RESTORE_MENTOR_AI ./scripts/restore.sh backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
```

详细命令规范见 [数据库与应用开发、发布和运行规范](docs/DEVELOPMENT_AND_PRODUCTION.md)，事故步骤见 [运维手册](docs/OPERATIONS.md)，权限边界见 [角色权限矩阵](docs/ROLE_MATRIX.md)。

AI 分诊配置、三库资源、方案闭环和当前边界见 [AI 分诊与三库资源说明](docs/AI_ASSISTANT_AND_KNOWLEDGE.md)。

## 封闭试用边界

这是一套可运行的 RC 基线，不代表正式生产合规验收。深度 HERO/AS/PCS/六维量表、完整工具内容、真实短信模板、120 条路由评测、50 并发压测及第三方安全测试，必须在业务题库和校方基础设施就绪后完成。正式启用前需要业务、校方和合规负责人签字，确认管理员可见字段、告知文本、红线规则和事故联系人。

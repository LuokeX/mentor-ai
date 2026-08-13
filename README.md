# 教师赋能智能平台

依据《教师赋能智能平台 PRD V2.0》实现的校内封闭试用版代码基线。项目采用 Nuxt 4、Vue 3、Nitro、PostgreSQL 和 Drizzle；通知消费者作为 Nitro 插件随 App 运行，包含教师、心理专员、学校管理员、平台管理员四类角色。

## 已实现范围

- AI 分诊助手：首页只负责澄清问题、推荐模块、说明理由和提示评估准备；本地危机规则先行、PII 脱敏、DeepSeek 分诊辅助、Zod 校验、失败自动降级、会话历史和教师确认主模块。
- 三库运营台：平台管理员按五模块维护 `assessment`、`attribution`、`tool` 三类库，支持标准 Excel/JSON 导入、预检、发布、全局/校级范围、重复校验和审计。
- 五个业务模块：动态问卷、确定性计分/分级、规则归因、工具匹配、方案生成和跟踪复盘；自我成长的连续四次低意义感紫色规则由历史记录计算。
- 问卷草稿同时保存在浏览器和服务端，可跨会话恢复；共享 Zod 契约生成 `/openapi.json`。
- 账号入校：72 小时一次性激活链接、心理专员自助 TOTP 绑定与单次恢复码、管理员重新邀请/MFA 重置/停用，以及 users/classes/students/guardians 四类 CSV 预检和事务导入。
- 信息中心：状态、班级、学生、家长、沟通记录和方案记录；个人字段使用 AES-256-GCM 加密，教师可导出自己的完整 JSON 数据，管理员不能调用该导出。
- 执行闭环：稳定 UUID 方案动作、今日/逾期待办、7 天复盘节点、个人站内通知和 AI 回答反馈；方案结论不由 AI 自动改写。
- AI 数据治理：学校级 `local | redacted | full_context` 模式、供应商协议和学校审批门禁、教师版本化告知、发送前上下文预览和“不带档案咨询”。
- 安全熔断：风险事件、转介、短信 Outbox 和审计在单一事务中生成；危机短信只含事件号和登录提示，支持 5 分钟确认 SLA、15 分钟升级 SLA、转派和不可变处置时间线。
- 心理专员工作台：强制 TOTP，只能处理分配给本人的最小转介包，展示状态、优先级、SLA 倒计时、处置记录和关闭原因。
- 学校后台：校内账号、心理专员配置、敏感业务档案只读访问、访问事由、15 分钟目标级授权、平台访问审批和访问审计。
- 平台后台：学校及学校管理员创建、学校启停、内容包发布/停用/回滚、服务状态、学校批准的 30 分钟 Break-glass 访问。
- 防扩散控制：敏感响应 `no-store`、动态水印、打印正文隐藏、打印尝试审计、管理员无批量导出接口、详情集合最多返回 50 条。
- 试点运营：不记录业务正文的产品事件、学校聚合指标面板、桌面与手机双视口 Playwright 核心路径。
- 统一身份登录：OIDC 授权码 + PKCE 接入学校统一身份平台，与账密登录并存，角色仍由本系统维护；对接说明见 [docs/SSO_OIDC.md](docs/SSO_OIDC.md)。
- 部署：Node 24、PostgreSQL 18、Nginx/TLS、Docker Compose、健康检查、迁移、备份和恢复脚本。

## 本地启动

前置条件：Node.js 24、pnpm 11、Docker Desktop。以下是首次初始化流程：

```bash
cp .env.example .env
pnpm install
pnpm env:init
pnpm db:up
pnpm db:seed
pnpm dev
```

`pnpm env:init` 会替换模板占位值、生成互不相同的随机本地密钥，并为已有 `.env` 补充新配置，不会打印密钥或覆盖已有值。`pnpm db:up` 会启动带 pgvector 的 PostgreSQL 18、Ollama、模型拉取和数据库迁移；首次启动需下载 Ollama 镜像和约 639 MB 的 Embedding 模型。`pnpm db:migrate`、`pnpm db:seed` 和 `pnpm dev` 会自动读取 `.env`；通知消费随 App 启动，无独立 `pnpm worker` 命令。

日常开发通常只需：

```bash
pnpm db:up
pnpm dev
```

`db:seed` 只导入本地演示数据，不得在正式环境执行。数据库 Schema 变更、应用发布、生产迁移、备份恢复和禁止事项见 [数据库与应用开发、发布和运行规范](docs/DEVELOPMENT_AND_PRODUCTION.md)。

访问 `http://localhost:3301`。演示账号的初始密码均为 `Mentor@2026`：

| 角色 | 账号 |
|---|---|
| 教师 | `teacher@demo.local` |
| 心理专员 | `psychologist@demo.local` |
| 学校管理员 | `school.admin@demo.local` |
| 平台管理员 | `platform.admin@demo.local` |

心理专员演示 TOTP secret 为 `JBSWY3DPEHPK3PXP`。它只用于本地演示，部署时必须删除演示账号或重新绑定。

若没有配置 `DEEPSEEK_API_KEY`，系统自动使用本地分诊降级规则；Ollama 不可用时模块资源向量处理会降级，不影响量表、归因和工具匹配；`SMS_PROVIDER=mock` 时短信仅写入 App 的通知插件日志。

## 校内服务器部署

1. 复制 `.env.example` 为 `.env`，分别替换数据库管理员密码、应用数据库密码、`SESSION_SECRET`、`ENCRYPTION_KEY`、域名、DeepSeek 和短信配置。所有密钥建议使用 `openssl rand -base64 48` 独立生成，且不要复用。
2. 将证书放到 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`。
3. 执行：

```bash
docker compose --profile tls build
docker compose --profile tls up -d
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.text()).then(console.log)"
```

PostgreSQL 首次初始化会创建无建库/建表权限的 `mentor_app` 运行账户；只有 `migrate` 和备份恢复使用数据库管理员。`migrate` 成功后 App 启动，通知消费者随 App 一起运行。Nginx 将 HTTP 强制跳转到 HTTPS，并对登录接口限速。

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
BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh
```

恢复会覆盖现有对象，必须显式确认并应先在隔离环境演练：

```bash
CONFIRM_RESTORE=RESTORE_MENTOR_AI ./scripts/restore.sh backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
```

详细命令规范见 [数据库与应用开发、发布和运行规范](docs/DEVELOPMENT_AND_PRODUCTION.md)，事故步骤见 [运维手册](docs/OPERATIONS.md)，权限边界见 [角色权限矩阵](docs/ROLE_MATRIX.md)。

AI 分诊配置、三库资源、方案闭环和当前边界见 [AI 分诊与三库资源说明](docs/AI_ASSISTANT_AND_KNOWLEDGE.md)。

## 封闭试用边界

这是一套可运行的 RC 基线，不代表正式生产合规验收。深度 HERO/AS/PCS/六维量表、完整工具内容、真实短信模板、120 条路由评测、50 并发压测及第三方安全测试，必须在业务题库和校方基础设施就绪后完成。正式启用前需要业务、校方和合规负责人签字，确认管理员可见字段、告知文本、红线规则和事故联系人。

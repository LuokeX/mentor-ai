# 教师赋能智能平台

依据《教师赋能智能平台 PRD V2.0》实现的校内封闭试用版代码基线。项目采用 Nuxt 4、Vue 3、Nitro、PostgreSQL、Drizzle 和独立 PostgreSQL Outbox Worker，包含教师、心理专员、学校管理员、平台管理员四类角色。

## 已实现范围

- 完整 AI 助手：本地危机规则先行、PII 脱敏、DeepSeek 多轮回答、知识检索与来源引用、Zod 校验、失败自动降级、会话历史和教师确认主模块。
- AI 业务知识库：平台管理员导入 Markdown/TXT/JSON，自动分块、草稿发布、全局/校级范围、重复校验和模型调用审计。
- 四个业务模块：动态问卷、确定性计分/分级、行动和工具生成、方案存档；自我成长的连续四次低意义感紫色规则由历史记录计算。
- 问卷草稿同时保存在浏览器和服务端，可跨会话恢复；共享 Zod 契约生成 `/openapi.json`。
- 信息中心：状态、班级、学生、家长、沟通记录和方案记录；个人字段使用 AES-256-GCM 加密，教师可导出自己的完整 JSON 数据，管理员不能调用该导出。
- 安全熔断：风险事件、转介、短信 Outbox 和审计在单一事务中生成；Worker 支持 1/5/15 分钟重试、过期锁恢复和通知幂等键。
- 心理专员工作台：强制 TOTP，只能处理分配给本人的最小转介包。
- 学校后台：校内账号、心理专员配置、敏感业务档案只读访问、访问事由、15 分钟目标级授权、平台访问审批和访问审计。
- 平台后台：学校及学校管理员创建、学校启停、内容包发布/停用/回滚、服务状态、学校批准的 30 分钟 Break-glass 访问。
- 防扩散控制：敏感响应 `no-store`、动态水印、打印正文隐藏、打印尝试审计、管理员无批量导出接口、详情集合最多返回 50 条。
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

`pnpm env:init` 仅替换模板占位值，生成互不相同的随机本地密钥，不会打印密钥，也不会覆盖已经初始化的 `.env`。`pnpm db:up` 会启动 PostgreSQL 18、创建低权限 `mentor_app` 账号，并以 `mentor_admin` 执行迁移。`pnpm db:migrate`、`pnpm db:seed` 和 `pnpm worker` 也会自动读取 `.env`；Shell 或 CI 中已设置的环境变量优先。

日常开发通常只需：

```bash
pnpm db:up
pnpm dev
```

`db:seed` 只导入本地演示数据，不得在正式环境执行。数据库 Schema 变更、应用发布、生产迁移、备份恢复和禁止事项见 [数据库与应用开发、发布和运行规范](docs/DEVELOPMENT_AND_PRODUCTION.md)。

访问 `http://localhost:3000`。演示账号的初始密码均为 `Mentor@2026`：

| 角色 | 账号 |
|---|---|
| 教师 | `teacher@demo.local` |
| 心理专员 | `psychologist@demo.local` |
| 学校管理员 | `school.admin@demo.local` |
| 平台管理员 | `platform.admin@demo.local` |

心理专员演示 TOTP secret 为 `JBSWY3DPEHPK3PXP`。它只用于本地演示，部署时必须删除演示账号或重新绑定。

若没有配置 `DEEPSEEK_API_KEY`，系统自动使用本地路由降级规则；`SMS_PROVIDER=mock` 时短信仅写入 Worker 日志。

## 校内服务器部署

1. 复制 `.env.example` 为 `.env`，分别替换数据库管理员密码、应用数据库密码、`SESSION_SECRET`、`ENCRYPTION_KEY`、域名、DeepSeek 和短信配置。所有密钥建议使用 `openssl rand -base64 48` 独立生成，且不要复用。
2. 将证书放到 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`。
3. 执行：

```bash
docker compose --profile tls build
docker compose --profile tls up -d
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.text()).then(console.log)"
```

PostgreSQL 首次初始化会创建无建库/建表权限的 `mentor_app` 运行账户；只有 `migrate` 和备份恢复使用数据库管理员。`migrate` 成功后 App 和 Worker 才启动。Nginx 将 HTTP 强制跳转到 HTTPS，并对登录接口限速。

## 质量检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

当前单元测试覆盖四模块关键阈值、反向计分、连续四次紫色规则、危机关键词和 AI/管理员输入契约。正式 UAT 仍需业务方提供完整题库、120 条路由黄金样本和规则黄金样本。

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

AI 助手配置、知识库导入、发布状态、内容规范和当前边界见 [AI 助手与业务知识库使用说明](docs/AI_ASSISTANT_AND_KNOWLEDGE.md)。

## 封闭试用边界

这是一套可运行的 RC 基线，不代表正式生产合规验收。深度 HERO/AS/PCS/六维量表、完整工具内容、真实短信模板、120 条路由评测、50 并发压测及第三方安全测试，必须在业务题库和校方基础设施就绪后完成。正式启用前需要业务、校方和合规负责人签字，确认管理员可见字段、告知文本、红线规则和事故联系人。

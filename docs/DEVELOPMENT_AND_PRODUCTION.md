# 数据库与应用开发、发布和运行规范

本文是教师赋能智能平台在本地开发、测试演练和正式环境中的命令与操作基线。涉及数据库结构、数据迁移、应用发布、Worker、备份或恢复时必须遵守本文。事故处置细节另见 [运维手册](OPERATIONS.md)。

## 1. 环境边界

| 环境 | 用途 | 数据要求 | 允许执行 `db:seed` | 启动方式 |
|---|---|---|---|---|
| 本地开发 | 编码、调试、单元测试 | 仅使用虚构或脱敏数据 | 允许 | Node.js + 本地专用 Docker PostgreSQL（5434/mentor_ai_dev） |
| 测试/UAT | 发布前演练：迁移、功能与数据核对 | 正式库最新备份的完整副本（本机回环访问，禁止外传） | 禁止 | `docker-compose.test.yml`（5435/mentor_ai，app 3400） |
| 正式环境 | 校内封闭试用和正式业务 | 真实业务数据 | 禁止 | Docker Compose + Nginx/TLS |

必须保证：

- 三类环境使用不同的数据库；测试环境的数据来自正式备份副本，**仅允许 `127.0.0.1` 回环访问**，禁止开放端口、禁止将副本外传或截图外发。
- `.env` 不提交到版本库，文件权限应为 `600`。日志、备份和截图不得包含密钥或业务正文。
- `mentor_admin` 只用于初始化、迁移、备份和恢复；App 与 Worker 只能使用无建库、建表权限的 `mentor_app`。
- 正式环境只部署经过测试并冻结的版本，不直接在服务器上修改源码、Schema 或历史 migration。

## 2. 命令速查

| 命令 | 作用 | 使用环境 |
|---|---|---|
| `pnpm env:init` | 为本地 `.env` 替换占位值并生成随机密钥 | 仅本地首次初始化 |
| `pnpm db:up:local` | 启动本地开发专用 PostgreSQL（`docker-compose.local.yml`，端口 5434） | 本地开发 |
| `bash scripts/refresh-test-db.sh` | 将正式库最新备份恢复进测试库（`docker-compose.test.yml`，端口 5435） | 发布演练前 |
| `docker compose -f docker-compose.test.yml up -d` | 启动测试环境（migrate + app 3400） | 发布演练 |
| `pnpm db:up` | 启动正式环境 compose 的 PostgreSQL、Ollama 并执行 migration | 仅正式环境部署流程 |
| `pnpm db:generate` | 根据 Drizzle Schema 生成新 migration | 本地开发 |
| `pnpm db:migrate` | 执行尚未执行的 migration | 本地或受控发布流程 |
| `pnpm db:seed` | 创建演示学校、账号和种子内容 | 仅本地开发环境 |
| `pnpm import:business-data` | 导入三库标准数据：`assessment`、`attribution`、`tool` | 本地或经审批的正式发布流程 |
| `pnpm resources:reindex` | 为缺失向量或模型版本不一致的模块资源片段重新生成向量 | 本地或受控发布流程 |
| `pnpm dev` | 启动 Nuxt App 及内置通知消费者 | 仅本地 |
| `pnpm typecheck` | TypeScript/Nuxt 类型检查 | 开发与 CI |
| `pnpm test` | 单元及规则测试 | 开发与 CI |
| `pnpm build` | 构建生产产物 | 开发验证与 CI |

正式环境使用 `docker compose` 命令，不使用 `pnpm dev` 或 `pnpm preview`。

## 3. 本地开发

### 3.1 首次初始化

前置条件为 Node.js 24、pnpm 11 和 Docker Desktop。

```bash
cp .env.example .env
pnpm install
pnpm env:init
pnpm db:up:local
pnpm db:seed
pnpm dev
```

`cp .env.example .env`、`pnpm env:init` 和 `pnpm db:seed` 通常只执行一次。已有 `.env` 时禁止再次复制模板覆盖它。

本地开发使用独立数据库容器（`docker-compose.local.yml`，project `mentor-ai-local`，端口 `5434`，库名 `mentor_ai_dev`，独立数据卷），与正式环境的 PostgreSQL（`5433`/`mentor_ai`）物理隔离；Ollama 复用正式实例（`http://localhost:11434`，Embedding 模型已就位）。`.env` 中的 `DATABASE_URL` 与 `MIGRATION_DATABASE_URL` 必须指向本地库。

**禁止在开发机上执行 `pnpm db:up`**：它会启动正式环境的 compose 并对正式数据库执行 migration。

危机短信 Outbox 消费者由 `server/plugins/notification-worker.ts` 随 App 启动，不需要独立进程。

### 3.2 日常启动与停止

日常启动：

```bash
pnpm db:up:local
pnpm dev
```

若本地 PostgreSQL 和 Ollama 已在运行，可只执行 `pnpm dev`。查看基础服务和首次模型下载进度：

```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs --tail=100 postgres
docker compose logs --tail=100 ollama-pull embedding-index
```

停止开发应用使用终端中的 `Ctrl+C`。停止数据库但保留数据卷：

```bash
docker compose -f docker-compose.local.yml stop postgres
```

禁止把 `docker compose down -v` 当作日常停止命令；`-v` 会删除本地数据库卷及其中全部数据。

## 4. 数据库 Schema 变更流程

数据库结构的唯一事实来源是 `server/db/schema.ts`，数据库变更必须随代码提交 migration。禁止只修改数据库而不修改 Schema，也禁止只修改 Schema 而不生成 migration。

### 4.1 标准步骤

1. 确认本地数据库已启动，并在有价值数据时先执行备份。
2. 修改 `server/db/schema.ts`。
3. 生成新的 migration：

```bash
pnpm db:generate
```

4. 人工检查新生成的 `drizzle/*.sql`，重点检查删除列、类型转换、默认值、非空约束、唯一约束、外键和大表索引。
5. 执行 migration：

```bash
pnpm db:migrate
```

6. 如需更新本地演示数据，修改 `scripts/seed.ts` 后执行：

```bash
pnpm db:seed
```

7. 完成质量检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

8. 在同一个变更中提交 Schema、migration、相关应用代码和测试。

### 4.2 Migration 规则

- 已在任一共享环境执行过的 migration 不得修改、重命名或删除；后续修正必须创建新 migration。
- 禁止在正式环境使用 `drizzle-kit push`、数据库 GUI 同步 Schema 或手工执行未纳入项目的 DDL。
- 优先使用向前兼容的“扩展—迁移数据—收缩”方式：先增加可空字段，再回填数据，最后在后续版本增加非空约束。
- 删除字段、修改字段类型、重建唯一约束或外键属于高风险变更，必须准备数据校验、耗时估计和回滚方案。
- 应用新旧版本可能短暂并存，因此 migration 不得立即破坏旧版本仍在读取的字段。
- migration 必须先在全新数据库和现有数据副本上各验证一次。
- 不在 migration 中创建演示账号或业务测试数据；正式必需的静态配置应使用可审计、幂等且经审核的专用数据迁移。
- 三库业务资料不是数据库 Schema migration。标准 Excel/JSON 应通过平台后台“三库运营台”或 `pnpm import:business-data` 导入并经过发布，禁止直接向资源表写 SQL。

## 5. 应用代码变更流程

开发中每次提交前至少执行：

```bash
pnpm typecheck
pnpm test
```

涉及依赖、Nuxt 配置、服务端 API、认证授权、数据库或部署配置时，还必须执行：

```bash
pnpm build
```

涉及以下范围时增加专项验证：

- 权限或管理员访问：验证四角色越权、授权过期、只读限制和审计日志。
- 危机规则：验证风险事件、转介、Outbox 和审计在同一事务中生成，并通过 App 日志验证通知。
- 数据库：从空库执行全部 migration，再从现有备份副本执行增量 migration。
- AI：验证 DeepSeek 正常、超时、非法 JSON 和无密钥降级场景。
- 敏感页面：验证 `Cache-Control: no-store`、水印和禁止导出。

通知消费者是 Nitro 插件，与 App 使用同一进程和数据库契约；正式发布只部署一个 App 镜像，禁止再配置重复的独立 Worker。

## 6. 正式环境首次部署

### 6.1 配置

1. 在服务器复制 `.env.example` 为 `.env`，人工配置数据库、域名、DeepSeek、短信和全部密钥。正式环境禁止执行 `pnpm env:init`。
2. `POSTGRES_PASSWORD`、`APP_DB_PASSWORD`、`SESSION_SECRET` 和 `ENCRYPTION_KEY` 必须分别生成且不得复用；建议使用密码管理系统保存。
3. 检查不存在模板占位值，并限制文件权限：

```bash
rg 'replace-with|mentor.example.edu.cn' .env
chmod 600 .env
```

`rg` 应无输出。不得把 `.env` 内容输出到工单、聊天或部署日志。

4. 将证书放到 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`，私钥只允许部署账号读取。
5. 确认校内域名、DeepSeek 出口、短信网关、备份目录和事故联系人已就绪。

### 6.2 构建与启动

```bash
docker compose --profile tls build
docker compose --profile tls up -d
docker compose ps -a
docker compose logs --tail=100 migrate
```

只有 `migrate` 显示退出码 `0` 后，App 才应进入运行状态；通知消费者随 App 启动。随后验证：

```bash
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
docker compose logs --tail=100 app nginx
```

最后通过校内域名验证 HTTPS、登录、四角色权限、心理专员 TOTP、DeepSeek 降级和真实短信。正式环境禁止执行 `pnpm db:seed`。

## 7. 正式环境版本更新

每次发布按以下顺序执行：

1. 确认待发布版本、migration 清单、影响范围、负责人和回滚版本。
2. 执行质量检查，确认无未关闭的 P0 缺陷。
3. **测试环境演练**：用正式库最新备份恢复测试库，在测试环境执行迁移并冒烟：

```bash
BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh          # 正式库备份（演练与部署共用）
bash scripts/refresh-test-db.sh                        # 恢复最新备份进测试库（5435）
docker compose -f docker-compose.test.yml up -d        # 测试环境执行 migrate + app
curl -s http://127.0.0.1:3400/health/ready             # 期望 200
# 用正式账号在测试环境登录，并核对 users 等关键表数据量
```

4. 记录备份文件名和校验和，并在隔离环境验证备份可读取。

```bash
shasum -a 256 backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
gzip -t backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
```
5. 构建新镜像并部署：

```bash
docker compose --profile tls build
docker compose --profile tls up -d
docker compose ps -a
docker compose logs --tail=100 migrate app
```

6. 检查内部和外部健康接口，执行登录、权限、核心业务和通知冒烟测试。
7. 观察错误日志、数据库连接、短信失败和 Outbox 积压，确认稳定后结束变更窗口。

迁移由 Compose 的 `migrate` 服务使用管理员账号执行；App 及其内置通知消费者使用低权限账号。不得为了迁移方便把 App 的 `DATABASE_URL` 改成管理员连接。

## 8. 备份、恢复与回滚

### 8.1 备份

```bash
BACKUP_DIR=./backups BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh
```

备份文件默认权限为 `600`。正式环境至少每日备份，并同步到加密的异机存储；至少每月进行一次隔离恢复演练。

### 8.2 应用回滚

应用回滚优先部署上一个已验证镜像或发布版本。数据库 migration 原则上只向前修复，不依赖自动 down migration。所有数据库变更应保持上一个应用版本在短时间内仍可运行。

### 8.3 数据库恢复

恢复会覆盖现有对象，只用于已批准的事故恢复或演练：

```bash
docker compose stop app nginx
CONFIRM_RESTORE=RESTORE_MENTOR_AI ./scripts/restore.sh backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
docker compose --profile tls up -d
```

恢复前必须再次备份当前库，并先在隔离环境验证目标备份。恢复后必须执行 migration、健康检查、抽样数据校验和权限冒烟测试。不得在未验证备份时删除 PostgreSQL 卷。

## 9. 日常正式环境运维

```bash
docker compose ps
docker compose logs --since=30m app nginx postgres
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
```

常规重启单个无状态服务：

```bash
docker compose restart app
```

数据库不得因一般应用故障随意重启。App 重启后内置消费者会继续处理未发送 Outbox；应检查是否存在 `failed` 或长期 `pending` 的通知。

## 10. 明确禁止事项

- 禁止在正式环境执行 `pnpm db:seed`、`pnpm env:init`、`pnpm dev` 或 `pnpm preview`。
- 禁止在未备份、未检查 SQL、未安排变更窗口时执行正式 migration。
- 禁止修改或删除已经执行的 migration，禁止手工篡改 Drizzle migration 记录。
- 禁止让 App 使用数据库管理员账号，禁止把管理员数据库端口开放到非部署网络。
- 禁止直接修改或删除风险事件、审计日志、访问授权和 Outbox 历史。
- 禁止使用 `docker compose down -v` 处理普通故障。
- 禁止将正式数据库复制到个人电脑，禁止在日志、短信或普通聊天工具中发送个人业务数据。
- 禁止未经恢复演练就宣称备份可用。

## 11. 发布记录要求

每次正式发布至少记录：发布版本、提交或镜像标识、执行人、审批人、开始和结束时间、migration 文件、备份文件及校验和、健康检查结果、冒烟结果、异常与处置、回滚版本。数据库恢复还需记录恢复原因、目标备份、数据校验范围和业务负责人确认结果。

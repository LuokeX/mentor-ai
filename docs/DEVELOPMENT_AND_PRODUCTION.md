# 数据库与应用开发、发布和运行规范

本文是教师赋能智能平台在本地开发、测试演练和正式环境中的命令与操作基线。涉及数据库结构、数据迁移、应用发布、Worker、备份或恢复时必须遵守本文。事故处置细节另见 [运维手册](OPERATIONS.md)。

## 1. 环境边界

| 环境 | 用途 | 数据要求 | 允许执行 `db:seed` | 启动方式 |
|---|---|---|---|---|
| 本地开发 | 编码、调试、单元测试 | 仅使用虚构或脱敏数据 | 允许 | Node.js + 本地专用 Docker PostgreSQL（5434/mentor_ai_dev） |
| 测试/UAT | 发布前演练：迁移、功能与数据核对 | 测试环境自有数据，跨版本保留，发布时不用正式库覆盖（默认本机回环，经授权可校内局域网） | 禁止 | `docker-compose.test.yml`（5435/mentor_ai；3400 明文 307 跳 3401 HTTPS，见 8.5） |
| 正式环境 | 校内封闭试用和正式业务 | 真实业务数据 | 禁止 | Docker Compose + Nginx 入口（3300 明文 307 跳 3301 HTTPS，见 8.6） |

必须保证：

- 三类环境使用不同的数据库；测试环境使用自有数据并在各版本之间保留，发布测试版本时只重建镜像、执行 migration 并重启，**不得用正式库备份覆盖测试库数据**。测试库默认仅 `127.0.0.1` 回环访问，经授权开放局域网时仅限校内网络，禁止将数据外传或截图外发。
- `.env` 不提交到版本库，文件权限应为 `600`。日志、备份和截图不得包含密钥或业务正文。
- `mentor_admin` 只用于初始化、迁移、备份和恢复；App 与 Worker 只能使用无建库、建表权限的 `mentor_app`。
- 正式环境只部署经过测试并冻结的版本，不直接在服务器上修改源码、Schema 或历史 migration。

## 2. 命令速查

| 命令 | 作用 | 使用环境 |
|---|---|---|
| `pnpm env:init` | 为本地 `.env` 替换占位值并生成随机密钥 | 仅本地首次初始化 |
| `pnpm db:up:local` | 启动本地开发专用 PostgreSQL（`docker-compose.local.yml`，端口 5434） | 本地开发 |
| `bash scripts/refresh-test-db.sh` | 用正式库备份**覆盖**测试库（`docker-compose.test.yml`，端口 5435）。仅限明确的特殊场景手动执行，不属于发布流程；默认发布测试版本禁止使用 | 仅在获授权的特殊场景 |
| `IMAGE_TAG=<本次构建标签> docker compose -f docker-compose.test.yml up -d --no-build` | 启动测试环境（migrate + app + nginx 入口，访问见 8.5；标签用当天日期等构建标识，不用 latest） | 发布演练 |
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
docker compose logs --tail=100 migrate app
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

### 5.1 代码闸门（单人 trunk 工作流）

单人开发默认在 `main` 上直接进行，核心纪律是「验证通过才 push」。所有发布动作需用户明确授权，默认只在本地 dev（3305）热更新供实时查看：

- 日常直接在本地 `main` 开发，本地 `main` 允许领先远端；改动默认只在 dev（3305）热更新展示，不做任何部署。
- 提交 git 需用户明确说「提交」；多个独立改动必须拆分为多个主题提交（一次一个主题），提交即推送（用户另有指示时按指示办）。
- 部署测试环境（3400 明文跳转 / 3401 HTTPS）：仅当用户明确说「部署测试环境」时，用当前工作区代码演练迁移与功能。
- 演练通过、且用户明确说「部署正式环境」时，才按第 7 节发布正式。
- 需要并行开发不相关功能、或进行实验性改动时，临时从 `main` 开出 `feat/*` 分支，验证通过后合回 `main`（遵循同样的闸门）。
- 数据库迁移与正式部署永远按第 4、7 节流程执行，不因单人 trunk 而跳过。

### 5.2 提交前验证

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
- AI：验证 DeepSeek 正常、超时、非法 JSON、无密钥，以及 Agent 自动重试、空正文收尾补答与重试/补答耗尽后的 `error` 事件。
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

4. 准备 HTTPS 证书：已有学校或公网 CA 签发的证书时，直接放 `infra/certs/fullchain.pem` 和 `infra/certs/privkey.pem`，私钥只允许部署账号读取；没有域名或签发证书时，用 `scripts/gen-cert.sh --env=prod` 生成「本地 CA + 服务器证书」（自签方案，设备需信任 `infra/certs/ca.pem` 才能使用语音输入，见 8.6）。
5. 确认校内访问地址（域名或 IP，必须与证书 SAN 一致）、DeepSeek 出口、短信网关、备份目录和事故联系人已就绪。

### 6.2 构建与启动

```bash
IMAGE_TAG=vX.Y.Z docker compose build app migrate
docker tag mentor-ai-app:vX.Y.Z mentor-ai-app:latest          # latest 兜底别名跟随部署版本
docker tag mentor-ai-migrate:vX.Y.Z mentor-ai-migrate:latest
IMAGE_TAG=vX.Y.Z docker compose up -d --no-build
docker compose ps -a
docker compose logs --tail=100 migrate
```

只有 `migrate` 显示退出码 `0` 后，App 才应进入运行状态；通知消费者随 App 启动。随后验证：

```bash
docker compose exec app node -e "fetch('http://127.0.0.1:3300/health/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
curl -fsS http://localhost:3300/health/ready    # 3300 明文直通（见 8.6）
curl -sk  https://localhost:3301/health/ready   # 3301 HTTPS，自签证书用 -k
docker compose logs --tail=100 app nginx
```

最后通过校内访问地址验证 HTTPS、登录、四角色权限、DeepSeek 降级和真实短信。正式环境禁止执行 `pnpm db:seed`。

### 6.3 文档工作区沙箱（可选，Phase 1 默认关闭）

设计与威胁模型见 [AI_AGENT_SANDBOX.md](AI_AGENT_SANDBOX.md)。默认 `SANDBOX_ENABLED=false`，`docker compose up -d` 不会启动 `sandbox-runner`（profile `sandbox`）。

启用步骤：

```bash
openssl rand -hex 32          # 写入 .env 的 SANDBOX_RUNNER_TOKEN，禁止复用其他密钥
# .env: SANDBOX_ENABLED=true
IMAGE_TAG=vX.Y.Z docker compose --profile sandbox build sandbox-runner
docker tag mentor-ai-sandbox:vX.Y.Z mentor-ai-sandbox:latest
IMAGE_TAG=vX.Y.Z docker compose --profile sandbox up -d
```

- 网络：`sandbox-internal` 为 `internal: true`，runner 无外网；只有 app 同时挂默认网络与内部网络。不要给 runner 加 `ports`，不要挂载应用代码或密钥。
- 验证：`docker compose --profile sandbox ps` 中 runner healthy；`docker compose exec app wget -qO- http://sandbox-runner:3200/health` 返回 200；从宿主机或其他网络访问 3200 应失败。
- 回滚：`.env` 设 `SANDBOX_ENABLED=false`，再 `docker compose --profile sandbox stop sandbox-runner`；app 不依赖 runner 即可启动。
- 范围：Phase 1 runner 只支持 txt/md/docx 文本抽取，不执行 shell、不接模型；Agent 工具与上传 UI 在 Phase 2 接入。启用沙箱时，发布构建需额外重建 `sandbox-runner` 镜像；未启用时不需要。

## 7. 正式环境版本更新

每次发布按以下顺序执行：

1. 确认待发布版本、migration 清单、影响范围、负责人和回滚版本。
2. 执行质量检查，确认无未关闭的 P0 缺陷。
3. **测试环境演练**：在测试库现有数据上执行迁移并冒烟。测试库数据跨版本保留，**不得用正式库备份覆盖**（覆盖操作不属于发布流程，见 8.4）：

```bash
IMAGE_TAG=<本次构建标签> docker compose -f docker-compose.test.yml build app migrate  # 迁移 SQL 在镜像内，migrate 必须一起重建
docker tag mentor-ai-test-app:<本次构建标签> mentor-ai-test-app:latest                # latest 兜底别名跟本次构建
docker tag mentor-ai-test-migrate:<本次构建标签> mentor-ai-test-migrate:latest
IMAGE_TAG=<本次构建标签> docker compose -f docker-compose.test.yml up -d --no-build   # 测试环境执行 migrate + app（含 nginx 入口），保留现有数据
curl -s http://127.0.0.1:3400/health/ready             # 期望 200（健康检查在跳转规则之外，明文可探活）
curl -sk https://127.0.0.1:3401/health/ready           # 期望 200（自签证书用 -k，正式证书可直接校验）
# 用测试环境已有账号登录，验证迁移后关键功能与数据完整性
```

标签用当天日期或当次构建标识（如 `20261010`），并在发布记录里留痕；部署同样显式引用该标签，不用 `latest`。

4. 记录备份文件名和校验和，并在隔离环境验证备份可读取。

```bash
shasum -a 256 backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
gzip -t backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
```
5. 构建新镜像并部署：

```bash
IMAGE_TAG=vX.Y.Z docker compose build app migrate
docker tag mentor-ai-app:vX.Y.Z mentor-ai-app:latest       # latest 兜底别名跟随本次部署版本
docker tag mentor-ai-migrate:vX.Y.Z mentor-ai-migrate:latest
IMAGE_TAG=vX.Y.Z docker compose up -d --no-build
IMAGE_TAG=vX.Y.Z docker compose ps -a      # 核对 IMAGE 列就是 vX.Y.Z
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

备份文件默认权限为 `600`。正式环境至少每日备份，并同步到加密的异机存储；至少每月进行一次隔离恢复演练。数据库 + 代码（含提交历史）的日常备份由 `scripts/backup-to-oss.ts` 自动上传阿里云 OSS（配置与恢复步骤见 [运维手册](OPERATIONS.md) 的「自动备份到阿里云 OSS」）。

### 8.2 应用回滚

应用回滚优先部署上一个已验证镜像或发布版本，显式引用版本标签：

```bash
IMAGE_TAG=v<上一版本> docker compose up -d --no-build
docker tag mentor-ai-app:v<上一版本> mentor-ai-app:latest       # latest 别名跟随回滚版本
docker tag mentor-ai-migrate:v<上一版本> mentor-ai-migrate:latest
```

数据库 migration 原则上只向前修复，不依赖自动 down migration。所有数据库变更应保持上一个应用版本在短时间内仍可运行。

### 8.3 数据库恢复

恢复会覆盖现有对象，只用于已批准的事故恢复或演练：

```bash
docker compose ps app                              # 记下当前部署的镜像标签（如 mentor-ai-app:vX.Y.Z）
docker compose stop app nginx
CONFIRM_RESTORE=RESTORE_MENTOR_AI ./scripts/restore.sh backups/mentor-ai-YYYYMMDD-HHMMSS.sql.gz
IMAGE_TAG=vX.Y.Z docker compose up -d --no-build   # 用恢复前记录的实际部署版本启动
```

恢复前必须再次备份当前库，并先在隔离环境验证目标备份。恢复后必须执行 migration、健康检查、抽样数据校验和权限冒烟测试。不得在未验证备份时删除 PostgreSQL 卷。

### 8.4 测试环境数据库

测试库（`docker-compose.test.yml`，5435）使用自有数据并跨版本保留。发布测试版本时只重建镜像、执行 migration 并重启，禁止用正式库备份覆盖测试库，否则会丢掉测试环境上已积累的验证数据。

`scripts/refresh-test-db.sh` 会用正式库备份**清空并覆盖**测试库，属于特殊场景工具（例如需要复现只在正式数据上出现的迁移问题），不属于发布流程：仅当确有需要并经明确授权时手动执行，执行前先确认测试库现有数据可以丢弃。测试库中可能残留早期恢复的正式数据副本（真实人员与业务内容），仍按第 1 节要求限制访问，禁止外传或截图外发。

### 8.5 测试环境访问入口（3400 → 3401）

测试环境的唯一入口是 `docker-compose.test.yml` 里的 `nginx` 服务，应用容器不再直接发布端口：

- **3400 明文**：只做跳转，任何请求返回 `307` 到 `https://<同一主机>:3401`。用 `307` 而不是 `301/302`，是因为前者要求客户端保持请求方法与请求体——否则登录、提问这类 POST 会被部分客户端改写成 GET。
- **3401 HTTPS**：TLS 终结后转发 `app:3300`，是唯一实际提供应用的入口。**浏览器调用麦克风（语音输入）要求安全上下文，必须走这里**，明文 3400 会被浏览器拒绝。
- **例外**：`/health/live`、`/health/ready` 在 3400 上直通应用（不跳转），发布流程与监控可继续用明文探活。

测试环境的登录页提供「选择测试账户」入口：点选账号自动填入手机号与密码，再点「安全登录」；认证仍走正常 `/api/v1/auth/login`，没有新增接口、也没有绕过口令校验。开关是公共运行时变量 `NUXT_PUBLIC_SHOW_TEST_ACCOUNTS`，**只有 `docker-compose.test.yml` 注入 `true`**，正式编排不注入、`.env` 也不应打开。账号清单维护在 `app/utils/test-accounts.ts`：只放测试库长期保留的演示账号（4 个种子账号、三个学部管理员、三个学部校长、心理专员、教师张忠程），**不要加入真实教师账号**——测试库可能残留正式库数据副本，把账号铺开等于把人员名单放到登录页上。

证书放在 `infra/certs-test/`（已 gitignore，与正式的 `infra/certs/` 分开，避免自签证书被正式环境误用），由 `scripts/gen-cert.sh` 生成「本地 CA + 服务器证书」（不带 `--env` 即测试环境）：

```bash
scripts/gen-cert.sh                   # SAN 自动含 localhost、主机名、127.0.0.1 与本机全部 IPv4
FORCE=1 scripts/gen-cert.sh           # 重签（换 IP、续期）
```

要让老师们能真正使用录音，必须把 `infra/certs-test/ca.pem` 安装到每台设备的「受信任的根证书颁发机构」；不安装时浏览器会先提示证书不受信（实测点过提示后仍是安全上下文、麦克风可用，但地址栏显示「不安全」，且浏览器策略可能收紧）。已经持有学校或公网 CA 签发的证书时，直接替换 `infra/certs-test/fullchain.pem` 与 `privkey.pem` 即可，不需要本地 CA。

排查用命令：

```bash
curl -sI  http://<主机>:3400/ | grep -i location   # 应看到 307 与 https://<主机>:3401/
curl -sk https://<主机>:3401/health/ready          # 应返回 200
docker compose -f docker-compose.test.yml logs --tail=50 nginx
```

### 8.6 正式环境访问入口（3300 → 3301）

正式环境的唯一入口是 `docker-compose.yml` 里的 `nginx` 服务（属于默认 profile，`docker compose up -d` 即随应用启动），应用容器不再直接发布宿主端口，与测试环境同一套端口规律（测试为 3400 → 3401，见 8.5）：

- **3300 明文**：只做跳转，任何请求返回 `307` 到 `https://<同一主机>:3301<原路径>`；用 `307` 的原因见 8.5。
- **3301 HTTPS**：TLS 终结后转发 `app:3300`，是唯一实际提供应用的入口。**浏览器调用麦克风（语音输入）要求安全上下文，必须走这里。**
- **例外**：`/health/live`、`/health/ready` 在 3300 上直通应用，发布流程与监控可继续用明文探活。
- `.env` 的 `SESSION_COOKIE_SECURE` 应为 `true`：唯一入口是 HTTPS，明文 3300 只做跳转、拿不到会话。
- 3301 不是标准 HTTPS 端口，所以访问地址、书签、二维码和发给老师的链接必须显式带 `:3301`；Nginx 用 `$http_host` 转发 Host，应用生成的绝对地址不会丢端口。

证书放在 `infra/certs/`（已 gitignore）。没有校内域名或学校签发证书时，用本地 CA 自签：

```bash
scripts/gen-cert.sh --env=prod            # SAN 自动含 localhost、主机名、127.0.0.1 与本机全部 IPv4
FORCE=1 scripts/gen-cert.sh --env=prod    # 重签（换 IP、续期；设备只需继续信任同一张 ca.pem）
```

要让老师们能真正使用录音，必须把 `infra/certs/ca.pem` 安装到每台设备的「受信任的根证书颁发机构」；不安装时浏览器会先提示证书不受信，是否仍能录音取决于浏览器策略（测试环境实测点过提示后可用，但地址栏显示「不安全」，且浏览器策略可能收紧）。接入校内访问地址时，证书 SAN 必须包含该地址，换址要重签。

`infra/nginx/default.conf.template` 里 HSTS 默认保持注释：自签证书阶段一旦被浏览器记住，换证书或证书不受信时会直接硬失败。学校或公网 CA 签发的证书到位后，替换 `fullchain.pem` 与 `privkey.pem` 并取消该行注释。

排查用命令：

```bash
curl -sI  http://<主机>:3300/ | grep -i location   # 应看到 307 与 https://<主机>:3301/
curl -fsS http://<主机>:3300/health/ready          # 3300 明文直通，应返回 200
curl -sk  https://<主机>:3301/health/ready         # 3301 HTTPS，自签证书用 -k
docker compose logs --tail=50 nginx
```

## 9. 日常正式环境运维

```bash
docker compose ps
docker compose logs --since=30m app nginx postgres
docker compose exec app node -e "fetch('http://127.0.0.1:3300/health/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
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

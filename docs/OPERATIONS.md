# 部署、回滚、备份与事故处理手册

数据库 Schema 变更、开发命令、正式部署顺序和禁止事项以 [数据库与应用开发、发布和运行规范](DEVELOPMENT_AND_PRODUCTION.md) 为准；本文侧重运行期检查和事故处置。

## 上线前检查

- 校内访问地址（域名或 IP）与 `infra/certs/` 证书的 SAN 一致，TLS 证书和私钥权限正确；使用自签证书时已确认访问设备信任 `ca.pem`（见 [开发发布规范](DEVELOPMENT_AND_PRODUCTION.md) 第 8.6 节）。
- `.env` 中数据库、会话和加密密钥均为独立强随机值；不得使用示例值。
- `SMS_PROVIDER=webhook` 已配置真实网关，网关按 `Idempotency-Key` 去重。
- DeepSeek Base URL、模型名、超时和出口白名单已联调；故障时已验证 Agent 自动重试与失败提示，且安全熔断仍由本地规则先行执行。
- 学校已配置默认心理专员、求助电话、危机文案和短信接收人。
- 已删除演示账号。

## 发布与回滚

发布流程固定为「版本标签 → 备份 → 构建 → 部署 → 验证」五步。**每次正式发布必须先由发布人确认版本号（`vX.Y.Z`），且 `shared/app-version.ts` 的展示号、git 标签、docker 镜像标签三处必须一致**；构建与部署显式传 `IMAGE_TAG=vX.Y.Z` 引用版本镜像，**不使用 `latest` 部署**（`latest` 只作兜底别名，且部署后要让它跟随本次版本，避免日常命令意外指向旧镜像）。部署完成后记录：版本号（三处）、migration、备份文件及校验和、健康检查与冒烟结果。

```bash
# 1) 展示号改为 vX.Y.Z 并提交（chore(release): 版本号更新 vX.Y.Z），
#    然后打 git 标签并推送（版本号由发布人确认，禁止代理自行决定）
git tag -a vX.Y.Z -m "正式部署：<本次变更摘要>"
git push origin vX.Y.Z

# 2) 发布前备份数据库
./scripts/backup.sh

# 3) 构建镜像：镜像直接以 vX.Y.Z 命名（一次只跑一个 build，禁止并发 build 互相排队阻塞）
#    必须同时重建 migrate：迁移 SQL 烘焙在镜像里，只建 app 会导致新迁移不执行
IMAGE_TAG=vX.Y.Z docker compose build app migrate

# 4) 让 latest 兜底别名跟随本次版本，避免后续不带 IMAGE_TAG 的日常命令指向旧镜像
docker tag mentor-ai-app:vX.Y.Z mentor-ai-app:latest
docker tag mentor-ai-migrate:vX.Y.Z mentor-ai-migrate:latest

# 5) 部署：显式引用版本镜像，不用 latest
IMAGE_TAG=vX.Y.Z docker compose up -d --no-build   # 含 nginx 入口（3300 明文 307 跳 3301 HTTPS）

# 6) 验证：先核对运行中的镜像标签就是 vX.Y.Z，再做健康检查与冒烟
IMAGE_TAG=vX.Y.Z docker compose ps                 # IMAGE 列应为 mentor-ai-app:vX.Y.Z / mentor-ai-migrate:vX.Y.Z
curl -fsS http://localhost:3300/health/ready     # 3300 明文直通
curl -sk  https://localhost:3301/health/ready    # 3301 HTTPS，自签证书用 -k
# 冒烟：四角色登录 + /auth/me
```

应用回滚显式引用上一个经过验证的**版本镜像**：`IMAGE_TAG=v<上一版本> docker compose up -d --no-build`，不依赖 `latest`。数据库迁移默认只做向前兼容变更；若必须回退数据库，先停止 App（含内置通知消费者），再在隔离数据库验证目标备份，最后使用恢复脚本。不要在未验证备份时直接删除卷。

正式环境禁止执行 `pnpm db:seed`、`pnpm env:init`、`pnpm dev` 和 `docker compose down -v`。每次发布必须记录 migration、备份文件及校验和、健康检查与冒烟结果。

## 每日备份与恢复演练

日常备份由 `scripts/backup-to-oss.ts` 承担：数据库 + 代码 + 提交历史打包上传阿里云 OSS（见下节）。发布前的快速备份仍走 `./scripts/backup.sh`（只导数据库、不上传、产物在 `backups/`）。至少每月在隔离实例执行一次恢复，并记录：备份文件、校验和、开始/完成时间、恢复人、抽样记录数和应用健康检查结果。

## 自动备份到阿里云 OSS

`scripts/backup-to-oss.ts` 一次执行生成四类产物并上传 OSS（走阿里云 S3 兼容接口，虚拟主机风格端点）：

| 产物 | 内容 |
|---|---|
| `<prefix>/mentor-ai_<时间戳>.sql.gz` | 正式库 `pg_dump --clean --if-exists --no-owner` 的 gzip（经 `docker compose exec postgres` 流式导出到宿主） |
| `<prefix>/mentor-ai-code_<时间戳>.tar.gz` | 源码 + `.env` + `infra/certs` 证书 + `临时文件/` + `.git`（排除 `node_modules`、`.nuxt`、`.output`、`.data`、`playwright-report`、`test-results`、`backups`，以及 `.env.backup` 等 OSS 凭据文件） |
| `<prefix>/mentor-ai_<时间戳>.git.bundle` | `git bundle --all`，完整提交历史（不含未提交改动） |
| `<prefix>/mentor-ai_<时间戳>.sha256` | 上面三个产物的 sha256 清单 |

四类产物平铺在 `oss://<bucket>/<prefix>/` 同一个文件夹下，不分子目录。本地 `backups/db`、`backups/code` 默认保留 7 天，OSS 端默认保留 30 天，超期自动删除（天数在 `.env.backup` 调整）。单次约 100 MB、30 秒左右。备份目标是 compose 的 `postgres` 服务（默认 `docker-compose.yml`，容器未启动即失败）；需要备份测试环境时在 `.env.backup` 里改 `BACKUP_COMPOSE_FILE=docker-compose.test.yml`。

**配置**（bucket 必须保持「私有」读写：备份包含 `.env` 的数据库口令、`ENCRYPTION_KEY`、DeepSeek/百炼 Key，以及 `infra/certs` 的 TLS 私钥）：

```bash
cp .env.backup.example .env.backup   # 填 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
pnpm backup:oss --check              # 只验证凭据与 bucket 连通性
pnpm backup:oss --list               # 列出 OSS 上已有的备份对象
pnpm backup:oss --dry-run            # 只生成备份产物，不上传、不清理（无需 OSS 配置也可跑）
pnpm backup:oss                      # 完整备份并清理过期
```

RAM 子账号只需该 bucket 的 `oss:PutObject` / `oss:GetObject` / `oss:ListObjects` / `oss:DeleteObject`；缺少 `DeleteObject` 时备份照常成功，只是 OSS 上的旧备份会持续累积。与其他项目共用 bucket 时必须使用各自独立的 `OSS_PREFIX`：过期清理只遍历 `<prefix>/` 下的对象。

**安装每日 03:00 自动执行**（幂等，重复执行不会重复添加；卸载用 `crontab -e` 删除该行）：

```bash
./scripts/install-backup-cron.sh
# 自定义频率：CRON_SCHEDULE="0 */6 * * *" ./scripts/install-backup-cron.sh
# 查看执行日志：tail -f backups/backup-cron.log
```

**从 OSS 恢复数据库**（对象可用 ossutil 或阿里云控制台下载）：

```bash
ossutil cp oss://<bucket>/<prefix>/mentor-ai_<时间戳>.sql.gz .
ossutil cp oss://<bucket>/<prefix>/mentor-ai_<时间戳>.sha256 .
sha256sum -c mentor-ai_<时间戳>.sha256    # 三个产物都在同一目录时逐项校验
docker compose ps app                              # 记下当前部署的镜像标签（如 mentor-ai-app:vX.Y.Z）
docker compose stop app nginx
CONFIRM_RESTORE=RESTORE_MENTOR_AI ./scripts/restore.sh mentor-ai_<时间戳>.sql.gz
IMAGE_TAG=vX.Y.Z docker compose up -d --no-build   # 用恢复前记录的实际部署版本启动
```

**代码恢复**：解压 `mentor-ai-code_<时间戳>.tar.gz` 即得完整工作区（含 `.env`、`infra/certs` 与 `.git`）；或用 bundle 重建仓库：`git clone mentor-ai_<时间戳>.git.bundle mentor-ai`。包内**不含** `.env.backup`：恢复后需重新填一份 OSS 凭据，自动备份才能继续。

## 健康与日志

- 存活：`GET /health/live`
- 就绪：`GET /health/ready`
- App（含内置通知消费者）、Nginx 和 PostgreSQL 日志使用 `docker compose logs` 收集；生产环境应接入校内集中日志并限制管理员访问。
- 内置通知消费者会回收超过两分钟的 `processing` 锁；短信按立即、1、5、15 分钟尝试。最终失败时 `notification_outbox.status=failed`，需要人工复核接收人和网关。

## 危机事故

1. 不等待 AI：教师页面展示校内求助电话，风险事件和转介先落库。
2. 教师端转介卡片文案不得出现「危机、红线、预警、立即、110、120」字样：学校危机指引在保存时校验（`school-admin/settings.patch.ts`），读取时命中禁用字样回退默认指引（`server/domain/safety.ts` 的 `resolveCrisisGuide`）；紧急处置交由学校既有流程、校内求助电话和心理专员承载。
3. 心理专员确认收到并转入线下流程；平台不替代 110/120 或学校既有制度。
4. 短信失败时通过校内备用电话联系；不得在短信或普通聊天工具中发送姓名和个案正文。
5. 保存风险事件号、转介号、Outbox 状态和审计号，禁止擅自修改原记录。
6. 处置结束后由合规负责人复盘响应时间、授权访问和通知失败原因。

## 数据泄露或越权

立即停用相关账号并撤销会话，保全 `audit_logs`、`admin_access_requests`、`admin_access_grants` 和 `admin_access_events`；必要时停用受影响学校。不要用常规数据库页面查看业务正文。按校方制度通知合规负责人，确认影响对象、字段和时间范围后再决定通知和恢复。

## 密钥轮换

会话密钥可在维护窗口替换并使现有会话失效。`ENCRYPTION_KEY` 直接替换会导致旧密文无法读取，因此必须通过专用离线轮换程序逐条解密再加密，并保留受控旧密钥直到校验完成；封闭试用期不得手工批量更新密文字段。
